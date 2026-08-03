use crate::integrations::{DeliveryState, OutboundDelivery};
use chrono::Utc;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, serde::Serialize, sqlx::FromRow)]
pub struct DeliveryRecord {
    pub id: String,
    pub meeting_id: String,
    pub destination: String,
    pub event_type: String,
    pub schema_version: i64,
    pub idempotency_key: String,
    pub payload_json: String,
    pub state: String,
    pub approved_at: Option<String>,
    pub sent_at: Option<String>,
    pub last_error: Option<String>,
    pub created_at: String,
}

pub struct DeliveriesRepository;

impl DeliveriesRepository {
    pub async fn create_or_get(
        pool: &SqlitePool,
        meeting_id: &str,
        delivery: &OutboundDelivery,
    ) -> Result<DeliveryRecord, SqlxError> {
        let id = format!("delivery-{}", Uuid::new_v4());
        sqlx::query(
            "INSERT INTO outbound_deliveries (id, meeting_id, destination, event_type, schema_version, idempotency_key, payload_json, state) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING",
        )
        .bind(&id)
        .bind(meeting_id)
        .bind(&delivery.destination)
        .bind(&delivery.event_type)
        .bind(i64::from(delivery.schema_version))
        .bind(&delivery.idempotency_key)
        .bind(serde_json::to_string(&delivery.payload).map_err(|error| SqlxError::Protocol(error.to_string()))?)
        .bind("pending_approval")
        .execute(pool)
        .await?;
        Self::find_by_key(pool, &delivery.idempotency_key).await
    }

    pub async fn find_by_key(pool: &SqlitePool, key: &str) -> Result<DeliveryRecord, SqlxError> {
        sqlx::query_as(
            "SELECT id, meeting_id, destination, event_type, schema_version, idempotency_key, payload_json, state, approved_at, sent_at, last_error, created_at FROM outbound_deliveries WHERE idempotency_key = ?",
        )
        .bind(key)
        .fetch_one(pool)
        .await
    }

    pub async fn find_by_id(pool: &SqlitePool, id: &str) -> Result<DeliveryRecord, SqlxError> {
        sqlx::query_as(
            "SELECT id, meeting_id, destination, event_type, schema_version, idempotency_key, payload_json, state, approved_at, sent_at, last_error, created_at FROM outbound_deliveries WHERE id = ?",
        )
        .bind(id)
        .fetch_one(pool)
        .await
    }

    pub async fn list_for_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<DeliveryRecord>, SqlxError> {
        sqlx::query_as(
            "SELECT id, meeting_id, destination, event_type, schema_version, idempotency_key, payload_json, state, approved_at, sent_at, last_error, created_at FROM outbound_deliveries WHERE meeting_id = ? ORDER BY created_at DESC",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn approve(pool: &SqlitePool, id: &str) -> Result<bool, SqlxError> {
        let result = sqlx::query(
            "UPDATE outbound_deliveries SET state = 'approved', approved_at = ?, updated_at = ? WHERE id = ? AND state IN ('pending_approval', 'failed')",
        )
        .bind(Utc::now())
        .bind(Utc::now())
        .bind(id)
        .execute(pool)
        .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn set_sent(pool: &SqlitePool, id: &str) -> Result<(), SqlxError> {
        sqlx::query("UPDATE outbound_deliveries SET state = 'sent', sent_at = ?, updated_at = ?, last_error = NULL WHERE id = ? AND state = 'approved'")
            .bind(Utc::now()).bind(Utc::now()).bind(id).execute(pool).await?;
        Ok(())
    }

    pub async fn set_failed(pool: &SqlitePool, id: &str, error: &str) -> Result<(), SqlxError> {
        sqlx::query("UPDATE outbound_deliveries SET state = 'failed', last_error = ?, updated_at = ? WHERE id = ?")
            .bind(error).bind(Utc::now()).bind(id).execute(pool).await?;
        Ok(())
    }
}

pub fn state_from_record(value: &str) -> DeliveryState {
    match value {
        "approved" => DeliveryState::Approved,
        "sent" => DeliveryState::Sent,
        "failed" => DeliveryState::Failed,
        _ => DeliveryState::PendingApproval,
    }
}

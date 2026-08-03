use serde::Serialize;
use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

#[derive(Debug, Clone, Serialize, sqlx::FromRow)]
pub struct AuditEvent {
    pub id: String,
    pub occurred_at: String,
    pub event_type: String,
    pub meeting_id: Option<String>,
    pub details_json: String,
}

pub struct AuditRepository;

impl AuditRepository {
    pub async fn append(
        pool: &SqlitePool,
        event_type: &str,
        meeting_id: Option<&str>,
        details: serde_json::Value,
    ) -> Result<(), SqlxError> {
        sqlx::query("INSERT INTO audit_events (id, event_type, meeting_id, details_json) VALUES (?, ?, ?, ?)")
            .bind(format!("audit-{}", Uuid::new_v4()))
            .bind(event_type)
            .bind(meeting_id)
            .bind(serde_json::to_string(&details).map_err(|error| SqlxError::Protocol(error.to_string()))?)
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn list(pool: &SqlitePool, limit: i64) -> Result<Vec<AuditEvent>, SqlxError> {
        sqlx::query_as("SELECT id, occurred_at, event_type, meeting_id, details_json FROM audit_events ORDER BY occurred_at DESC LIMIT ?")
            .bind(limit.clamp(1, 500))
            .fetch_all(pool)
            .await
    }
}

#[cfg(test)]
mod tests {
    use super::AuditRepository;
    use sqlx::SqlitePool;

    #[tokio::test]
    async fn audit_rows_are_append_only() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE audit_events (id TEXT PRIMARY KEY, occurred_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP, event_type TEXT NOT NULL, meeting_id TEXT, details_json TEXT NOT NULL)")
            .execute(&pool).await.unwrap();
        sqlx::query("CREATE TRIGGER audit_events_no_update BEFORE UPDATE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;")
            .execute(&pool).await.unwrap();
        sqlx::query("CREATE TRIGGER audit_events_no_delete BEFORE DELETE ON audit_events BEGIN SELECT RAISE(ABORT, 'audit events are immutable'); END;")
            .execute(&pool).await.unwrap();
        AuditRepository::append(
            &pool,
            "delivery.prepared",
            Some("meeting-1"),
            serde_json::json!({"delivery_id": "d1"}),
        )
        .await
        .unwrap();
        let event = AuditRepository::list(&pool, 10)
            .await
            .unwrap()
            .pop()
            .unwrap();
        assert!(
            sqlx::query("UPDATE audit_events SET event_type = 'changed' WHERE id = ?")
                .bind(&event.id)
                .execute(&pool)
                .await
                .is_err()
        );
        assert!(sqlx::query("DELETE FROM audit_events WHERE id = ?")
            .bind(&event.id)
            .execute(&pool)
            .await
            .is_err());
    }
}

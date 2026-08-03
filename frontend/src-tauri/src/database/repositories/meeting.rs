use crate::api::{MeetingDetails, MeetingTranscript};
use crate::database::models::{DateTimeUtc, MeetingModel, Transcript};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqliteConnection, SqlitePool};
use tracing::{error, info};

pub struct MeetingsRepository;

impl MeetingsRepository {
    pub async fn get_meetings(pool: &SqlitePool) -> Result<Vec<MeetingModel>, sqlx::Error> {
        Self::apply_due_retention(pool).await?;
        let meetings =
            sqlx::query_as::<_, MeetingModel>("SELECT * FROM meetings WHERE trashed_at IS NULL AND archived_at IS NULL ORDER BY pinned_at DESC, created_at DESC")
                .fetch_all(pool)
                .await?;
        Ok(meetings)
    }

    async fn apply_due_retention(pool: &SqlitePool) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE meetings SET trashed_at = ? WHERE trashed_at IS NULL AND retention_due_at IS NOT NULL AND retention_due_at <= ?")
            .bind(Utc::now())
            .bind(Utc::now())
            .execute(pool)
            .await?;
        Ok(())
    }

    pub async fn get_retention_due_at(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<DateTimeUtc>, SqlxError> {
        sqlx::query_scalar("SELECT retention_due_at FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_one(pool)
            .await
    }

    pub async fn set_retention_due_at(
        pool: &SqlitePool,
        meeting_id: &str,
        due_at: Option<DateTimeUtc>,
    ) -> Result<bool, SqlxError> {
        let result =
            sqlx::query("UPDATE meetings SET retention_due_at = ?, updated_at = ? WHERE id = ?")
                .bind(due_at)
                .bind(Utc::now())
                .bind(meeting_id)
                .execute(pool)
                .await?;
        Ok(result.rows_affected() == 1)
    }

    pub async fn get_trashed_meetings(pool: &SqlitePool) -> Result<Vec<MeetingModel>, sqlx::Error> {
        Self::apply_due_retention(pool).await?;
        sqlx::query_as::<_, MeetingModel>(
            "SELECT * FROM meetings WHERE trashed_at IS NOT NULL ORDER BY trashed_at DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn get_archived_meetings(
        pool: &SqlitePool,
    ) -> Result<Vec<MeetingModel>, sqlx::Error> {
        Self::apply_due_retention(pool).await?;
        sqlx::query_as::<_, MeetingModel>(
            "SELECT * FROM meetings WHERE archived_at IS NOT NULL AND trashed_at IS NULL ORDER BY archived_at DESC",
        )
        .fetch_all(pool)
        .await
    }

    pub async fn delete_meeting(pool: &SqlitePool, meeting_id: &str) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        match delete_meeting_with_transaction(&mut transaction, meeting_id).await {
            Ok(success) => {
                if success {
                    transaction.commit().await?;
                    info!(
                        "Successfully deleted meeting {} and all associated data",
                        meeting_id
                    );
                    Ok(true)
                } else {
                    transaction.rollback().await?;
                    Ok(false)
                }
            }
            Err(e) => {
                let _ = transaction.rollback().await;
                error!("Failed to delete meeting {}: {}", meeting_id, e);
                Err(e)
            }
        }
    }

    pub async fn get_meeting(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingDetails>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        // Get meeting details
        let meeting: Option<MeetingModel> = sqlx::query_as(
            "SELECT id, title, created_at, updated_at, folder_path, project, pinned_at, archived_at, trashed_at FROM meetings WHERE id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;

        if meeting.is_none() {
            transaction.rollback().await?;
            return Err(SqlxError::RowNotFound);
        }

        if let Some(meeting) = meeting {
            // Get all transcripts for this meeting
            let transcripts =
                sqlx::query_as::<_, Transcript>("SELECT * FROM transcripts WHERE meeting_id = ?")
                    .bind(meeting_id)
                    .fetch_all(&mut *transaction)
                    .await?;

            transaction.commit().await?;

            // Convert Transcript to MeetingTranscript
            let meeting_transcripts = transcripts
                .into_iter()
                .map(|t| MeetingTranscript {
                    id: t.id,
                    text: t.transcript,
                    timestamp: t.timestamp,
                    audio_start_time: t.audio_start_time,
                    audio_end_time: t.audio_end_time,
                    duration: t.duration,
                    source: t.speaker,
                })
                .collect::<Vec<_>>();

            Ok(Some(MeetingDetails {
                id: meeting.id,
                title: meeting.title,
                created_at: meeting.created_at.0.to_rfc3339(),
                updated_at: meeting.updated_at.0.to_rfc3339(),
                transcripts: meeting_transcripts,
            }))
        } else {
            transaction.rollback().await?;
            Ok(None)
        }
    }

    /// Get meeting metadata without transcripts (for pagination)
    pub async fn get_meeting_metadata(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Option<MeetingModel>, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let meeting: Option<MeetingModel> = sqlx::query_as(
            "SELECT id, title, created_at, updated_at, folder_path, project, pinned_at, archived_at, trashed_at FROM meetings WHERE id = ?",
        )
        .bind(meeting_id)
        .fetch_optional(pool)
        .await?;

        Ok(meeting)
    }

    /// Get meeting transcripts with pagination support
    pub async fn get_meeting_transcripts_paginated(
        pool: &SqlitePool,
        meeting_id: &str,
        limit: i64,
        offset: i64,
    ) -> Result<(Vec<Transcript>, i64), SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        // Get total count of transcripts for this meeting
        let total: (i64,) = sqlx::query_as("SELECT COUNT(*) FROM transcripts WHERE meeting_id = ?")
            .bind(meeting_id)
            .fetch_one(pool)
            .await?;

        // Get paginated transcripts ordered by audio_start_time
        let transcripts = sqlx::query_as::<_, Transcript>(
            "SELECT * FROM transcripts
             WHERE meeting_id = ?
             ORDER BY audio_start_time ASC
             LIMIT ? OFFSET ?",
        )
        .bind(meeting_id)
        .bind(limit)
        .bind(offset)
        .fetch_all(pool)
        .await?;

        Ok((transcripts, total.0))
    }

    pub async fn update_meeting_title(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now().naive_utc();

        let rows_affected =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;
        if rows_affected.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false);
        }
        transaction.commit().await?;
        Ok(true)
    }

    pub async fn update_meeting_project(
        pool: &SqlitePool,
        meeting_id: &str,
        project: Option<&str>,
    ) -> Result<bool, SqlxError> {
        if meeting_id.trim().is_empty() {
            return Err(SqlxError::Protocol(
                "meeting_id cannot be empty".to_string(),
            ));
        }
        let project = project.map(str::trim).filter(|value| !value.is_empty());
        let result = sqlx::query("UPDATE meetings SET project = ?, updated_at = ? WHERE id = ?")
            .bind(project)
            .bind(Utc::now().naive_utc())
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn set_lifecycle_timestamp(
        pool: &SqlitePool,
        meeting_id: &str,
        column: &str,
        enabled: bool,
    ) -> Result<bool, SqlxError> {
        let sql = match column {
            "pinned_at" => "UPDATE meetings SET pinned_at = ?, updated_at = ? WHERE id = ?",
            "archived_at" => "UPDATE meetings SET archived_at = ?, updated_at = ? WHERE id = ?",
            "trashed_at" => "UPDATE meetings SET trashed_at = ?, updated_at = ? WHERE id = ?",
            _ => {
                return Err(SqlxError::Protocol(
                    "unsupported lifecycle state".to_string(),
                ))
            }
        };
        let timestamp = enabled.then(Utc::now);
        let result = sqlx::query(sql)
            .bind(timestamp)
            .bind(Utc::now().naive_utc())
            .bind(meeting_id)
            .execute(pool)
            .await?;
        Ok(result.rows_affected() > 0)
    }

    pub async fn update_meeting_name(
        pool: &SqlitePool,
        meeting_id: &str,
        new_title: &str,
    ) -> Result<bool, SqlxError> {
        let mut transaction = pool.begin().await?;
        let now = Utc::now();

        // Update meetings table
        let meeting_update =
            sqlx::query("UPDATE meetings SET title = ?, updated_at = ? WHERE id = ?")
                .bind(new_title)
                .bind(now)
                .bind(meeting_id)
                .execute(&mut *transaction)
                .await?;

        if meeting_update.rows_affected() == 0 {
            transaction.rollback().await?;
            return Ok(false); // Meeting not found
        }

        // Update transcript_chunks table
        sqlx::query("UPDATE transcript_chunks SET meeting_name = ? WHERE meeting_id = ?")
            .bind(new_title)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;

        transaction.commit().await?;
        Ok(true)
    }
}

async fn delete_meeting_with_transaction(
    transaction: &mut SqliteConnection,
    meeting_id: &str,
) -> Result<bool, SqlxError> {
    // Check if meeting exists
    let meeting_exists: Option<(i64,)> = sqlx::query_as("SELECT 1 FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;

    if meeting_exists.is_none() {
        error!("Meeting {} not found for deletion", meeting_id);
        return Ok(false);
    }

    // Delete from related tables in proper order
    // 1. Delete from transcript_chunks
    sqlx::query("DELETE FROM transcript_chunks WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 2. Delete from summary_processes
    sqlx::query("DELETE FROM summary_processes WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 3. Delete from transcripts
    sqlx::query("DELETE FROM transcripts WHERE meeting_id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    // 4. Finally, delete the meeting
    let result = sqlx::query("DELETE FROM meetings WHERE id = ?")
        .bind(meeting_id)
        .execute(&mut *transaction)
        .await?;

    Ok(result.rows_affected() > 0)
}

#[cfg(test)]
mod tests {
    use super::MeetingsRepository;
    use sqlx::SqlitePool;

    #[tokio::test]
    async fn due_retention_moves_a_meeting_to_recoverable_trash() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, folder_path TEXT, project TEXT, pinned_at TEXT, archived_at TEXT, trashed_at TEXT, retention_due_at TEXT)")
            .execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at, retention_due_at) VALUES ('meeting-1', 'Retained', '2026-01-01T00:00:00Z', '2026-01-01T00:00:00Z', '2000-01-01T00:00:00Z')")
            .execute(&pool).await.unwrap();

        assert!(MeetingsRepository::get_meetings(&pool)
            .await
            .unwrap()
            .is_empty());
        let trashed = MeetingsRepository::get_trashed_meetings(&pool)
            .await
            .unwrap();
        assert_eq!(trashed.len(), 1);
        assert_eq!(trashed[0].id, "meeting-1");
    }
}

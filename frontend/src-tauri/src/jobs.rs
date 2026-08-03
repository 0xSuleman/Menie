//! Durable local background jobs for restart-safe processing pipelines.

use serde::{Deserialize, Serialize};
use sqlx::{FromRow, SqlitePool};
use tauri::{AppHandle, Manager, Runtime};
use uuid::Uuid;

use crate::state::AppState;

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobKind {
    Transcription,
    Diarization,
    Summary,
    Indexing,
    Export,
}

impl JobKind {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Transcription => "transcription",
            Self::Diarization => "diarization",
            Self::Summary => "summary",
            Self::Indexing => "indexing",
            Self::Export => "export",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
pub enum JobStatus {
    Queued,
    Running,
    Succeeded,
    Retry,
    Failed,
    Cancelled,
}

impl JobStatus {
    pub const fn as_str(self) -> &'static str {
        match self {
            Self::Queued => "queued",
            Self::Running => "running",
            Self::Succeeded => "succeeded",
            Self::Retry => "retry",
            Self::Failed => "failed",
            Self::Cancelled => "cancelled",
        }
    }
}

#[derive(Debug, Clone)]
pub struct NewJob<'a> {
    pub kind: JobKind,
    pub payload_json: &'a str,
    pub idempotency_key: &'a str,
    pub max_attempts: i64,
}

#[derive(Debug, Clone, Serialize, FromRow)]
pub struct JobRecord {
    pub id: String,
    pub kind: String,
    pub payload_json: String,
    pub status: String,
    pub attempts: i64,
    pub max_attempts: i64,
    pub idempotency_key: String,
    pub last_error: Option<String>,
    pub next_run_at: i64,
    pub created_at: i64,
    pub updated_at: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct DeferredTranscriptionPayload {
    pub meeting_id: String,
    pub recording_folder: String,
}

/// Queue local transcription after a Record Only capture has been saved.
/// The idempotency key makes retries and repeated UI events safe.
#[tauri::command]
pub async fn enqueue_deferred_transcription<R: Runtime>(
    app: AppHandle<R>,
    payload: DeferredTranscriptionPayload,
) -> Result<JobRecord, String> {
    if payload.meeting_id.trim().is_empty() || payload.recording_folder.trim().is_empty() {
        return Err("A saved meeting and recording folder are required".to_string());
    }
    let payload_json = serde_json::to_string(&payload).map_err(|e| e.to_string())?;
    let key = format!("transcription:{}", payload.meeting_id.trim());
    JobRepository::enqueue(
        &app.state::<AppState>().db_manager.pool().clone(),
        NewJob {
            kind: JobKind::Transcription,
            payload_json: &payload_json,
            idempotency_key: &key,
            max_attempts: 3,
        },
    )
    .await
    .map_err(|e| format!("Failed to enqueue deferred transcription: {e}"))
}

#[tauri::command]
pub async fn list_processing_jobs<R: Runtime>(app: AppHandle<R>) -> Result<Vec<JobRecord>, String> {
    sqlx::query_as::<_, JobRecord>(
        "SELECT id, kind, payload_json, status, attempts, max_attempts, idempotency_key, last_error, next_run_at, created_at, updated_at FROM background_jobs ORDER BY created_at DESC LIMIT 100",
    )
    .fetch_all(app.state::<AppState>().db_manager.pool())
    .await
    .map_err(|e| format!("Failed to list processing jobs: {e}"))
}

/// Start the restart-safe local processing loop once the database is ready.
/// Jobs are claimed atomically, so a second process cannot duplicate work.
pub fn spawn_processing_worker<R: Runtime>(app: AppHandle<R>) {
    tauri::async_runtime::spawn(async move {
        loop {
            let claimed = match app.try_state::<AppState>() {
                Some(state) => JobRepository::claim_next(state.db_manager.pool()).await,
                None => Ok(None),
            };
            let Some(job) = (match claimed {
                Ok(job) => job,
                Err(error) => {
                    log::warn!("Processing queue could not claim a job: {error}");
                    None
                }
            }) else {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            };

            let Some(state) = app.try_state::<AppState>() else {
                tokio::time::sleep(std::time::Duration::from_secs(5)).await;
                continue;
            };
            let result: anyhow::Result<()> = match job.kind.as_str() {
                "transcription" => {
                    match serde_json::from_str::<DeferredTranscriptionPayload>(&job.payload_json) {
                        Ok(payload) => crate::audio::retranscription::start_retranscription(
                            app.clone(),
                            payload.meeting_id,
                            payload.recording_folder,
                            None,
                            None,
                            None,
                        )
                        .await
                        .map(|_| ()),
                        Err(error) => Err(anyhow::anyhow!(error.to_string())),
                    }
                }
                _ => Err(anyhow::anyhow!("Unsupported processing job kind")),
            };
            match result {
                Ok(_) => {
                    let _ = JobRepository::succeed(state.db_manager.pool(), &job.id).await;
                }
                Err(error) => {
                    log::warn!("Local processing job failed: {error}");
                    let _ = JobRepository::fail(
                        state.db_manager.pool(),
                        &job.id,
                        &error.to_string(),
                        30,
                    )
                    .await;
                }
            }
        }
    });
}

pub struct JobRepository;

impl JobRepository {
    pub async fn enqueue(pool: &SqlitePool, job: NewJob<'_>) -> Result<JobRecord, sqlx::Error> {
        let id = Uuid::new_v4().to_string();
        sqlx::query("INSERT INTO background_jobs (id, kind, payload_json, idempotency_key, max_attempts) VALUES (?, ?, ?, ?, ?) ON CONFLICT(idempotency_key) DO NOTHING")
            .bind(&id).bind(job.kind.as_str()).bind(job.payload_json).bind(job.idempotency_key).bind(job.max_attempts.max(1)).execute(pool).await?;
        Self::find_by_key(pool, job.idempotency_key).await
    }

    pub async fn find_by_key(pool: &SqlitePool, key: &str) -> Result<JobRecord, sqlx::Error> {
        sqlx::query_as::<_, JobRecord>("SELECT id, kind, payload_json, status, attempts, max_attempts, idempotency_key, last_error, next_run_at, created_at, updated_at FROM background_jobs WHERE idempotency_key = ?")
            .bind(key).fetch_one(pool).await
    }

    pub async fn claim_next(pool: &SqlitePool) -> Result<Option<JobRecord>, sqlx::Error> {
        let mut tx = pool.begin().await?;
        let candidate = sqlx::query_as::<_, JobRecord>("SELECT id, kind, payload_json, status, attempts, max_attempts, idempotency_key, last_error, next_run_at, created_at, updated_at FROM background_jobs WHERE status IN ('queued', 'retry') AND next_run_at <= unixepoch() ORDER BY created_at ASC LIMIT 1")
            .fetch_optional(&mut *tx).await?;
        let Some(candidate) = candidate else {
            tx.commit().await?;
            return Ok(None);
        };
        let updated = sqlx::query("UPDATE background_jobs SET status = 'running', attempts = attempts + 1, updated_at = unixepoch() WHERE id = ? AND status IN ('queued', 'retry')")
            .bind(&candidate.id).execute(&mut *tx).await?;
        if updated.rows_affected() != 1 {
            tx.commit().await?;
            return Ok(None);
        }
        let claimed = sqlx::query_as::<_, JobRecord>("SELECT id, kind, payload_json, status, attempts, max_attempts, idempotency_key, last_error, next_run_at, created_at, updated_at FROM background_jobs WHERE id = ?")
            .bind(&candidate.id).fetch_one(&mut *tx).await?;
        tx.commit().await?;
        Ok(Some(claimed))
    }

    pub async fn succeed(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE background_jobs SET status = 'succeeded', last_error = NULL, updated_at = unixepoch() WHERE id = ?").bind(id).execute(pool).await?;
        Ok(())
    }

    pub async fn fail(
        pool: &SqlitePool,
        id: &str,
        error: &str,
        retry_after_seconds: i64,
    ) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE background_jobs SET status = CASE WHEN attempts >= max_attempts THEN 'failed' ELSE 'retry' END, last_error = ?, next_run_at = unixepoch() + ?, updated_at = unixepoch() WHERE id = ?")
            .bind(error).bind(retry_after_seconds.max(0)).bind(id).execute(pool).await?;
        Ok(())
    }

    pub async fn cancel(pool: &SqlitePool, id: &str) -> Result<(), sqlx::Error> {
        sqlx::query("UPDATE background_jobs SET status = 'cancelled', updated_at = unixepoch() WHERE id = ? AND status IN ('queued', 'retry', 'running')")
            .bind(id)
            .execute(pool)
            .await?;
        Ok(())
    }
}

#[tauri::command]
pub async fn cancel_processing_job<R: Runtime>(
    app: AppHandle<R>,
    job_id: String,
) -> Result<(), String> {
    if job_id.trim().is_empty() {
        return Err("A processing job ID is required".to_string());
    }
    JobRepository::cancel(app.state::<AppState>().db_manager.pool(), job_id.trim())
        .await
        .map_err(|e| format!("Failed to cancel processing job: {e}"))
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn persisted_names_are_stable() {
        assert_eq!(JobKind::Transcription.as_str(), "transcription");
        assert_eq!(JobKind::Export.as_str(), "export");
        assert_eq!(JobStatus::Queued.as_str(), "queued");
        assert_eq!(JobStatus::Failed.as_str(), "failed");
    }

    #[tokio::test]
    async fn enqueue_is_idempotent_for_a_meeting() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE background_jobs (id TEXT PRIMARY KEY, kind TEXT NOT NULL, payload_json TEXT NOT NULL, status TEXT NOT NULL DEFAULT 'queued', attempts INTEGER NOT NULL DEFAULT 0, max_attempts INTEGER NOT NULL DEFAULT 3, idempotency_key TEXT NOT NULL UNIQUE, last_error TEXT, next_run_at INTEGER NOT NULL DEFAULT (unixepoch()), created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()))",
        )
        .execute(&pool)
        .await
        .unwrap();

        let first = JobRepository::enqueue(
            &pool,
            NewJob {
                kind: JobKind::Transcription,
                payload_json: "{\"meeting_id\":\"m1\"}",
                idempotency_key: "transcription:m1",
                max_attempts: 3,
            },
        )
        .await
        .unwrap();
        let second = JobRepository::enqueue(
            &pool,
            NewJob {
                kind: JobKind::Transcription,
                payload_json: "{\"meeting_id\":\"m1\",\"duplicate\":true}",
                idempotency_key: "transcription:m1",
                max_attempts: 3,
            },
        )
        .await
        .unwrap();
        assert_eq!(first.id, second.id);
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM background_jobs")
                .fetch_one(&pool)
                .await
                .unwrap(),
            1
        );
    }
}

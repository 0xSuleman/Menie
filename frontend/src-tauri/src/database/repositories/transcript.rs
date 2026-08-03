use crate::api::{TranscriptSearchResult, TranscriptSegment};
use chrono::Utc;
use sqlx::{Connection, Error as SqlxError, SqlitePool};
use tracing::{error, info};
use uuid::Uuid;

pub struct TranscriptsRepository;

#[derive(Debug, Clone, sqlx::FromRow)]
pub struct TranscriptRevisionRecord {
    pub id: String,
    pub previous_text: String,
    pub revised_text: String,
    pub changed_at: String,
}

impl TranscriptsRepository {
    pub async fn list_segment_revisions(
        pool: &SqlitePool,
        meeting_id: &str,
        transcript_id: &str,
    ) -> Result<Vec<TranscriptRevisionRecord>, SqlxError> {
        sqlx::query_as(
            "SELECT id, previous_text, revised_text, changed_at FROM transcript_revisions WHERE meeting_id = ? AND transcript_id = ? ORDER BY changed_at DESC LIMIT 50",
        )
        .bind(meeting_id)
        .bind(transcript_id)
        .fetch_all(pool)
        .await
    }

    /// Replaces one transcript segment while preserving an immutable local
    /// before/after revision row. The transcript FTS update trigger keeps
    /// search results synchronized with the corrected text.
    pub async fn revise_segment_text(
        pool: &SqlitePool,
        meeting_id: &str,
        transcript_id: &str,
        revised_text: &str,
    ) -> Result<bool, SqlxError> {
        let mut connection = pool.acquire().await?;
        let mut transaction = connection.begin().await?;
        let previous_text = sqlx::query_scalar::<_, String>(
            "SELECT transcript FROM transcripts WHERE id = ? AND meeting_id = ?",
        )
        .bind(transcript_id)
        .bind(meeting_id)
        .fetch_optional(&mut *transaction)
        .await?;
        let Some(previous_text) = previous_text else {
            transaction.rollback().await?;
            return Ok(false);
        };
        if previous_text == revised_text {
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query(
            "INSERT INTO transcript_revisions (id, transcript_id, meeting_id, previous_text, revised_text) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(format!("transcript-revision-{}", Uuid::new_v4()))
        .bind(transcript_id)
        .bind(meeting_id)
        .bind(&previous_text)
        .bind(revised_text)
        .execute(&mut *transaction)
        .await?;
        sqlx::query("UPDATE transcripts SET transcript = ? WHERE id = ? AND meeting_id = ?")
            .bind(revised_text)
            .bind(transcript_id)
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        sqlx::query("UPDATE meetings SET updated_at = ? WHERE id = ?")
            .bind(Utc::now())
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }

    /// Relabels one locally attributed source track in a meeting. The source
    /// filter prevents a correction for one track from changing the other
    /// track's evidence or talk-time totals.
    pub async fn relabel_source_track(
        pool: &SqlitePool,
        meeting_id: &str,
        from_source: &str,
        to_source: &str,
    ) -> Result<u64, SqlxError> {
        let result =
            sqlx::query("UPDATE transcripts SET speaker = ? WHERE meeting_id = ? AND speaker = ?")
                .bind(to_source)
                .bind(meeting_id)
                .bind(from_source)
                .execute(pool)
                .await?;

        Ok(result.rows_affected())
    }

    /// Saves a new meeting and its associated transcript segments.
    /// This function uses a transaction to ensure that either both the meeting
    /// and all its transcripts are saved, or none of them are.
    pub async fn save_transcript(
        pool: &SqlitePool,
        meeting_title: &str,
        transcripts: &[TranscriptSegment],
        folder_path: Option<String>,
    ) -> Result<String, SqlxError> {
        let meeting_id = format!("meeting-{}", Uuid::new_v4());

        let mut conn = pool.acquire().await?;
        let mut transaction = conn.begin().await?;

        let now = Utc::now();

        // 1. Create the new meeting
        let result = sqlx::query(
            "INSERT INTO meetings (id, title, created_at, updated_at, folder_path) VALUES (?, ?, ?, ?, ?)",
        )
        .bind(&meeting_id)
        .bind(meeting_title)
        .bind(now)
        .bind(now)
        .bind(&folder_path)
        .execute(&mut *transaction)
        .await;

        if let Err(e) = result {
            error!("Failed to create meeting '{}': {}", meeting_title, e);
            transaction.rollback().await?;
            return Err(e);
        }

        info!("Successfully created meeting with id: {}", meeting_id);

        // 2. Save each transcript segment with audio timing fields
        for segment in transcripts {
            let transcript_id = format!("transcript-{}", Uuid::new_v4());
            let result = sqlx::query(
                "INSERT INTO transcripts (id, meeting_id, transcript, timestamp, audio_start_time, audio_end_time, duration, speaker)
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?)"
            )
            .bind(&transcript_id)
            .bind(&meeting_id)
            .bind(&segment.text)
            .bind(&segment.timestamp)
            .bind(segment.audio_start_time)
            .bind(segment.audio_end_time)
            .bind(segment.duration)
            .bind(&segment.source)
            .execute(&mut *transaction)
            .await;

            if let Err(e) = result {
                error!(
                    "Failed to save transcript segment for meeting {}: {}",
                    meeting_id, e
                );
                transaction.rollback().await?;
                return Err(e);
            }
        }

        info!(
            "Successfully saved {} transcript segments for meeting {}",
            transcripts.len(),
            meeting_id
        );

        // Commit the transaction
        transaction.commit().await?;

        Ok(meeting_id)
    }

    /// Searches for a query string within the transcripts.
    /// It returns a list of matching transcripts with context.
    pub async fn search_transcripts(
        pool: &SqlitePool,
        query: &str,
    ) -> Result<Vec<TranscriptSearchResult>, SqlxError> {
        if query.trim().is_empty() {
            return Ok(Vec::new());
        }

        if let Some(fts_query) = Self::to_fts_query(query) {
            let fts_rows = sqlx::query_as::<_, (String, String, String, String)>(
                "SELECT m.id, m.title, t.transcript, t.timestamp
                 FROM transcripts_fts f
                 JOIN transcripts t ON t.rowid = f.rowid
                 JOIN meetings m ON m.id = t.meeting_id
                 WHERE transcripts_fts MATCH ? AND m.trashed_at IS NULL
                 ORDER BY rank",
            )
            .bind(fts_query)
            .fetch_all(pool)
            .await?;
            if !fts_rows.is_empty() {
                return Ok(fts_rows
                    .into_iter()
                    .map(
                        |(id, title, transcript, timestamp)| TranscriptSearchResult {
                            id,
                            title,
                            match_context: Self::get_match_context(&transcript, query),
                            timestamp,
                        },
                    )
                    .collect());
            }
        }

        let search_query = format!("%{}%", Self::escape_like_pattern(&query.to_lowercase()));

        let rows = sqlx::query_as::<_, (String, String, String, String)>(
            "SELECT m.id, m.title, t.transcript, t.timestamp
             FROM meetings m
             JOIN transcripts t ON m.id = t.meeting_id
             WHERE m.trashed_at IS NULL AND LOWER(t.transcript) LIKE ? ESCAPE '\\'",
        )
        .bind(&search_query)
        .fetch_all(pool)
        .await?;

        let results = rows
            .into_iter()
            .map(|(id, title, transcript, timestamp)| {
                let match_context = Self::get_match_context(&transcript, query);
                TranscriptSearchResult {
                    id,
                    title,
                    match_context,
                    timestamp,
                }
            })
            .collect();

        Ok(results)
    }

    /// Helper function to extract a snippet of text around the first match of a query.
    fn get_match_context(transcript: &str, query: &str) -> String {
        let transcript_lower = transcript.to_lowercase();
        let query_lower = query.to_lowercase();

        match transcript_lower.find(&query_lower) {
            Some(match_index) => {
                // `find` returns byte indexes. Align both ends to UTF-8
                // character boundaries before slicing so multilingual meetings
                // can always be searched safely.
                let start_index =
                    Self::floor_char_boundary(transcript, match_index.saturating_sub(100));
                let end_index = Self::ceil_char_boundary(
                    transcript,
                    (match_index + query.len() + 100).min(transcript.len()),
                );

                let mut context = String::new();
                if start_index > 0 {
                    context.push_str("...");
                }
                context.push_str(&transcript[start_index..end_index]);
                if end_index < transcript.len() {
                    context.push_str("...");
                }
                context
            }
            None => transcript.chars().take(200).collect(), // Fallback to the start of the transcript
        }
    }

    fn escape_like_pattern(query: &str) -> String {
        query
            .replace('\\', "\\\\")
            .replace('%', "\\%")
            .replace('_', "\\_")
    }

    fn to_fts_query(query: &str) -> Option<String> {
        let terms: Vec<String> = query
            .split(|character: char| !character.is_alphanumeric())
            .filter(|term| term.chars().count() > 1)
            .map(|term| format!("\"{}\"", term.replace('"', "\"\"")))
            .collect();
        (!terms.is_empty()).then(|| terms.join(" AND "))
    }

    fn floor_char_boundary(value: &str, mut index: usize) -> usize {
        index = index.min(value.len());
        while index > 0 && !value.is_char_boundary(index) {
            index -= 1;
        }
        index
    }

    fn ceil_char_boundary(value: &str, mut index: usize) -> usize {
        index = index.min(value.len());
        while index < value.len() && !value.is_char_boundary(index) {
            index += 1;
        }
        index
    }
}

#[cfg(test)]
mod tests {
    use super::TranscriptsRepository;
    use sqlx::SqlitePool;

    #[test]
    fn search_context_is_safe_for_multibyte_text() {
        let transcript = "Before ðŸ‘‹ ä¸–ç•Œ, this is the matching section, and then more context.";
        let context = TranscriptsRepository::get_match_context(transcript, "ä¸–ç•Œ");

        assert!(context.contains("ä¸–ç•Œ"));
    }

    #[test]
    fn like_patterns_treat_user_wildcards_as_literal_text() {
        assert_eq!(
            TranscriptsRepository::escape_like_pattern("100%_complete\\ok"),
            "100\\%\\_complete\\\\ok"
        );
    }

    #[test]
    fn fts_query_uses_literal_terms_and_skips_punctuation_only_input() {
        assert_eq!(
            TranscriptsRepository::to_fts_query("launch-date 2026"),
            Some("\"launch\" AND \"date\" AND \"2026\"".to_string())
        );
        assert_eq!(TranscriptsRepository::to_fts_query("%_!"), None);
    }

    #[tokio::test]
    async fn persistent_fts_search_indexes_and_excludes_trashed_meetings() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query(
            "CREATE TABLE meetings (id TEXT PRIMARY KEY, title TEXT NOT NULL, trashed_at TEXT)",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL, timestamp TEXT NOT NULL)").execute(&pool).await.unwrap();
        sqlx::query("CREATE VIRTUAL TABLE transcripts_fts USING fts5(transcript, meeting_id UNINDEXED, timestamp UNINDEXED)").execute(&pool).await.unwrap();
        sqlx::query(
            "INSERT INTO meetings VALUES ('active', 'Active', NULL), ('trash', 'Trash', 'now')",
        )
        .execute(&pool)
        .await
        .unwrap();
        sqlx::query("INSERT INTO transcripts (id, meeting_id, transcript, timestamp) VALUES ('a', 'active', 'Local launch date is Friday', '10:00'), ('b', 'trash', 'Local launch date is hidden', '11:00')").execute(&pool).await.unwrap();
        sqlx::query("INSERT INTO transcripts_fts (rowid, transcript, meeting_id, timestamp) SELECT rowid, transcript, meeting_id, timestamp FROM transcripts").execute(&pool).await.unwrap();
        let results = TranscriptsRepository::search_transcripts(&pool, "launch date")
            .await
            .unwrap();
        assert_eq!(results.len(), 1);
        assert_eq!(results[0].id, "active");
    }

    #[tokio::test]
    async fn segment_revision_preserves_before_after_history() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE meetings (id TEXT PRIMARY KEY, updated_at TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE transcripts (id TEXT PRIMARY KEY, meeting_id TEXT NOT NULL, transcript TEXT NOT NULL)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("CREATE TABLE transcript_revisions (id TEXT PRIMARY KEY, transcript_id TEXT NOT NULL, meeting_id TEXT NOT NULL, previous_text TEXT NOT NULL, revised_text TEXT NOT NULL, changed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP)")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query("INSERT INTO meetings VALUES ('meeting-1', 'before')")
            .execute(&pool)
            .await
            .unwrap();
        sqlx::query(
            "INSERT INTO transcripts VALUES ('segment-1', 'meeting-1', 'Teh launch is Friday')",
        )
        .execute(&pool)
        .await
        .unwrap();

        assert!(TranscriptsRepository::revise_segment_text(
            &pool,
            "meeting-1",
            "segment-1",
            "The launch is Friday",
        )
        .await
        .unwrap());
        assert_eq!(
            sqlx::query_scalar::<_, String>(
                "SELECT transcript FROM transcripts WHERE id = 'segment-1'"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            "The launch is Friday"
        );
        assert_eq!(
            sqlx::query_as::<_, (String, String)>(
                "SELECT previous_text, revised_text FROM transcript_revisions"
            )
            .fetch_one(&pool)
            .await
            .unwrap(),
            (
                "Teh launch is Friday".to_string(),
                "The launch is Friday".to_string()
            )
        );
    }
}

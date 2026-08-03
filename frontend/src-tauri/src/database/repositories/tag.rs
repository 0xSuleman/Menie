use sqlx::{Connection, Error as SqlxError, SqlitePool};

pub struct TagsRepository;

impl TagsRepository {
    pub async fn get_meeting_tags(
        pool: &SqlitePool,
        meeting_id: &str,
    ) -> Result<Vec<String>, SqlxError> {
        sqlx::query_scalar(
            "SELECT tag_name FROM meeting_tags WHERE meeting_id = ? ORDER BY tag_name COLLATE NOCASE",
        )
        .bind(meeting_id)
        .fetch_all(pool)
        .await
    }

    pub async fn replace_meeting_tags(
        pool: &SqlitePool,
        meeting_id: &str,
        tags: &[String],
    ) -> Result<bool, SqlxError> {
        let mut connection = pool.acquire().await?;
        let mut transaction = connection.begin().await?;
        let exists: Option<String> = sqlx::query_scalar("SELECT id FROM meetings WHERE id = ?")
            .bind(meeting_id)
            .fetch_optional(&mut *transaction)
            .await?;
        if exists.is_none() {
            transaction.rollback().await?;
            return Ok(false);
        }

        sqlx::query("DELETE FROM meeting_tags WHERE meeting_id = ?")
            .bind(meeting_id)
            .execute(&mut *transaction)
            .await?;
        for tag in tags {
            sqlx::query("INSERT OR IGNORE INTO tags (name) VALUES (?)")
                .bind(tag)
                .execute(&mut *transaction)
                .await?;
            sqlx::query("INSERT OR IGNORE INTO meeting_tags (meeting_id, tag_name) VALUES (?, ?)")
                .bind(meeting_id)
                .bind(tag)
                .execute(&mut *transaction)
                .await?;
        }
        sqlx::query("DELETE FROM tags WHERE NOT EXISTS (SELECT 1 FROM meeting_tags WHERE meeting_tags.tag_name = tags.name)")
            .execute(&mut *transaction)
            .await?;
        transaction.commit().await?;
        Ok(true)
    }
}

use sqlx::{Error as SqlxError, SqlitePool};
use uuid::Uuid;

pub struct ProjectVocabularyRepository;

impl ProjectVocabularyRepository {
    pub async fn get_terms(pool: &SqlitePool, project: &str) -> Result<Vec<String>, SqlxError> {
        sqlx::query_scalar("SELECT term FROM project_vocabulary_terms WHERE project = ? ORDER BY term COLLATE NOCASE")
            .bind(project)
            .fetch_all(pool)
            .await
    }

    pub async fn replace_terms(
        pool: &SqlitePool,
        project: &str,
        terms: &[String],
    ) -> Result<Vec<String>, SqlxError> {
        let mut transaction = pool.begin().await?;
        sqlx::query("DELETE FROM project_vocabulary_terms WHERE project = ?")
            .bind(project)
            .execute(&mut *transaction)
            .await?;
        for term in terms {
            sqlx::query("INSERT INTO project_vocabulary_terms (id, project, normalized_term, term) VALUES (?, ?, ?, ?)")
                .bind(format!("vocabulary-{}", Uuid::new_v4()))
                .bind(project)
                .bind(term.to_lowercase())
                .bind(term)
                .execute(&mut *transaction)
                .await?;
        }
        transaction.commit().await?;
        Ok(terms.to_vec())
    }
}

#[cfg(test)]
mod tests {
    use super::ProjectVocabularyRepository;
    use sqlx::SqlitePool;

    #[tokio::test]
    async fn project_vocabulary_replaces_terms_transactionally() {
        let pool = SqlitePool::connect("sqlite::memory:").await.unwrap();
        sqlx::query("CREATE TABLE project_vocabulary_terms (id TEXT PRIMARY KEY, project TEXT NOT NULL, normalized_term TEXT NOT NULL, term TEXT NOT NULL, created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP, UNIQUE(project, normalized_term))")
            .execute(&pool).await.unwrap();
        ProjectVocabularyRepository::replace_terms(&pool, "Launch", &["Menie".into(), "Q3".into()])
            .await
            .unwrap();
        ProjectVocabularyRepository::replace_terms(&pool, "Launch", &["Menie".into()])
            .await
            .unwrap();
        assert_eq!(
            ProjectVocabularyRepository::get_terms(&pool, "Launch")
                .await
                .unwrap(),
            vec!["Menie"]
        );
    }
}

use sha2::{Digest, Sha256};
use sqlx::{
    migrate::{MigrateDatabase, Migrator},
    Result, Sqlite, SqlitePool, Transaction,
};
use std::collections::HashSet;
use std::fs;
use std::path::Path;
use std::path::PathBuf;
use tauri::Manager;

#[derive(Clone)]
pub struct DatabaseManager {
    pool: SqlitePool,
    database_path: PathBuf,
}

impl DatabaseManager {
    pub async fn new(tauri_db_path: &str, backend_db_path: &str) -> Result<Self> {
        if let Some(parent_dir) = Path::new(tauri_db_path).parent() {
            if !parent_dir.exists() {
                fs::create_dir_all(parent_dir).map_err(|e| sqlx::Error::Io(e))?;
            }
        }

        let database_existed = Path::new(tauri_db_path).exists();
        if !database_existed {
            if Path::new(backend_db_path).exists() {
                log::info!(
                    "Copying database from {} to {}",
                    backend_db_path,
                    tauri_db_path
                );
                fs::copy(backend_db_path, tauri_db_path).map_err(|e| sqlx::Error::Io(e))?;
            } else {
                log::info!("Creating database at {}", tauri_db_path);
                Sqlite::create_database(tauri_db_path).await?;
            }
        }

        let pool = SqlitePool::connect(tauri_db_path).await?;
        let migrator = sqlx::migrate!("./migrations");
        if database_existed && Self::has_pending_migrations(&pool, &migrator).await? {
            Self::backup_before_migration(Path::new(tauri_db_path))?;
        }
        migrator.run(&pool).await?;

        Ok(DatabaseManager {
            pool,
            database_path: PathBuf::from(tauri_db_path),
        })
    }

    async fn has_pending_migrations(pool: &SqlitePool, migrator: &Migrator) -> Result<bool> {
        let applied = sqlx::query_scalar::<_, i64>("SELECT version FROM _sqlx_migrations")
            .fetch_all(pool)
            .await
            .unwrap_or_default()
            .into_iter()
            .collect::<HashSet<_>>();

        Ok(migrator
            .iter()
            .any(|migration| !applied.contains(&migration.version)))
    }

    fn backup_before_migration(database_path: &Path) -> Result<()> {
        let backup_path = database_path.with_extension("sqlite.pre-migration.bak");
        fs::copy(database_path, &backup_path).map_err(sqlx::Error::Io)?;
        log::info!(
            "Created pre-migration database backup at {}",
            backup_path.display()
        );
        Ok(())
    }

    // NOTE: So for the first time users they needs to start the application
    // after they can just delete the existing .sqlite file and then copy the existing .db file to
    // the current app dir, So the system detects legacy db and copy it and starts with that data
    // (Newly created .sqlite with the copied content from .db)
    pub async fn new_from_app_handle(app_handle: &tauri::AppHandle) -> Result<Self> {
        // Resolve the app's data directory
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");
        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Define database paths
        let tauri_db_path = app_data_dir
            .join("meeting_minutes.sqlite")
            .to_string_lossy()
            .to_string();
        // Legacy backend DB path (for auto-migration if exists)
        let backend_db_path = app_data_dir
            .join("meeting_minutes.db")
            .to_string_lossy()
            .to_string();

        // WAL file paths for defensive cleanup
        let wal_path = app_data_dir.join("meeting_minutes.sqlite-wal");
        let shm_path = app_data_dir.join("meeting_minutes.sqlite-shm");

        log::info!("Tauri DB path: {}", tauri_db_path);
        log::info!("Legacy backend DB path: {}", backend_db_path);

        // Try to open database with defensive WAL handling
        match Self::new(&tauri_db_path, &backend_db_path).await {
            Ok(db_manager) => {
                log::info!("Database opened successfully");
                Ok(db_manager)
            }
            Err(e) => {
                // Check if error is due to corrupted WAL file
                let error_msg = e.to_string();
                if error_msg.contains("malformed") || error_msg.contains("corrupt") {
                    log::warn!("Database appears corrupted, likely due to orphaned WAL file. Attempting recovery...");
                    log::warn!("Error details: {}", error_msg);

                    // Delete potentially corrupted WAL/SHM files
                    if wal_path.exists() {
                        match fs::remove_file(&wal_path) {
                            Ok(_) => log::info!("Removed orphaned WAL file: {:?}", wal_path),
                            Err(e) => log::warn!("Failed to remove WAL file: {}", e),
                        }
                    }
                    if shm_path.exists() {
                        match fs::remove_file(&shm_path) {
                            Ok(_) => log::info!("Removed orphaned SHM file: {:?}", shm_path),
                            Err(e) => log::warn!("Failed to remove SHM file: {}", e),
                        }
                    }

                    // Retry connection without WAL files
                    log::info!("Retrying database connection after WAL cleanup...");
                    match Self::new(&tauri_db_path, &backend_db_path).await {
                        Ok(db_manager) => {
                            log::info!("Database opened successfully after WAL recovery");
                            Ok(db_manager)
                        }
                        Err(retry_err) => {
                            log::error!(
                                "Database connection failed even after WAL cleanup: {}",
                                retry_err
                            );
                            Err(retry_err)
                        }
                    }
                } else {
                    // Not a WAL-related error, propagate original error
                    log::error!("Database connection failed: {}", error_msg);
                    Err(e)
                }
            }
        }
    }

    /// Check if this is the first launch (sqlite database doesn't exist yet)
    pub async fn is_first_launch(app_handle: &tauri::AppHandle) -> Result<bool> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        let tauri_db_path = app_data_dir.join("meeting_minutes.sqlite");

        Ok(!tauri_db_path.exists())
    }

    /// Import a legacy database from the specified path and initialize
    pub async fn import_legacy_database(
        app_handle: &tauri::AppHandle,
        legacy_db_path: &str,
    ) -> Result<Self> {
        let app_data_dir = app_handle
            .path()
            .app_data_dir()
            .expect("failed to get app data dir");

        if !app_data_dir.exists() {
            fs::create_dir_all(&app_data_dir).map_err(|e| sqlx::Error::Io(e))?;
        }

        // Copy legacy database to app data directory as meeting_minutes.db
        let target_legacy_path = app_data_dir.join("meeting_minutes.db");
        log::info!(
            "Copying legacy database from {} to {}",
            legacy_db_path,
            target_legacy_path.display()
        );

        fs::copy(legacy_db_path, &target_legacy_path).map_err(|e| sqlx::Error::Io(e))?;

        // Now use the standard initialization which will detect and migrate the legacy db
        Self::new_from_app_handle(app_handle).await
    }

    pub fn pool(&self) -> &SqlitePool {
        &self.pool
    }

    /// Create a checkpointed SQLite snapshot and independently verify it before
    /// returning it to the caller. This leaves the live pool open and never
    /// replaces the active library.
    pub async fn create_verified_backup(&self, backup_directory: &Path) -> Result<PathBuf> {
        fs::create_dir_all(backup_directory).map_err(sqlx::Error::Io)?;
        sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await?;

        let filename = format!(
            "meeting_minutes-{}-{}.sqlite",
            chrono::Utc::now().format("%Y%m%dT%H%M%SZ"),
            uuid::Uuid::new_v4().simple()
        );
        let backup_path = backup_directory.join(&filename);
        fs::copy(&self.database_path, &backup_path).map_err(sqlx::Error::Io)?;

        let verification_pool =
            SqlitePool::connect(backup_path.to_str().ok_or_else(|| {
                sqlx::Error::Protocol("Backup path is not valid UTF-8".to_string())
            })?)
            .await?;
        let quick_check: String = sqlx::query_scalar("PRAGMA quick_check")
            .fetch_one(&verification_pool)
            .await?;
        verification_pool.close().await;
        if !quick_check.eq_ignore_ascii_case("ok") {
            return Err(sqlx::Error::Protocol(format!(
                "Backup verification failed: {quick_check}"
            )));
        }

        let digest = format!(
            "{:x}",
            Sha256::digest(&fs::read(&backup_path).map_err(sqlx::Error::Io)?)
        );
        let manifest_path = backup_path.with_extension("sqlite.manifest.json");
        let manifest = format!(
            "{{\"path\":\"{}\",\"sha256\":\"{}\",\"size_bytes\":{}}}",
            filename,
            digest,
            fs::metadata(&backup_path).map_err(sqlx::Error::Io)?.len()
        );
        fs::write(&manifest_path, manifest).map_err(sqlx::Error::Io)?;
        Ok(backup_path)
    }

    pub async fn with_transaction<T, F, Fut>(&self, f: F) -> Result<T>
    where
        F: FnOnce(&mut Transaction<'_, Sqlite>) -> Fut,
        Fut: std::future::Future<Output = Result<T>>,
    {
        let mut tx = self.pool.begin().await?;
        let result = f(&mut tx).await;

        match result {
            Ok(val) => {
                tx.commit().await?;
                Ok(val)
            }
            Err(err) => {
                tx.rollback().await?;
                Err(err)
            }
        }
    }

    /// Cleanup database connection and checkpoint WAL
    /// This should be called on application shutdown to ensure:
    /// - All WAL changes are written to the main database file
    /// - The .wal and .shm files are deleted
    /// - Connection pool is gracefully closed
    pub async fn cleanup(&self) -> Result<()> {
        log::info!("Starting database cleanup...");

        // Force checkpoint of WAL to main database file and remove WAL file
        // TRUNCATE mode: checkpoints all pages AND deletes the WAL file
        match sqlx::query("PRAGMA wal_checkpoint(TRUNCATE)")
            .execute(&self.pool)
            .await
        {
            Ok(_) => log::info!("WAL checkpoint completed successfully"),
            Err(e) => log::warn!("WAL checkpoint failed (non-fatal): {}", e),
        }

        // Close the connection pool gracefully
        self.pool.close().await;
        log::info!("Database connection pool closed");

        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::DatabaseManager;
    use std::fs;

    #[test]
    fn pre_migration_backup_preserves_the_existing_database_bytes() {
        let directory =
            std::env::temp_dir().join(format!("menie-db-backup-{}", uuid::Uuid::new_v4()));
        fs::create_dir_all(&directory).unwrap();
        let database = directory.join("meeting_minutes.sqlite");
        fs::write(&database, b"sqlite fixture").unwrap();

        DatabaseManager::backup_before_migration(&database).unwrap();

        assert_eq!(
            fs::read(database.with_extension("sqlite.pre-migration.bak")).unwrap(),
            b"sqlite fixture"
        );
        fs::remove_dir_all(directory).unwrap();
    }

    #[tokio::test]
    async fn fresh_database_applies_the_complete_local_upgrade_chain() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("meeting_minutes.sqlite");
        let manager = DatabaseManager::new(
            database.to_str().unwrap(),
            directory.path().join("legacy.db").to_str().unwrap(),
        )
        .await
        .unwrap();

        for table in [
            "tags",
            "meeting_tags",
            "outbound_deliveries",
            "audit_events",
            "transcripts_fts",
            "project_vocabulary_terms",
            "transcript_revisions",
            "knowledge_embeddings",
            "meeting_clips",
            "meeting_comments",
            "meeting_attachments",
            "meeting_speaker_labels",
        ] {
            let exists: i64 =
                sqlx::query_scalar("SELECT COUNT(*) FROM sqlite_master WHERE name = ?")
                    .bind(table)
                    .fetch_one(manager.pool())
                    .await
                    .unwrap();
            assert_eq!(exists, 1, "missing migrated structure: {table}");
        }
        let attachment_timestamp: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('meeting_attachments') WHERE name = 'offset_seconds'",
        )
        .fetch_one(manager.pool())
        .await
        .unwrap();
        assert_eq!(
            attachment_timestamp, 1,
            "missing timestamp column on meeting attachments"
        );
        let outbound_policy: i64 = sqlx::query_scalar(
            "SELECT COUNT(*) FROM pragma_table_info('settings') WHERE name = 'allow_outbound_webhooks'",
        )
        .fetch_one(manager.pool())
        .await
        .unwrap();
        assert_eq!(
            outbound_policy, 1,
            "missing local outbound webhook policy column"
        );
    }

    #[tokio::test]
    async fn verified_backup_is_a_readable_sqlite_snapshot() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("meeting_minutes.sqlite");
        let manager = DatabaseManager::new(
            database.to_str().unwrap(),
            directory.path().join("legacy.db").to_str().unwrap(),
        )
        .await
        .unwrap();
        sqlx::query("INSERT INTO meetings (id, title, created_at, updated_at) VALUES ('backup-test', 'Backup test', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)")
            .execute(manager.pool())
            .await
            .unwrap();

        let backup = manager
            .create_verified_backup(&directory.path().join("backups"))
            .await
            .unwrap();
        assert!(backup.exists());
        let backup_pool = sqlx::SqlitePool::connect(backup.to_str().unwrap())
            .await
            .unwrap();
        assert_eq!(
            sqlx::query_scalar::<_, i64>("SELECT COUNT(*) FROM meetings WHERE id = 'backup-test'")
                .fetch_one(&backup_pool)
                .await
                .unwrap(),
            1
        );
        backup_pool.close().await;
    }

    #[tokio::test]
    async fn verified_backups_do_not_overwrite_each_other_when_created_quickly() {
        let directory = tempfile::tempdir().unwrap();
        let database = directory.path().join("meeting_minutes.sqlite");
        let manager = DatabaseManager::new(
            database.to_str().unwrap(),
            directory.path().join("legacy.db").to_str().unwrap(),
        )
        .await
        .unwrap();
        let backup_directory = directory.path().join("backups");

        let first = manager
            .create_verified_backup(&backup_directory)
            .await
            .unwrap();
        let second = manager
            .create_verified_backup(&backup_directory)
            .await
            .unwrap();
        assert_ne!(first, second);
        assert!(first.exists());
        assert!(second.exists());
    }
}

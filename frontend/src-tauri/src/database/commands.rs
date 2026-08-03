use log::{error, info};
use serde::Serialize;
use sha2::{Digest, Sha256};
use std::path::{Path, PathBuf};
use tauri::{AppHandle, Emitter, Manager, State};
use tauri_plugin_store::StoreExt;

use super::manager::DatabaseManager;
use crate::state::AppState;

#[derive(Serialize)]
pub struct DatabaseCheckResult {
    pub exists: bool,
    pub size: u64,
}

#[derive(Serialize)]
pub struct VerifiedBackupResult {
    pub path: String,
    pub verified: bool,
}

#[derive(Serialize)]
pub struct BackupInventoryItem {
    pub path: String,
    pub size_bytes: u64,
    pub modified_at: Option<String>,
    pub verified: bool,
}

/// Create a local SQLite snapshot in the application's backup folder. The
/// database manager checkpoints and verifies the snapshot before this command
/// reports success; no active data is moved or replaced.
#[tauri::command]
pub async fn create_verified_local_backup(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<VerifiedBackupResult, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let backup = state
        .db_manager
        .create_verified_backup(&app_data_dir.join("backups"))
        .await
        .map_err(|error| format!("Could not create a verified local backup: {error}"))?;
    Ok(VerifiedBackupResult {
        path: backup.to_string_lossy().to_string(),
        verified: true,
    })
}

/// Re-check every local SQLite backup without changing the active library.
/// This makes backup integrity visible and catches unreadable snapshots later.
#[tauri::command]
pub async fn verify_local_backups(app: AppHandle) -> Result<Vec<BackupInventoryItem>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let backup_dir = app_data_dir.join("backups");
    if !backup_dir.exists() {
        return Ok(Vec::new());
    }
    let mut entries = tokio::fs::read_dir(&backup_dir)
        .await
        .map_err(|error| format!("Could not read backup directory: {error}"))?;
    let mut result = Vec::new();
    while let Some(entry) = entries
        .next_entry()
        .await
        .map_err(|error| format!("Could not enumerate backups: {error}"))?
    {
        let path = entry.path();
        if path.extension().and_then(|ext| ext.to_str()) != Some("sqlite") {
            continue;
        }
        let metadata = tokio::fs::metadata(&path)
            .await
            .map_err(|error| format!("Could not inspect backup {}: {error}", path.display()))?;
        let verified = match sqlx::SqlitePool::connect(path.to_str().unwrap_or_default()).await {
            Ok(pool) => {
                let quick_ok = sqlx::query_scalar::<_, String>("PRAGMA quick_check")
                    .fetch_one(&pool)
                    .await
                    .map(|value| value.eq_ignore_ascii_case("ok"))
                    .unwrap_or(false);
                pool.close().await;
                let manifest_path = path.with_extension("sqlite.manifest.json");
                let manifest_ok = if !manifest_path.exists() {
                    true
                } else {
                    std::fs::read_to_string(&manifest_path)
                        .ok()
                        .and_then(|value| serde_json::from_str::<serde_json::Value>(&value).ok())
                        .and_then(|manifest| {
                            manifest
                                .get("sha256")
                                .and_then(|value| value.as_str())
                                .map(str::to_owned)
                        })
                        .map(|expected| {
                            std::fs::read(&path)
                                .ok()
                                .map(|bytes| format!("{:x}", Sha256::digest(bytes)) == expected)
                                .unwrap_or(false)
                        })
                        .unwrap_or(false)
                };
                quick_ok && manifest_ok
            }
            Err(_) => false,
        };
        result.push(BackupInventoryItem {
            path: path.to_string_lossy().to_string(),
            size_bytes: metadata.len(),
            modified_at: metadata
                .modified()
                .ok()
                .map(|time| chrono::DateTime::<chrono::Utc>::from(time).to_rfc3339()),
            verified,
        });
    }
    result.sort_by(|left, right| right.modified_at.cmp(&left.modified_at));
    Ok(result)
}

#[derive(Serialize)]
pub struct LibraryRelocationResult {
    pub destination: String,
    pub meetings_moved: u64,
    pub files_verified: u64,
    pub bytes_copied: u64,
}

fn copy_tree_verified(source: &Path, destination: &Path) -> Result<(u64, u64), String> {
    let metadata = std::fs::symlink_metadata(source)
        .map_err(|error| format!("Could not inspect {}: {error}", source.display()))?;
    if metadata.is_file() {
        if let Some(parent) = destination.parent() {
            std::fs::create_dir_all(parent)
                .map_err(|error| format!("Could not create {}: {error}", parent.display()))?;
        }
        let bytes = std::fs::read(source)
            .map_err(|error| format!("Could not read {}: {error}", source.display()))?;
        std::fs::write(destination, &bytes)
            .map_err(|error| format!("Could not write {}: {error}", destination.display()))?;
        let source_hash = format!("{:x}", Sha256::digest(&bytes));
        let copied = std::fs::read(destination)
            .map_err(|error| format!("Could not verify {}: {error}", destination.display()))?;
        if format!("{:x}", Sha256::digest(&copied)) != source_hash {
            return Err(format!(
                "Checksum mismatch while copying {}",
                source.display()
            ));
        }
        return Ok((1, bytes.len() as u64));
    }
    if !metadata.is_dir() {
        return Ok((0, 0));
    }
    std::fs::create_dir_all(destination)
        .map_err(|error| format!("Could not create {}: {error}", destination.display()))?;
    let mut files = 0;
    let mut bytes = 0;
    for entry in std::fs::read_dir(source)
        .map_err(|error| format!("Could not enumerate {}: {error}", source.display()))?
    {
        let entry =
            entry.map_err(|error| format!("Could not enumerate {}: {error}", source.display()))?;
        let (file_count, byte_count) =
            copy_tree_verified(&entry.path(), &destination.join(entry.file_name()))?;
        files += file_count;
        bytes += byte_count;
    }
    Ok((files, bytes))
}

#[tauri::command]
pub async fn relocate_meeting_library(
    destination: String,
    state: State<'_, AppState>,
) -> Result<LibraryRelocationResult, String> {
    let destination = PathBuf::from(destination);
    if destination.as_os_str().is_empty() {
        return Err("A destination folder is required".to_string());
    }
    std::fs::create_dir_all(&destination)
        .map_err(|error| format!("Could not create relocation destination: {error}"))?;
    let stage = destination.join(format!(
        ".menie-relocation-{}",
        uuid::Uuid::new_v4().simple()
    ));
    std::fs::create_dir_all(&stage)
        .map_err(|error| format!("Could not create relocation staging folder: {error}"))?;
    let destination_root = destination
        .canonicalize()
        .map_err(|error| format!("Could not resolve relocation destination: {error}"))?;
    let rows = sqlx::query_as::<_, (String, Option<String>)>(
        "SELECT id, folder_path FROM meetings WHERE folder_path IS NOT NULL",
    )
    .fetch_all(state.db_manager.pool())
    .await
    .map_err(|error| format!("Could not list meeting folders: {error}"))?;
    let meeting_count = rows.len() as u64;
    let mut files_verified = 0;
    let mut bytes_copied = 0;
    let mut updates = Vec::new();
    for (meeting_id, folder_path) in rows {
        let Some(folder_path) = folder_path else {
            continue;
        };
        let source = PathBuf::from(&folder_path);
        if !source.exists() {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(format!(
                "Meeting {meeting_id} source folder is unavailable: {folder_path}"
            ));
        }
        let source_root = source
            .canonicalize()
            .map_err(|error| format!("Could not resolve meeting {meeting_id} source: {error}"))?;
        if source_root.starts_with(&destination_root) {
            let _ = std::fs::remove_dir_all(&stage);
            return Err(
                "Relocation destination cannot be inside an existing meeting folder".to_string(),
            );
        }
        let target = stage.join(&meeting_id);
        let (files, bytes) = match copy_tree_verified(&source_root, &target) {
            Ok(result) => result,
            Err(error) => {
                let _ = std::fs::remove_dir_all(&stage);
                return Err(error);
            }
        };
        files_verified += files;
        bytes_copied += bytes;
        updates.push((meeting_id, target));
    }
    let final_root = destination.join(format!(
        "menie-library-{}",
        chrono::Utc::now().format("%Y%m%dT%H%M%SZ")
    ));
    std::fs::rename(&stage, &final_root)
        .map_err(|error| format!("Could not finalize relocation: {error}"))?;
    let mut tx = state
        .db_manager
        .pool()
        .begin()
        .await
        .map_err(|error| format!("Could not start relocation transaction: {error}"))?;
    for (meeting_id, staged_path) in updates {
        let relative = staged_path
            .strip_prefix(&stage)
            .unwrap_or(Path::new(&meeting_id));
        let new_path = final_root.join(relative).to_string_lossy().to_string();
        sqlx::query(
            "UPDATE meetings SET folder_path = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .bind(new_path)
        .bind(meeting_id)
        .execute(&mut *tx)
        .await
        .map_err(|error| format!("Could not update relocated meeting: {error}"))?;
    }
    tx.commit()
        .await
        .map_err(|error| format!("Could not commit relocation: {error}"))?;
    Ok(LibraryRelocationResult {
        destination: final_root.to_string_lossy().to_string(),
        meetings_moved: meeting_count,
        files_verified,
        bytes_copied,
    })
}
#[derive(Serialize)]
pub struct LocalStorageUsage {
    pub root: String,
    pub media_bytes: u64,
    pub database_bytes: u64,
    pub model_bytes: u64,
    pub index_bytes: u64,
    pub cache_bytes: u64,
    pub trash_bytes: u64,
    pub backup_bytes: u64,
    pub other_bytes: u64,
    pub total_bytes: u64,
}

fn storage_size(path: &std::path::Path) -> u64 {
    let Ok(metadata) = std::fs::symlink_metadata(path) else {
        return 0;
    };
    if metadata.is_file() {
        return metadata.len();
    }
    if !metadata.is_dir() {
        return 0;
    }
    std::fs::read_dir(path)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .map(|entry| storage_size(&entry.path()))
        .sum()
}

#[tauri::command]
pub async fn get_local_storage_usage(app: AppHandle) -> Result<LocalStorageUsage, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let mut usage = LocalStorageUsage {
        root: root.to_string_lossy().to_string(),
        media_bytes: 0,
        database_bytes: 0,
        model_bytes: 0,
        index_bytes: 0,
        cache_bytes: 0,
        trash_bytes: 0,
        backup_bytes: 0,
        other_bytes: 0,
        total_bytes: 0,
    };
    for entry in std::fs::read_dir(&root)
        .map_err(|error| format!("Could not inspect local storage: {error}"))?
    {
        let entry =
            entry.map_err(|error| format!("Could not inspect local storage entry: {error}"))?;
        let path = entry.path();
        let bytes = storage_size(&path);
        let label = path
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default()
            .to_ascii_lowercase();
        match label.as_str() {
            "recordings" | "audio" | "media" => usage.media_bytes += bytes,
            "models" | "model" => usage.model_bytes += bytes,
            "index" | "indexes" | "fts" | "embeddings" => usage.index_bytes += bytes,
            "cache" | "caches" => usage.cache_bytes += bytes,
            "trash" => usage.trash_bytes += bytes,
            "backups" | "backup" => usage.backup_bytes += bytes,
            name if name.ends_with(".sqlite") || name.ends_with(".db") => {
                usage.database_bytes += bytes
            }
            _ => usage.other_bytes += bytes,
        }
    }
    usage.total_bytes = usage.media_bytes
        + usage.database_bytes
        + usage.model_bytes
        + usage.index_bytes
        + usage.cache_bytes
        + usage.trash_bytes
        + usage.backup_bytes
        + usage.other_bytes;
    Ok(usage)
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageCleanupPreview {
    pub recoverable_bytes: u64,
    pub trash_bytes: u64,
    pub cache_bytes: u64,
    pub backup_bytes: u64,
    pub backup_count: u64,
    pub warning: String,
}

#[tauri::command]
pub async fn preview_local_storage_cleanup<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<StorageCleanupPreview, String> {
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let bytes_for = |name: &str| storage_size(&root.join(name));
    let backup_dir = root.join("backups");
    let backup_count = std::fs::read_dir(&backup_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter(|entry| entry.path().extension().and_then(|value| value.to_str()) == Some("sqlite"))
        .count() as u64;
    let trash_bytes = bytes_for("trash");
    let cache_bytes = bytes_for("cache") + bytes_for("caches");
    let backup_bytes = bytes_for("backups") + bytes_for("backup");
    Ok(StorageCleanupPreview {
        recoverable_bytes: trash_bytes + cache_bytes,
        trash_bytes,
        cache_bytes,
        backup_bytes,
        backup_count,
        warning:
            "Preview only: no files are deleted. Backups are never included in recoverable space."
                .to_string(),
    })
}

#[derive(Debug, Clone, Serialize)]
pub struct StorageCleanupResult {
    pub deleted_bytes: u64,
    pub deleted_categories: Vec<String>,
}

fn secure_remove_tree(path: &Path) -> Result<u64, String> {
    let metadata = std::fs::symlink_metadata(path)
        .map_err(|error| format!("Could not inspect {}: {error}", path.display()))?;
    if metadata.is_file() {
        let length = metadata.len();
        let mut file = std::fs::OpenOptions::new()
            .write(true)
            .open(path)
            .map_err(|error| {
                format!(
                    "Could not open {} for secure cleanup: {error}",
                    path.display()
                )
            })?;
        let zeroes = vec![0u8; 1024 * 1024];
        let mut remaining = length;
        while remaining > 0 {
            let count = remaining.min(zeroes.len() as u64) as usize;
            std::io::Write::write_all(&mut file, &zeroes[..count])
                .map_err(|error| format!("Could not overwrite {}: {error}", path.display()))?;
            remaining -= count as u64;
        }
        std::io::Write::flush(&mut file).map_err(|error| {
            format!(
                "Could not flush secure cleanup for {}: {error}",
                path.display()
            )
        })?;
        drop(file);
        std::fs::remove_file(path)
            .map_err(|error| format!("Could not remove {}: {error}", path.display()))?;
        return Ok(length);
    }
    if metadata.is_dir() {
        let mut bytes = 0;
        for entry in std::fs::read_dir(path)
            .map_err(|error| format!("Could not enumerate {}: {error}", path.display()))?
        {
            bytes += secure_remove_tree(&entry.map_err(|error| error.to_string())?.path())?;
        }
        std::fs::remove_dir(path)
            .map_err(|error| format!("Could not remove {}: {error}", path.display()))?;
        return Ok(bytes);
    }
    std::fs::remove_file(path)
        .map_err(|error| format!("Could not remove {}: {error}", path.display()))?;
    Ok(0)
}

#[tauri::command]
pub async fn secure_cleanup_local_storage<R: tauri::Runtime>(
    app: AppHandle<R>,
    confirm: bool,
) -> Result<StorageCleanupResult, String> {
    if !confirm {
        return Err(
            "Secure cleanup requires explicit confirmation after reviewing the preview".to_string(),
        );
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let mut deleted_bytes = 0;
    let mut deleted_categories = Vec::new();
    for category in ["trash", "cache", "caches"] {
        let path = root.join(category);
        if path.exists() {
            deleted_bytes += secure_remove_tree(&path)?;
            deleted_categories.push(category.to_string());
        }
    }
    Ok(StorageCleanupResult {
        deleted_bytes,
        deleted_categories,
    })
}
#[tauri::command]
pub async fn cleanup_local_storage<R: tauri::Runtime>(
    app: AppHandle<R>,
    confirm: bool,
) -> Result<StorageCleanupResult, String> {
    if !confirm {
        return Err(
            "Cleanup requires explicit confirmation after reviewing the preview".to_string(),
        );
    }
    let root = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let mut deleted_bytes = 0;
    let mut deleted_categories = Vec::new();
    for category in ["trash", "cache", "caches"] {
        let path = root.join(category);
        if path.exists() {
            deleted_bytes += storage_size(&path);
            std::fs::remove_dir_all(&path)
                .map_err(|error| format!("Could not clean {category}: {error}"))?;
            deleted_categories.push(category.to_string());
        }
    }
    Ok(StorageCleanupResult {
        deleted_bytes,
        deleted_categories,
    })
}

#[derive(Debug, Clone, Serialize, serde::Deserialize)]
pub struct LocalBackupSchedule {
    pub enabled: bool,
    pub interval_hours: u32,
}

impl Default for LocalBackupSchedule {
    fn default() -> Self {
        Self {
            enabled: false,
            interval_hours: 24,
        }
    }
}

#[tauri::command]
pub fn get_local_backup_schedule<R: tauri::Runtime>(
    app: AppHandle<R>,
) -> Result<LocalBackupSchedule, String> {
    let store = app
        .store("local-backup-settings.json")
        .map_err(|error| format!("Could not open local backup settings: {error}"))?;
    Ok(store
        .get("schedule")
        .and_then(|value| serde_json::from_value(value.clone()).ok())
        .unwrap_or_default())
}

#[tauri::command]
pub fn set_local_backup_schedule<R: tauri::Runtime>(
    app: AppHandle<R>,
    schedule: LocalBackupSchedule,
) -> Result<LocalBackupSchedule, String> {
    if !(1..=720).contains(&schedule.interval_hours) {
        return Err("Backup interval must be between 1 and 720 hours".to_string());
    }
    let store = app
        .store("local-backup-settings.json")
        .map_err(|error| format!("Could not open local backup settings: {error}"))?;
    store.set(
        "schedule",
        serde_json::to_value(&schedule)
            .map_err(|error| format!("Could not encode backup settings: {error}"))?,
    );
    store
        .save()
        .map_err(|error| format!("Could not save local backup settings: {error}"))?;
    Ok(schedule)
}

/// Run an opt-in backup only when the configured interval has elapsed.
pub async fn run_scheduled_local_backup<R: tauri::Runtime>(
    app: &AppHandle<R>,
    state: &AppState,
) -> Result<(), String> {
    let schedule = get_local_backup_schedule(app.clone())?;
    if !schedule.enabled {
        return Ok(());
    }
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|error| format!("Failed to locate local application data: {error}"))?;
    let backup_dir = app_data_dir.join("backups");
    let latest = std::fs::read_dir(&backup_dir)
        .ok()
        .into_iter()
        .flatten()
        .filter_map(Result::ok)
        .filter_map(|entry| entry.metadata().ok())
        .filter_map(|metadata| metadata.modified().ok())
        .max();
    let due = latest
        .map(|time| {
            time.elapsed()
                .map(|elapsed| elapsed.as_secs() >= u64::from(schedule.interval_hours) * 3600)
                .unwrap_or(true)
        })
        .unwrap_or(true);
    if due {
        state
            .db_manager
            .create_verified_backup(&backup_dir)
            .await
            .map_err(|error| format!("Scheduled local backup failed: {error}"))?;
    }
    Ok(())
}
/// Check if this is the first launch (no database exists yet)
#[tauri::command]
pub async fn check_first_launch(app: AppHandle) -> Result<bool, String> {
    DatabaseManager::is_first_launch(&app)
        .await
        .map_err(|e| format!("Failed to check first launch: {}", e))
}

/// Open a dialog to select a folder or file for legacy database import
#[tauri::command]
pub async fn select_legacy_database_path(app: AppHandle) -> Result<Option<String>, String> {
    use tauri_plugin_dialog::DialogExt;

    info!("Opening dialog to select legacy database location");

    let file_path = app
        .dialog()
        .file()
        .add_filter("Database Files", &["db"])
        .blocking_pick_file();

    if let Some(path) = file_path {
        let path_str = path.to_string();
        info!("User selected path: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("User cancelled file selection");
        Ok(None)
    }
}

/// Detect legacy database from a selected path (root repo, backend folder, or db file)
#[tauri::command]
pub async fn detect_legacy_database(selected_path: String) -> Result<Option<String>, String> {
    let path = PathBuf::from(&selected_path);

    info!("Detecting legacy database from path: {}", selected_path);

    // Case 1: User selected the .db file directly
    if path.is_file() {
        if let Some(extension) = path.extension() {
            if extension == "db" {
                info!("Direct .db file selected: {}", selected_path);
                return Ok(Some(selected_path));
            }
        }
    }

    // Case 2: User selected directory containing meeting_minutes.db
    if path.is_dir() {
        let direct_db = path.join("meeting_minutes.db");
        if direct_db.exists() && direct_db.is_file() {
            let db_path = direct_db.to_string_lossy().to_string();
            info!("Found database in selected directory: {}", db_path);
            return Ok(Some(db_path));
        }

        // Case 3: User selected root repo (check backend subdirectory)
        let backend_db = path.join("backend").join("meeting_minutes.db");
        if backend_db.exists() && backend_db.is_file() {
            let db_path = backend_db.to_string_lossy().to_string();
            info!("Found database in backend subdirectory: {}", db_path);
            return Ok(Some(db_path));
        }
    }

    info!("No legacy database found at path: {}", selected_path);
    Ok(None)
}

/// Check for legacy database in the default app data directory
#[tauri::command]
pub async fn check_default_legacy_database(app: AppHandle) -> Result<Option<String>, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    let legacy_db = app_data_dir.join("meeting_minutes.db");
    info!("Checking for default legacy database at: {:?}", legacy_db);

    if legacy_db.exists() && legacy_db.is_file() {
        let path_str = legacy_db.to_string_lossy().to_string();
        info!("Found default legacy database: {}", path_str);
        Ok(Some(path_str))
    } else {
        info!("No default legacy database found");
        Ok(None)
    }
}

/// Check if the Homebrew database exists and return its size
/// This is specifically for detecting old Python backend installations
#[tauri::command]
pub async fn check_homebrew_database(path: String) -> Result<Option<DatabaseCheckResult>, String> {
    let db_path = PathBuf::from(&path);

    info!("Checking for Homebrew database at: {}", path);

    // Check if file exists and is a regular file
    if db_path.exists() && db_path.is_file() {
        // Get file metadata to check size
        match std::fs::metadata(&db_path) {
            Ok(metadata) => {
                let size = metadata.len();
                info!("Found Homebrew database: {} ({} bytes)", path, size);

                // Only consider it valid if it has content (not empty)
                if size > 0 {
                    Ok(Some(DatabaseCheckResult { exists: true, size }))
                } else {
                    info!("Database file exists but is empty");
                    Ok(None)
                }
            }
            Err(e) => {
                error!("Failed to read database metadata: {}", e);
                Ok(None)
            }
        }
    } else {
        info!("No database found at Homebrew location");
        Ok(None)
    }
}

/// Import legacy database and initialize the database manager
#[tauri::command]
pub async fn import_and_initialize_database(
    app: AppHandle,
    legacy_db_path: String,
) -> Result<(), String> {
    info!(
        "Starting import of legacy database from: {}",
        legacy_db_path
    );

    // Import and get initialized manager
    let db_manager = DatabaseManager::import_legacy_database(&app, &legacy_db_path)
        .await
        .map_err(|e| {
            error!("Failed to import legacy database: {}", e);
            format!("Failed to import database: {}", e)
        })?;

    // Update app state with the new manager
    app.manage(AppState { db_manager });

    info!("Legacy database imported and initialized successfully");

    // Emit event to notify frontend that database is ready
    app.emit("database-initialized", ())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Initialize a fresh database (for users who don't want to import)
#[tauri::command]
pub async fn initialize_fresh_database(app: AppHandle) -> Result<(), String> {
    info!("Initializing fresh database");

    let db_manager = DatabaseManager::new_from_app_handle(&app)
        .await
        .map_err(|e| {
            error!("Failed to initialize fresh database: {}", e);
            format!("Failed to initialize database: {}", e)
        })?;

    // Update app state with the new manager
    app.manage(AppState {
        db_manager: db_manager.clone(),
    });

    // Set default model configuration for fresh installs
    let pool = db_manager.pool();

    let default_summary_model =
        crate::summary::summary_engine::commands::get_recommended_summary_model_for_current_system(
        )
        .unwrap_or("qwen3.5:2b");

    // Default Summary Model: Built-in AI (Qwen recommendation for this system)
    if let Err(e) = crate::database::repositories::setting::SettingsRepository::save_model_config(
        pool,
        "builtin-ai",
        default_summary_model,
        "large-v3", // Default whisper model (unused for builtin but required)
        None,
    )
    .await
    {
        error!("Failed to set default summary model config: {}", e);
    }

    // Default Transcription Model: Parakeet
    if let Err(e) =
        crate::database::repositories::setting::SettingsRepository::save_transcript_config(
            pool,
            "parakeet",
            crate::config::DEFAULT_PARAKEET_MODEL,
        )
        .await
    {
        error!("Failed to set default transcription model config: {}", e);
    }

    info!("Fresh database initialized successfully with default models");

    // Emit event to notify frontend that database is ready
    app.emit("database-initialized", ())
        .map_err(|e| format!("Failed to emit database-initialized event: {}", e))?;

    Ok(())
}

/// Get the database directory path
#[tauri::command]
pub async fn get_database_directory(app: AppHandle) -> Result<String, String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    Ok(app_data_dir.to_string_lossy().to_string())
}

/// Open the database folder in the system file explorer
#[tauri::command]
pub async fn open_database_folder(app: AppHandle) -> Result<(), String> {
    let app_data_dir = app
        .path()
        .app_data_dir()
        .map_err(|e| format!("Failed to get app data dir: {}", e))?;

    // Ensure directory exists before trying to open it
    if !app_data_dir.exists() {
        std::fs::create_dir_all(&app_data_dir)
            .map_err(|e| format!("Failed to create directory: {}", e))?;
    }

    let folder_path = app_data_dir.to_string_lossy().to_string();

    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&folder_path)
            .spawn()
            .map_err(|e| format!("Failed to open folder: {}", e))?;
    }

    info!("Opened database folder: {}", folder_path);
    Ok(())
}

#[cfg(test)]
mod relocation_tests {
    use super::{copy_tree_verified, secure_remove_tree};
    use std::fs;

    #[test]
    fn relocation_copy_verifies_nested_files_and_bytes() {
        let root = tempfile::tempdir().unwrap();
        let source = root.path().join("source");
        let destination = root.path().join("destination");
        fs::create_dir_all(source.join("nested")).unwrap();
        fs::write(source.join("audio.mp4"), b"audio bytes").unwrap();
        fs::write(source.join("nested/transcript.json"), b"transcript bytes").unwrap();
        let (files, bytes) = copy_tree_verified(&source, &destination).unwrap();
        assert_eq!(files, 2);
        assert_eq!(
            bytes,
            b"audio bytes".len() as u64 + b"transcript bytes".len() as u64
        );
        assert_eq!(
            fs::read(destination.join("nested/transcript.json")).unwrap(),
            b"transcript bytes"
        );
    }
    #[test]
    fn secure_cleanup_overwrites_and_removes_nested_files() {
        let root = tempfile::tempdir().unwrap();
        let target = root.path().join("trash");
        fs::create_dir_all(target.join("nested")).unwrap();
        fs::write(target.join("nested/payload.txt"), b"sensitive local text").unwrap();
        let bytes = secure_remove_tree(&target).unwrap();
        assert_eq!(bytes, b"sensitive local text".len() as u64);
        assert!(!target.exists());
    }
}

"use client";

import { useEffect, useState, useRef } from "react";
import { Switch } from "./ui/switch";
import { FolderOpen } from "lucide-react";
import { invoke } from "@tauri-apps/api/core";
import Analytics from "@/lib/analytics";
import { LocalPrivacyReport } from "./LocalPrivacyReport";
import { LocalHealthReport } from "./LocalHealthReport";
import { AppLanguageSettings } from "./AppLanguageSettings";
import { LocalDiagnosticsBundle } from "./LocalDiagnosticsBundle";
import { RecordingNoticeSettings } from "./RecordingNoticeSettings";
import { ThemeSettings } from "./ThemeSettings";
import { useConfig, NotificationSettings } from "@/contexts/ConfigContext";

export function PreferenceSettings() {
  const {
    notificationSettings,
    storageLocations,
    isLoadingPreferences,
    loadPreferences,
    updateNotificationSettings,
  } = useConfig();

  const [notificationsEnabled, setNotificationsEnabled] = useState<
    boolean | null
  >(null);
  const [isInitialLoad, setIsInitialLoad] = useState(true);
  const [previousNotificationsEnabled, setPreviousNotificationsEnabled] =
    useState<boolean | null>(null);
  const [backupState, setBackupState] = useState<{
    creating: boolean;
    message: string | null;
    error: string | null;
  }>({ creating: false, message: null, error: null });
  const [backupVerification, setBackupVerification] = useState<{
    checked: number;
    valid: number;
    error: string | null;
  }>({ checked: 0, valid: 0, error: null });
  const [storageUsage, setStorageUsage] = useState<{
    media_bytes: number;
    database_bytes: number;
    model_bytes: number;
    index_bytes: number;
    cache_bytes: number;
    trash_bytes: number;
    backup_bytes: number;
    other_bytes: number;
    total_bytes: number;
  } | null>(null);
  const [cleanupPreview, setCleanupPreview] = useState<{
    recoverable_bytes: number;
    trash_bytes: number;
    cache_bytes: number;
    backup_bytes: number;
    backup_count: number;
    warning: string;
  } | null>(null);
  const [backupSchedule, setBackupSchedule] = useState({
    enabled: false,
    interval_hours: 24,
  });
  const [outboundWebhooksEnabled, setOutboundWebhooksEnabled] = useState(true);
  const hasTrackedViewRef = useRef(false);

  // Lazy load preferences on mount (only loads if not already cached)
  useEffect(() => {
    loadPreferences();
    void loadBackupSchedule();
    void invoke<boolean>("api_get_outbound_webhook_policy")
      .then(setOutboundWebhooksEnabled)
      .catch(() => undefined);
    // Reset tracking ref on mount (every tab visit)
    hasTrackedViewRef.current = false;
  }, [loadPreferences]);

  // Track preferences viewed analytics on every tab visit (once per mount)
  useEffect(() => {
    if (hasTrackedViewRef.current) return;

    const trackPreferencesViewed = async () => {
      // Wait for notification settings to be available (either from cache or after loading)
      if (notificationSettings) {
        await Analytics.track("preferences_viewed", {
          notifications_enabled: notificationSettings.notification_preferences
            .show_recording_started
            ? "true"
            : "false",
        });
        hasTrackedViewRef.current = true;
      } else if (!isLoadingPreferences) {
        // If not loading and no settings available, track with default value
        await Analytics.track("preferences_viewed", {
          notifications_enabled: "false",
        });
        hasTrackedViewRef.current = true;
      }
    };

    trackPreferencesViewed();
  }, [notificationSettings, isLoadingPreferences]);

  // Update notificationsEnabled when notificationSettings are loaded from global state
  useEffect(() => {
    if (notificationSettings) {
      // Notification enabled means both started and stopped notifications are enabled
      const enabled =
        notificationSettings.notification_preferences.show_recording_started &&
        notificationSettings.notification_preferences.show_recording_stopped;
      setNotificationsEnabled(enabled);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(enabled);
        setIsInitialLoad(false);
      }
    } else if (!isLoadingPreferences) {
      // If not loading and no settings, use default
      setNotificationsEnabled(true);
      if (isInitialLoad) {
        setPreviousNotificationsEnabled(true);
        setIsInitialLoad(false);
      }
    }
  }, [notificationSettings, isLoadingPreferences, isInitialLoad]);

  useEffect(() => {
    // Skip update on initial load or if value hasn't actually changed
    if (
      isInitialLoad ||
      notificationsEnabled === null ||
      notificationsEnabled === previousNotificationsEnabled
    )
      return;
    if (!notificationSettings) return;

    const handleUpdateNotificationSettings = async () => {
      console.log("Updating notification settings to:", notificationsEnabled);

      try {
        // Update the notification preferences
        const updatedSettings: NotificationSettings = {
          ...notificationSettings,
          notification_preferences: {
            ...notificationSettings.notification_preferences,
            show_recording_started: notificationsEnabled,
            show_recording_stopped: notificationsEnabled,
          },
        };

        console.log(
          "Calling updateNotificationSettings with:",
          updatedSettings,
        );
        await updateNotificationSettings(updatedSettings);
        setPreviousNotificationsEnabled(notificationsEnabled);
        console.log(
          "Successfully updated notification settings to:",
          notificationsEnabled,
        );

        // Track notification preference change - only fires when user manually toggles
        await Analytics.track("notification_settings_changed", {
          notifications_enabled: notificationsEnabled.toString(),
        });
      } catch (error) {
        console.error("Failed to update notification settings:", error);
      }
    };

    handleUpdateNotificationSettings();
  }, [
    notificationsEnabled,
    notificationSettings,
    isInitialLoad,
    previousNotificationsEnabled,
    updateNotificationSettings,
  ]);

  const handleOpenFolder = async (
    folderType: "database" | "models" | "recordings",
  ) => {
    try {
      switch (folderType) {
        case "database":
          await invoke("open_database_folder");
          break;
        case "models":
          await invoke("open_models_folder");
          break;
        case "recordings":
          await invoke("open_recordings_folder");
          break;
      }

      // Track storage folder access
      await Analytics.track("storage_folder_opened", {
        folder_type: folderType,
      });
    } catch (error) {
      console.error(`Failed to open ${folderType} folder:`, error);
    }
  };

  const handleCreateVerifiedBackup = async () => {
    setBackupState({ creating: true, message: null, error: null });
    try {
      const result = await invoke<{ path: string; verified: boolean }>(
        "create_verified_local_backup",
      );
      setBackupState({
        creating: false,
        message: `Verified local backup created: ${result.path}`,
        error: null,
      });
    } catch (error) {
      setBackupState({
        creating: false,
        message: null,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const handleVerifyBackups = async () => {
    try {
      const items = await invoke<Array<{ verified: boolean }>>(
        "verify_local_backups",
      );
      setBackupVerification({
        checked: items.length,
        valid: items.filter((item) => item.verified).length,
        error: null,
      });
    } catch (error) {
      setBackupVerification({
        checked: 0,
        valid: 0,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  };

  const loadBackupSchedule = async () => {
    try {
      setBackupSchedule(
        await invoke<{ enabled: boolean; interval_hours: number }>(
          "get_local_backup_schedule",
        ),
      );
    } catch (error) {
      console.error("Failed to load backup schedule:", error);
    }
  };

  const updateBackupSchedule = async (next: {
    enabled: boolean;
    interval_hours: number;
  }) => {
    try {
      setBackupSchedule(
        await invoke<typeof next>("set_local_backup_schedule", {
          schedule: next,
        }),
      );
    } catch (error) {
      console.error("Failed to save backup schedule:", error);
    }
  };
  const handleCleanupStorage = async () => {
    if (
      !window.confirm(
        "Permanently delete local trash and cache files? Backups and recordings are not affected.",
      )
    )
      return;
    try {
      const result = await invoke<{
        deleted_bytes: number;
        deleted_categories: string[];
      }>("cleanup_local_storage", { confirm: true });
      setCleanupPreview(null);
      setBackupState((current) => ({
        ...current,
        message: `Deleted ${(result.deleted_bytes / 1024 / 1024).toFixed(1)} MB from ${result.deleted_categories.join(", ") || "local cleanup"}.`,
      }));
    } catch (error) {
      setBackupState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  const handleSecureCleanupStorage = async () => {
    if (
      !window.confirm(
        "Securely overwrite and delete local trash/cache files? This cannot be undone. Backups, recordings, and models are not affected.",
      )
    )
      return;
    try {
      const result = await invoke<{
        deleted_bytes: number;
        deleted_categories: string[];
      }>("secure_cleanup_local_storage", { confirm: true });
      setCleanupPreview(null);
      setBackupState((current) => ({
        ...current,
        message: `Secure cleanup overwrote and deleted ${(result.deleted_bytes / 1024 / 1024).toFixed(1)} MB from ${result.deleted_categories.join(", ") || "local cleanup"}.`,
      }));
    } catch (error) {
      setBackupState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  const handleOutboundWebhookPolicy = async (enabled: boolean) => {
    try {
      setOutboundWebhooksEnabled(
        await invoke<boolean>("api_set_outbound_webhook_policy", { enabled }),
      );
    } catch (error) {
      setBackupState((current) => ({
        ...current,
        error: error instanceof Error ? error.message : String(error),
      }));
    }
  };
  const handlePreviewCleanup = async () => {
    try {
      setCleanupPreview(
        await invoke<typeof cleanupPreview>("preview_local_storage_cleanup"),
      );
    } catch (error) {
      console.error("Failed to preview storage cleanup:", error);
    }
  };
  const handleRefreshStorageUsage = async () => {
    try {
      setStorageUsage(
        await invoke<typeof storageUsage>("get_local_storage_usage"),
      );
    } catch (error) {
      console.error("Failed to inspect local storage usage:", error);
    }
  };

  // Show loading only if we're actually loading and don't have cached data
  if (isLoadingPreferences && !notificationSettings && !storageLocations) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>;
  }

  // Show loading if notificationsEnabled hasn't been determined yet
  if (notificationsEnabled === null && !isLoadingPreferences) {
    return <div className="max-w-2xl mx-auto p-6">Loading Preferences...</div>;
  }

  // Ensure we have a boolean value for the Switch component
  const notificationsEnabledValue = notificationsEnabled ?? false;

  return (
    <div className="space-y-6">
      {/* Notifications Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-lg font-semibold text-gray-900 mb-2">
              Notifications
            </h3>
            <p className="text-sm text-gray-600">
              Enable or disable notifications of start and end of meeting
            </p>
          </div>
          <Switch
            checked={notificationsEnabledValue}
            onCheckedChange={setNotificationsEnabled}
          />
        </div>
      </div>

      {/* Data Storage Locations Section */}
      <div className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm">
        <h3 className="text-lg font-semibold text-gray-900 mb-4">
          Data Storage Locations
        </h3>
        <p className="text-sm text-gray-600 mb-6">
          View and access where Menie stores your data
        </p>

        <div className="space-y-4">
          {/* Database Location */}
          {/* <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Database</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.database || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('database')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Models Location */}
          {/* <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Whisper Models</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.models || 'Loading...'}
            </div>
            <button
              onClick={() => handleOpenFolder('models')}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div> */}

          {/* Recordings Location */}
          <div className="p-4 border rounded-lg bg-gray-50">
            <div className="font-medium mb-2">Meeting Recordings</div>
            <div className="text-sm text-gray-600 mb-3 break-all font-mono text-xs">
              {storageLocations?.recordings || "Loading..."}
            </div>
            <button
              onClick={() => handleOpenFolder("recordings")}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-gray-300 rounded-md hover:bg-gray-100 transition-colors"
            >
              <FolderOpen className="w-4 h-4" />
              Open Folder
            </button>
          </div>
        </div>

        <div className="mt-4 p-3 bg-blue-50 rounded-md">
          <p className="text-xs text-blue-800">
            <strong>Note:</strong> Database and models are stored together in
            your application data directory for unified management.
          </p>
        </div>
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-gray-900">
                Local storage usage
              </p>
              <p className="text-xs text-gray-600">
                Content-free byte counts from the local application data
                directory.
              </p>
            </div>
            <button
              type="button"
              onClick={handlePreviewCleanup}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Preview cleanup
            </button>
            <button
              type="button"
              onClick={handleRefreshStorageUsage}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Refresh
            </button>
          </div>{" "}
          <div className="mt-3 flex items-center justify-between gap-3 rounded border border-slate-200 bg-slate-50 px-3 py-2">
            <div>
              <p className="text-sm font-medium text-slate-900">
                Approved outbound webhooks
              </p>
              <p className="text-xs text-slate-600">
                Disable the only network workflow; local recording,
                transcription, exports, and backups remain available.
              </p>
            </div>
            <Switch
              checked={outboundWebhooksEnabled}
              onCheckedChange={handleOutboundWebhookPolicy}
              aria-label="Allow approved outbound webhooks"
            />
          </div>
          {cleanupPreview && (
            <div className="mt-2 flex items-center gap-3">
              <button
                type="button"
                onClick={handleCleanupStorage}
                className="rounded-md border border-red-300 px-2 py-1 text-xs font-medium text-red-700 hover:bg-red-50"
              >
                Delete trash/cache
              </button>
              <button
                type="button"
                onClick={handleSecureCleanupStorage}
                className="rounded-md border border-red-500 px-2 py-1 text-xs font-medium text-red-800 hover:bg-red-100"
              >
                Secure cleanup
              </button>
              <p className="text-xs text-gray-600" role="status">
                Cleanup could reclaim{" "}
                {(cleanupPreview.recoverable_bytes / 1024 / 1024).toFixed(1)} MB
                from trash/cache. {cleanupPreview.backup_count} verified backup
                snapshots (
                {(cleanupPreview.backup_bytes / 1024 / 1024).toFixed(1)} MB) are
                preserved. {cleanupPreview.warning}
              </p>
            </div>
          )}
          {storageUsage && (
            <div className="mt-3 grid grid-cols-2 gap-2 text-xs text-gray-700">
              {(
                [
                  ["Media", storageUsage.media_bytes],
                  ["Database", storageUsage.database_bytes],
                  ["Models", storageUsage.model_bytes],
                  ["Indexes", storageUsage.index_bytes],
                  ["Cache", storageUsage.cache_bytes],
                  ["Trash", storageUsage.trash_bytes],
                  ["Backups", storageUsage.backup_bytes],
                  ["Other", storageUsage.other_bytes],
                ] as const
              ).map(([label, bytes]) => (
                <div
                  key={label}
                  className="flex justify-between rounded bg-gray-50 px-2 py-1"
                >
                  <span>{label}</span>
                  <span>{(bytes / 1024 / 1024).toFixed(1)} MB</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="mt-4 rounded-md border border-gray-200 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="mt-4 rounded-md border border-gray-200 p-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium text-gray-900">
                    Scheduled local backups
                  </p>
                  <p className="text-xs text-gray-600">
                    When enabled, startup creates a verified SQLite snapshot
                    after the selected interval.
                  </p>
                </div>
                <label className="flex items-center gap-2 text-sm text-gray-800">
                  <input
                    type="checkbox"
                    checked={backupSchedule.enabled}
                    onChange={(event) =>
                      void updateBackupSchedule({
                        ...backupSchedule,
                        enabled: event.target.checked,
                      })
                    }
                  />
                  Enable
                </label>
              </div>
              <label className="mt-3 flex items-center gap-2 text-xs text-gray-700">
                Every
                <input
                  type="number"
                  min={1}
                  max={720}
                  value={backupSchedule.interval_hours}
                  onChange={(event) =>
                    setBackupSchedule({
                      ...backupSchedule,
                      interval_hours: Number(event.target.value) || 24,
                    })
                  }
                  onBlur={() => void updateBackupSchedule(backupSchedule)}
                  className="w-20 rounded border border-gray-300 px-2 py-1"
                />
                hours
              </label>
            </div>
            <div>
              <p className="text-sm font-medium text-gray-900">
                Verified local backup
              </p>
              <p className="text-xs text-gray-600">
                Creates a checkpointed SQLite snapshot and runs an integrity
                check before reporting success.
              </p>
            </div>
            <button
              type="button"
              onClick={handleCreateVerifiedBackup}
              disabled={backupState.creating}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50 disabled:opacity-50"
            >
              {backupState.creating
                ? "Creating backup…"
                : "Create verified backup"}
            </button>
            <button
              type="button"
              onClick={handleVerifyBackups}
              className="rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            >
              Verify existing backups
            </button>
          </div>
          {backupState.message && (
            <p className="mt-2 break-all text-xs text-green-700" role="status">
              {backupState.message}
            </p>
          )}
          {backupState.error && (
            <p className="mt-2 text-xs text-red-700" role="alert">
              Backup failed: {backupState.error}
            </p>
          )}
          <p className="mt-2 text-xs text-gray-600" role="status">
            {backupVerification.error
              ? `Backup verification failed: ${backupVerification.error}`
              : backupVerification.checked
                ? `${backupVerification.valid}/${backupVerification.checked} backup snapshots passed SQLite integrity checks.`
                : "Existing snapshots can be re-verified after copying or restoring them."}
          </p>
        </div>
      </div>

      <LocalPrivacyReport />

      <LocalHealthReport />

      <AppLanguageSettings />

      <ThemeSettings />

      <LocalDiagnosticsBundle />

      <RecordingNoticeSettings />
    </div>
  );
}

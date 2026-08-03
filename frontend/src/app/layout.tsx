"use client";

import "./globals.css";
import { Source_Sans_3 } from "next/font/google";
import Sidebar from "@/components/Sidebar";
import { SidebarProvider } from "@/components/Sidebar/SidebarProvider";
import MainContent from "@/components/MainContent";
import AnalyticsProvider from "@/components/AnalyticsProvider";
import { Toaster, toast } from "sonner";
import "sonner/dist/styles.css";
import { useState, useEffect, useCallback, useRef } from "react";
import { listen, UnlistenFn } from "@tauri-apps/api/event";
import { invoke } from "@tauri-apps/api/core";
import { TooltipProvider } from "@/components/ui/tooltip";
import { RecordingStateProvider } from "@/contexts/RecordingStateContext";
import { OllamaDownloadProvider } from "@/contexts/OllamaDownloadContext";
import { TranscriptProvider } from "@/contexts/TranscriptContext";
import { ConfigProvider, useConfig } from "@/contexts/ConfigContext";
import { OnboardingProvider } from "@/contexts/OnboardingContext";
import { OnboardingFlow } from "@/components/onboarding";
import { loadBetaFeatures } from "@/types/betaFeatures";
import { DownloadProgressToastProvider } from "@/components/shared/DownloadProgressToast";
import { UpdateCheckProvider } from "@/components/UpdateCheckProvider";
import { RecordingPostProcessingProvider } from "@/contexts/RecordingPostProcessingProvider";
import { ImportAudioDialog, ImportDropOverlay } from "@/components/ImportAudio";
import { ImportDialogProvider } from "@/contexts/ImportDialogContext";
import {
  isAudioExtension,
  getAudioFormatsDisplayList,
} from "@/constants/audioFormats";
import { loadMeetingDetectionPreferences } from "@/lib/meetingDetectionPreferences";
import { LocalizationProvider } from "@/contexts/LocalizationContext";
import { ThemeProvider } from "@/contexts/ThemeContext";

type DetectedMeetingApp = {
  id: string;
  name: string;
};

const sourceSans3 = Source_Sans_3({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-source-sans-3",
});

// Module-level component — stable reference across RootLayout re-renders.
// Defined here (not inside RootLayout) so React never sees a new function type
// on re-render, which would cause unmount/remount and break initialization logic.
function ConditionalImportDialog({
  showImportDialog,
  handleImportDialogClose,
  importFilePath,
}: {
  showImportDialog: boolean;
  handleImportDialogClose: (open: boolean) => void;
  importFilePath: string | null;
}) {
  const { betaFeatures } = useConfig();

  // Only mount ImportAudioDialog (and its hooks/listeners) when feature is enabled
  if (!betaFeatures.importAndRetranscribe) {
    return null;
  }

  return (
    <ImportAudioDialog
      open={showImportDialog}
      onOpenChange={handleImportDialogClose}
      preselectedFile={importFilePath}
    />
  );
}

// export { metadata } from './metadata'

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const [showOnboarding, setShowOnboarding] = useState(false);
  const [onboardingCompleted, setOnboardingCompleted] = useState(false);

  // Import audio state
  const [showDropOverlay, setShowDropOverlay] = useState(false);
  const [showImportDialog, setShowImportDialog] = useState(false);
  const [importFilePath, setImportFilePath] = useState<string | null>(null);
  const [detectedMeetingApps, setDetectedMeetingApps] = useState<
    DetectedMeetingApp[]
  >([]);
  const detectedRecordingSourceRef = useRef<string | null>(null);
  const autoStopTimerRef = useRef<number | undefined>(undefined);
  const continuingAfterMeetingEndRef = useRef(false);

  useEffect(() => {
    // Check onboarding status first
    invoke<{ completed: boolean } | null>("get_onboarding_status")
      .then((status) => {
        const isComplete = status?.completed ?? false;
        setOnboardingCompleted(isComplete);

        if (!isComplete) {
          console.log(
            "[Layout] Onboarding not completed, showing onboarding flow",
          );
          setShowOnboarding(true);
        } else {
          console.log("[Layout] Onboarding completed, showing main app");
        }
      })
      .catch((error) => {
        console.error("[Layout] Failed to check onboarding status:", error);
        // Default to showing onboarding if we can't check
        setShowOnboarding(true);
        setOnboardingCompleted(false);
      });
  }, []);

  // Disable context menu in production
  useEffect(() => {
    if (process.env.NODE_ENV === "production") {
      const handleContextMenu = (e: MouseEvent) => e.preventDefault();
      document.addEventListener("contextmenu", handleContextMenu);
      return () =>
        document.removeEventListener("contextmenu", handleContextMenu);
    }
  }, []);
  useEffect(() => {
    // Listen for tray recording toggle request
    const unlisten = listen("request-recording-toggle", () => {
      console.log("[Layout] Received request-recording-toggle from tray");

      if (showOnboarding) {
        toast.error("Please complete setup first", {
          description:
            "You need to finish onboarding before you can start recording.",
        });
      } else {
        // If in main app, forward to useRecordingStart via window event
        console.log("[Layout] Forwarding to start-recording-from-sidebar");
        window.dispatchEvent(new CustomEvent("start-recording-from-sidebar"));
      }
    });

    return () => {
      unlisten.then((fn) => fn());
    };
  }, [showOnboarding]);

  // This is a local process-list hint only. It deliberately does not start or
  // stop recording: the user remains in control of every recording session.
  useEffect(() => {
    if (showOnboarding) {
      setDetectedMeetingApps([]);
      return;
    }

    let active = true;
    let previouslyDetected = new Set<string>();
    let autoStartTimer: number | undefined;
    const clearAutoStop = () => {
      if (autoStopTimerRef.current !== undefined) {
        window.clearTimeout(autoStopTimerRef.current);
        autoStopTimerRef.current = undefined;
      }
    };
    const handleRecordingStarted = (event: Event) => {
      const detail = (event as CustomEvent<{ origin?: string; appId?: string }>)
        .detail;
      if (detail?.origin === "meeting-detection" && detail.appId) {
        detectedRecordingSourceRef.current = detail.appId;
        continuingAfterMeetingEndRef.current = false;
      }
    };
    window.addEventListener("recording-started", handleRecordingStarted);
    const refreshDetectedApps = async () => {
      try {
        const apps = await invoke<DetectedMeetingApp[]>(
          "get_detected_meeting_apps",
        );
        if (!active) return;

        const preferences = await loadMeetingDetectionPreferences();
        const enabledApps = apps.filter(
          (app) => preferences.enabledApps[app.id],
        );
        setDetectedMeetingApps(enabledApps);

        const newlyDetected = enabledApps.filter(
          (app) => !previouslyDetected.has(app.id),
        );
        previouslyDetected = new Set(enabledApps.map((app) => app.id));
        const sourceApp = detectedRecordingSourceRef.current;
        if (sourceApp && apps.some((app) => app.id === sourceApp)) {
          clearAutoStop();
          continuingAfterMeetingEndRef.current = false;
        } else if (
          sourceApp &&
          preferences.autoStopApps[sourceApp] &&
          !continuingAfterMeetingEndRef.current &&
          autoStopTimerRef.current === undefined
        ) {
          const isRecording = await invoke<boolean>("is_recording").catch(
            () => false,
          );
          if (!isRecording) {
            detectedRecordingSourceRef.current = null;
            return;
          }

          const seconds = Math.max(
            30,
            Math.min(600, preferences.autoStopGraceSeconds),
          );
          const toastId = toast.info("Detected meeting app closed", {
            description: `Recording will stop in ${seconds} seconds unless you choose to continue.`,
            action: {
              label: "Continue recording",
              onClick: () => {
                clearAutoStop();
                continuingAfterMeetingEndRef.current = true;
              },
            },
            duration: seconds * 1000,
          });
          autoStopTimerRef.current = window.setTimeout(async () => {
            autoStopTimerRef.current = undefined;
            const stillRecording = await invoke<boolean>("is_recording").catch(
              () => false,
            );
            const currentApps = await invoke<DetectedMeetingApp[]>(
              "get_detected_meeting_apps",
            ).catch(() => []);
            if (
              stillRecording &&
              !currentApps.some((app) => app.id === sourceApp)
            ) {
              toast.dismiss(toastId);
              detectedRecordingSourceRef.current = null;
              window.dispatchEvent(
                new CustomEvent("stop-recording-from-meeting-detection"),
              );
            }
          }, seconds * 1000);
        }

        if (newlyDetected.length === 0) return;

        const automatic = newlyDetected.find(
          (app) => preferences.autoStartApps[app.id],
        );
        if (automatic) {
          const seconds = Math.max(
            3,
            Math.min(30, preferences.autoStartCountdownSeconds),
          );
          const toastId = toast.info(`${automatic.name} detected`, {
            description: `Recording will start in ${seconds} seconds. Ensure participants have been informed.`,
            action: {
              label: "Cancel",
              onClick: () => window.clearTimeout(autoStartTimer),
            },
            duration: seconds * 1000,
          });
          autoStartTimer = window.setTimeout(async () => {
            autoStartTimer = undefined;
            const currentApps = await invoke<DetectedMeetingApp[]>(
              "get_detected_meeting_apps",
            ).catch(() => []);
            const currentPreferences =
              await loadMeetingDetectionPreferences().catch(() => preferences);
            const stillEligible =
              currentApps.some((app) => app.id === automatic.id) &&
              currentPreferences.enabledApps[automatic.id] &&
              currentPreferences.autoStartApps[automatic.id];
            if (!stillEligible) {
              toast.dismiss(toastId);
              return;
            }

            toast.dismiss(toastId);
            window.dispatchEvent(
              new CustomEvent("start-recording-from-sidebar", {
                detail: {
                  origin: "meeting-detection",
                  appId: automatic.id,
                  appName: automatic.name,
                },
              }),
            );
          }, seconds * 1000);
        } else if (
          preferences.promptOnDetection &&
          newlyDetected.length === 1
        ) {
          const names = newlyDetected.map((app) => app.name).join(", ");
          toast.info(`${names} detected`, {
            description: "Start recording only after informing participants.",
            action: {
              label: "Start recording",
              onClick: () =>
                window.dispatchEvent(
                  new CustomEvent("start-recording-from-sidebar", {
                    detail: {
                      origin: "meeting-detection",
                      appId: newlyDetected[0].id,
                      appName: newlyDetected[0].name,
                    },
                  }),
                ),
            },
            duration: 12_000,
          });
        } else if (preferences.promptOnDetection) {
          toast.info("Multiple meeting apps detected", {
            description:
              "Choose a source context from the meeting-app indicator before recording.",
            duration: 12_000,
          });
        }
      } catch (error) {
        // Detection is optional, so do not interrupt recording if it is unavailable.
        console.debug("[Layout] Meeting app detection unavailable:", error);
      }
    };

    void refreshDetectedApps();
    const interval = window.setInterval(
      () => void refreshDetectedApps(),
      20_000,
    );
    return () => {
      active = false;
      if (autoStartTimer !== undefined) window.clearTimeout(autoStartTimer);
      clearAutoStop();
      window.removeEventListener("recording-started", handleRecordingStarted);
      window.clearInterval(interval);
    };
  }, [showOnboarding]);

  // Handle file drop for audio import
  const handleFileDrop = useCallback((paths: string[]) => {
    // Check if beta features are enabled (read from localStorage directly since we're outside ConfigProvider)
    const betaFeatures = loadBetaFeatures();

    if (!betaFeatures.importAndRetranscribe) {
      toast.error("Beta feature disabled", {
        description:
          'Enable "Import Audio & Retranscribe" in Settings > Beta to use this feature.',
      });
      return;
    }

    // Find the first audio file
    const audioFile = paths.find((p) => {
      const ext = p.split(".").pop()?.toLowerCase();
      return !!ext && isAudioExtension(ext);
    });

    if (audioFile) {
      console.log("[Layout] Audio file dropped:", audioFile);
      setImportFilePath(audioFile);
      setShowImportDialog(true);
    } else if (paths.length > 0) {
      toast.error("Please drop an audio file", {
        description: `Supported formats: ${getAudioFormatsDisplayList()}`,
      });
    }
  }, []);

  // Listen for drag-drop events
  useEffect(() => {
    if (showOnboarding) return; // Don't handle drops during onboarding

    const unlisteners: UnlistenFn[] = [];
    const cleanedUpRef = { current: false };

    const setupListeners = async () => {
      // Drag enter/over - show overlay only if beta feature is enabled
      const unlistenDragEnter = await listen("tauri://drag-enter", () => {
        if (loadBetaFeatures().importAndRetranscribe) {
          setShowDropOverlay(true);
        }
      });
      if (cleanedUpRef.current) {
        unlistenDragEnter();
        return;
      }
      unlisteners.push(unlistenDragEnter);

      // Drag leave - hide overlay
      const unlistenDragLeave = await listen("tauri://drag-leave", () => {
        setShowDropOverlay(false);
      });
      if (cleanedUpRef.current) {
        unlistenDragLeave();
        unlisteners.forEach((u) => u());
        return;
      }
      unlisteners.push(unlistenDragLeave);

      // Drop - process files
      const unlistenDrop = await listen<{ paths: string[] }>(
        "tauri://drag-drop",
        (event) => {
          setShowDropOverlay(false);
          handleFileDrop(event.payload.paths);
        },
      );
      if (cleanedUpRef.current) {
        unlistenDrop();
        unlisteners.forEach((u) => u());
        return;
      }
      unlisteners.push(unlistenDrop);
    };

    setupListeners();

    return () => {
      cleanedUpRef.current = true;
      unlisteners.forEach((unlisten) => unlisten());
    };
  }, [showOnboarding, handleFileDrop]);

  // Handle import dialog close
  const handleImportDialogClose = useCallback((open: boolean) => {
    setShowImportDialog(open);
    if (!open) {
      setImportFilePath(null);
    }
  }, []);

  // Handler for ImportDialogProvider - opens import dialog from any child component
  const handleOpenImportDialog = useCallback((filePath?: string | null) => {
    setImportFilePath(filePath ?? null);
    setShowImportDialog(true);
  }, []);

  const handleOnboardingComplete = () => {
    console.log("[Layout] Onboarding completed, reloading app");
    setShowOnboarding(false);
    setOnboardingCompleted(true);
    // Optionally reload the window to ensure all state is fresh
    window.location.reload();
  };

  return (
    <html lang="en" dir="ltr">
      <body className={`${sourceSans3.variable} font-sans antialiased`}>
        <ThemeProvider>
          <LocalizationProvider>
            <a
              href="#main-content"
              className="sr-only z-[100] rounded bg-white px-3 py-2 text-sm font-semibold text-blue-800 shadow focus:not-sr-only focus:fixed focus:left-3 focus:top-3"
            >
              Skip to main content
            </a>
            <AnalyticsProvider>
              <RecordingStateProvider>
                <TranscriptProvider>
                  <ConfigProvider>
                    <OllamaDownloadProvider>
                      <OnboardingProvider>
                        <UpdateCheckProvider>
                          <SidebarProvider>
                            <TooltipProvider>
                              <RecordingPostProcessingProvider>
                                <ImportDialogProvider
                                  onOpen={handleOpenImportDialog}
                                >
                                  {/* Download progress toast provider - listens for background downloads */}
                                  <DownloadProgressToastProvider />

                                  {/* Show onboarding or main app */}
                                  {showOnboarding ? (
                                    <OnboardingFlow
                                      onComplete={handleOnboardingComplete}
                                    />
                                  ) : (
                                    <div className="flex">
                                      <Sidebar />
                                      <MainContent>{children}</MainContent>
                                    </div>
                                  )}
                                  {!showOnboarding && (
                                    <>
                                      {detectedMeetingApps.length > 1 && (
                                        <div
                                          className="fixed bottom-14 right-3 z-50 max-w-xs rounded-lg border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900 shadow-sm"
                                          role="status"
                                          aria-label={`Detected meeting apps: ${detectedMeetingApps.map((app) => app.name).join(", ")}`}
                                        >
                                          <p className="font-semibold">
                                            {detectedMeetingApps
                                              .map((app) => app.name)
                                              .join(", ")}{" "}
                                            detected
                                          </p>
                                          {detectedMeetingApps.length === 1 ? (
                                            <p className="mt-0.5 text-sky-700">
                                              Recording remains under your
                                              control.
                                            </p>
                                          ) : (
                                            <>
                                              <p className="mt-0.5 text-sky-700">
                                                Choose a source context before
                                                recording.
                                              </p>
                                              <div className="mt-2 flex flex-wrap gap-1.5">
                                                {detectedMeetingApps.map(
                                                  (app) => (
                                                    <button
                                                      key={app.id}
                                                      type="button"
                                                      className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-medium hover:bg-sky-100"
                                                      onClick={() =>
                                                        window.dispatchEvent(
                                                          new CustomEvent(
                                                            "start-recording-from-sidebar",
                                                            {
                                                              detail: {
                                                                origin:
                                                                  "meeting-detection",
                                                                appId: app.id,
                                                                appName:
                                                                  app.name,
                                                              },
                                                            },
                                                          ),
                                                        )
                                                      }
                                                    >
                                                      Start {app.name}
                                                    </button>
                                                  ),
                                                )}
                                                <button
                                                  type="button"
                                                  className="rounded border border-sky-300 bg-white px-2 py-1 text-xs font-medium hover:bg-sky-100"
                                                  onClick={() =>
                                                    window.dispatchEvent(
                                                      new CustomEvent(
                                                        "start-recording-from-sidebar",
                                                        {
                                                          detail: {
                                                            origin:
                                                              "meeting-detection",
                                                            appId:
                                                              detectedMeetingApps
                                                                .map(
                                                                  (app) =>
                                                                    app.id,
                                                                )
                                                                .join("+"),
                                                            appName: "Combined",
                                                            combined: true,
                                                          },
                                                        },
                                                      ),
                                                    )
                                                  }
                                                >
                                                  Start combined
                                                </button>
                                              </div>
                                            </>
                                          )}
                                        </div>
                                      )}
                                      <div
                                        className="menie-local-status fixed right-6 top-5 z-20 text-xs font-medium"
                                        role="status"
                                        aria-label="Local-only processing enabled"
                                      >
                                        100% Local Processing
                                      </div>
                                    </>
                                  )}
                                  {/* Import audio overlay and dialog */}
                                  <ImportDropOverlay
                                    visible={showDropOverlay}
                                  />
                                  <ConditionalImportDialog
                                    showImportDialog={showImportDialog}
                                    handleImportDialogClose={
                                      handleImportDialogClose
                                    }
                                    importFilePath={importFilePath}
                                  />
                                </ImportDialogProvider>
                              </RecordingPostProcessingProvider>
                            </TooltipProvider>
                          </SidebarProvider>
                        </UpdateCheckProvider>
                      </OnboardingProvider>
                    </OllamaDownloadProvider>
                  </ConfigProvider>
                </TranscriptProvider>
              </RecordingStateProvider>
            </AnalyticsProvider>
          </LocalizationProvider>
        </ThemeProvider>

        <Toaster position="top-right" richColors closeButton offset={16} />
      </body>
    </html>
  );
}

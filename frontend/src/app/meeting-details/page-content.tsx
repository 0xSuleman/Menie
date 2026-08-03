"use client";
import { useState, useEffect, useRef } from "react";
import type { ChangeEvent } from "react";
import { motion } from "framer-motion";
import { SummaryDocument, SummaryResponse, Transcript } from "@/types";
import { useSidebar } from "@/components/Sidebar/SidebarProvider";
import Analytics from "@/lib/analytics";
import { invoke } from "@tauri-apps/api/core";
import { toast } from "sonner";
import { TranscriptPanel } from "@/components/MeetingDetails/TranscriptPanel";
import { SummaryPanel } from "@/components/MeetingDetails/SummaryPanel";
import { ModelConfig } from "@/components/ModelSettingsModal";
import type { TranscriptExportFormat } from "@/components/MeetingDetails/SummaryUpdaterButtonGroup";

const parseCalendarIcs = (raw: string) => {
  const unfolded = raw.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  const start = unfolded.findIndex((line) =>
    line.toUpperCase().includes("BEGIN:VEVENT"),
  );
  const end = unfolded.findIndex((line) =>
    line.toUpperCase().includes("END:VEVENT"),
  );
  if (start < 0 || end <= start)
    throw new Error("The selected file does not contain a calendar event.");
  const values: Record<string, string> = {};
  for (const line of unfolded.slice(start + 1, end)) {
    const separator = line.indexOf(":");
    if (separator < 0) continue;
    const key = line.slice(0, separator).split(";")[0].toUpperCase();
    if (
      [
        "SUMMARY",
        "DESCRIPTION",
        "DTSTART",
        "DTEND",
        "LOCATION",
        "ORGANIZER",
      ].includes(key)
    )
      values[key] = line.slice(separator + 1).replace(/\\n/g, "\n");
  }
  if (!values.SUMMARY && !values.DTSTART)
    throw new Error("The selected file does not contain a usable event.");
  return {
    source: "local-ics",
    imported_at: new Date().toISOString(),
    ...values,
  };
};
const redactSensitiveText = (value: string): string =>
  value
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[REDACTED EMAIL]")
    .replace(/\b(?:\+?\d[\d .()\-]{7,}\d)\b/g, "[REDACTED PHONE]")
    .replace(
      /\b(?:sk|pk|api|token|secret)[_-][A-Za-z0-9_-]{12,}\b/gi,
      "[REDACTED TOKEN]",
    );

// Custom hooks
import { useMeetingData } from "@/hooks/meeting-details/useMeetingData";
import { useSummaryGeneration } from "@/hooks/meeting-details/useSummaryGeneration";
import { useTemplates } from "@/hooks/meeting-details/useTemplates";
import { useCopyOperations } from "@/hooks/meeting-details/useCopyOperations";
import { useMeetingOperations } from "@/hooks/meeting-details/useMeetingOperations";
import { useConfig } from "@/contexts/ConfigContext";

export default function PageContent({
  meeting,
  summaryData,
  shouldAutoGenerate = false,
  onAutoGenerateComplete,
  onMeetingUpdated,
  onRefetchTranscripts,
  // Pagination props for efficient transcript loading
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
}: {
  meeting: any;
  summaryData: SummaryDocument | null;
  shouldAutoGenerate?: boolean;
  onAutoGenerateComplete?: () => void;
  onMeetingUpdated?: () => Promise<void>;
  onRefetchTranscripts?: () => Promise<void>;
  // Pagination props
  segments?: any[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
}) {
  console.log("📄 PAGE CONTENT: Initializing with data:", {
    meetingId: meeting.id,
    summaryDataKeys: summaryData ? Object.keys(summaryData) : null,
    transcriptsCount: meeting.transcripts?.length,
  });

  // State
  const [customPrompt, setCustomPrompt] = useState<string>("");
  const [isRecording] = useState(false);
  const [summaryResponse] = useState<SummaryResponse | null>(null);
  const [recordingMarkers, setRecordingMarkers] = useState<
    Array<{ offset_seconds: number; text: string }>
  >([]);
  const bundleInputRef = useRef<HTMLInputElement | null>(null);
  const calendarInputRef = useRef<HTMLInputElement | null>(null);
  const [calendarContext, setCalendarContext] = useState<Record<
    string,
    string
  > | null>(null);

  useEffect(() => {
    let active = true;
    invoke<string | null>("api_get_meeting_calendar_context", {
      meetingId: meeting.id,
    })
      .then((raw) => {
        if (!active || !raw) return;
        try {
          setCalendarContext(JSON.parse(raw) as Record<string, string>);
        } catch {
          setCalendarContext(null);
        }
      })
      .catch(() => {
        if (active) setCalendarContext(null);
      });
    return () => {
      active = false;
    };
  }, [meeting.id]);
  useEffect(() => {
    let active = true;
    invoke<Array<{ offset_seconds: number; text: string }>>(
      "api_get_recording_markers",
      { meetingId: meeting.id },
    )
      .then((markers) => {
        if (active) setRecordingMarkers(markers);
      })
      .catch((error) =>
        console.debug("No recording markers available:", error),
      );
    return () => {
      active = false;
    };
  }, [meeting.id]);

  // Ref to store the modal open function from SummaryGeneratorButtonGroup
  const openModelSettingsRef = useRef<(() => void) | null>(null);

  // Sidebar context
  const { serverAddress } = useSidebar();

  // Get model config from ConfigContext
  const { modelConfig, setModelConfig } = useConfig();

  // Custom hooks
  const meetingData = useMeetingData({
    meeting,
    summaryData,
    onMeetingUpdated,
  });
  const templates = useTemplates();

  // Callback to register the modal open function
  const handleRegisterModalOpen = (openFn: () => void) => {
    console.log("📝 Registering modal open function in PageContent");
    openModelSettingsRef.current = openFn;
  };

  // Callback to trigger modal open (called from error handler)
  const handleOpenModelSettings = () => {
    console.log("🔔 Opening model settings from PageContent");
    if (openModelSettingsRef.current) {
      openModelSettingsRef.current();
    } else {
      console.warn("⚠️ Modal open function not yet registered");
    }
  };

  // Save model config to backend database and sync via event
  const handleSaveModelConfig = async (config?: ModelConfig) => {
    if (!config) return;
    try {
      await invoke("api_save_model_config", {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey ?? null,
        ollamaEndpoint: config.ollamaEndpoint ?? null,
      });

      // Emit event so ConfigContext and other listeners stay in sync
      const { emit } = await import("@tauri-apps/api/event");
      await emit("model-config-updated", config);

      toast.success("Model settings saved successfully");
    } catch (error) {
      console.error("Failed to save model config:", error);
      toast.error("Failed to save model settings");
    }
  };

  const summaryGeneration = useSummaryGeneration({
    meeting,
    transcripts: meetingData.transcripts,
    modelConfig: modelConfig,
    isModelConfigLoading: false, // ConfigContext loads on mount
    selectedTemplate: templates.selectedTemplate,
    onMeetingUpdated,
    updateMeetingTitle: meetingData.updateMeetingTitle,
    setAiSummary: meetingData.setAiSummary,
    onOpenModelSettings: handleOpenModelSettings,
  });

  const copyOperations = useCopyOperations({
    meeting,
    transcripts: meetingData.transcripts,
    meetingTitle: meetingData.meetingTitle,
    aiSummary: meetingData.aiSummary,
    blockNoteSummaryRef: meetingData.blockNoteSummaryRef,
  });

  const handleExportTranscript = async (format: TranscriptExportFormat) => {
    const transcripts = meetingData.transcripts as Transcript[];
    const formatTimestamp = (seconds: number, separator: "," | ".") => {
      const hours = Math.floor(seconds / 3600)
        .toString()
        .padStart(2, "0");
      const minutes = Math.floor((seconds % 3600) / 60)
        .toString()
        .padStart(2, "0");
      const wholeSeconds = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
      const milliseconds = Math.floor((seconds % 1) * 1000)
        .toString()
        .padStart(3, "0");
      return `${hours}:${minutes}:${wholeSeconds}${separator}${milliseconds}`;
    };
    const lines = transcripts.map((transcript) => {
      const seconds = transcript.audio_start_time ?? 0;
      const minutes = Math.floor(seconds / 60)
        .toString()
        .padStart(2, "0");
      const remainder = Math.floor(seconds % 60)
        .toString()
        .padStart(2, "0");
      const source = transcript.source ? ` (${transcript.source})` : "";
      return `- [${minutes}:${remainder}]${source} ${transcript.text}`;
    });
    const markerLines = recordingMarkers.map((marker) => {
      const minutes = Math.floor(marker.offset_seconds / 60)
        .toString()
        .padStart(2, "0");
      const seconds = Math.floor(marker.offset_seconds % 60)
        .toString()
        .padStart(2, "0");
      return `- [${minutes}:${seconds}] ${marker.text}`;
    });
    const isRedacted =
      format === "redacted-txt" || format === "redacted-markdown";
    const exportLines = isRedacted
      ? lines.map((line) => redactSensitiveText(line))
      : lines;
    const extension =
      format === "markdown" || format === "redacted-markdown"
        ? "md"
        : format === "bundle"
          ? "menie-bundle.json"
          : format === "secure-bundle"
            ? "menie-handoff.json"
            : format === "redacted-txt"
              ? "txt"
              : format;
    const securePassword =
      format === "secure-bundle"
        ? window.prompt(
            "Choose a password for this encrypted local handoff (8+ characters).",
          )
        : null;
    if (format === "secure-bundle" && !securePassword) {
      toast.info("Encrypted handoff cancelled.");
      return;
    }
    const content = await (async () => {
      if (format === "markdown" || format === "redacted-markdown") {
        return `# ${redactSensitiveText(meetingData.meetingTitle)}\n\nExported locally from Menie.\n\n## Transcript\n\n${exportLines.join("\n")}\n${markerLines.length ? `\n## Recording notes\n\n${(isRedacted ? markerLines.map((line) => redactSensitiveText(line)) : markerLines).join("\n")}\n` : ""}`;
      }
      if (format === "txt" || format === "redacted-txt")
        return (
          [
            ...exportLines,
            ...(isRedacted
              ? markerLines.map((line) =>
                  redactSensitiveText(`[Note] ${line.replace(/^- /, "")}`),
                )
              : markerLines.map((line) => `[Note] ${line.replace(/^- /, "")}`)),
          ]
            .map((line) => line.replace(/^- /, ""))
            .join("\n") + "\n"
        );
      if (format === "json") {
        return JSON.stringify(
          {
            schema_version: 1,
            exported_locally: true,
            meeting: {
              id: meeting.id,
              title: meetingData.meetingTitle,
              created_at: meeting.created_at,
              calendar_context: calendarContext,
            },
            transcripts,
            recording_markers: recordingMarkers,
            summary: meetingData.aiSummary,
          },
          null,
          2,
        );
      }
      if (format === "bundle" || format === "secure-bundle") {
        const comments = await invoke<
          Array<{ author: string; body: string; resolved_at?: string | null }>
        >("api_get_meeting_comments", { meetingId: meeting.id }).catch(
          () => [],
        );
        const transcriptPayload = JSON.stringify(transcripts);
        const markersPayload = JSON.stringify(recordingMarkers);
        const artifactPayload = JSON.stringify(meetingData.aiSummary ?? null);
        const commentsPayload = JSON.stringify(comments);
        const calendarContextPayload = JSON.stringify(calendarContext);
        const sha256 = async (value: string) => {
          const digest = await crypto.subtle.digest(
            "SHA-256",
            new TextEncoder().encode(value),
          );
          return Array.from(new Uint8Array(digest))
            .map((byte) => byte.toString(16).padStart(2, "0"))
            .join("");
        };
        const bundle = JSON.stringify(
          {
            schema_version: 1,
            bundle_type: "menie-local-meeting-bundle",
            generated_at: new Date().toISOString(),
            exported_locally: true,
            media_included: false,
            media_note:
              "This portable bundle contains local meeting metadata, transcript, and generated artifacts. Media remains in the local recording folder and is not copied by this browser download.",
            meeting: {
              id: meeting.id,
              title: meetingData.meetingTitle,
              created_at: meeting.created_at,
              calendar_context: calendarContext,
            },
            transcript: transcripts,
            recording_markers: recordingMarkers,
            artifacts: { summary: meetingData.aiSummary },
            comments,
            manifest: {
              files: [
                {
                  path: "transcript.json",
                  sha256: await sha256(transcriptPayload),
                  bytes: new TextEncoder().encode(transcriptPayload).byteLength,
                },
                {
                  path: "recording-markers.json",
                  sha256: await sha256(markersPayload),
                  bytes: new TextEncoder().encode(markersPayload).byteLength,
                },
                {
                  path: "artifacts/summary.json",
                  sha256: await sha256(artifactPayload),
                  bytes: new TextEncoder().encode(artifactPayload).byteLength,
                },
                {
                  path: "comments.json",
                  sha256: await sha256(commentsPayload),
                  bytes: new TextEncoder().encode(commentsPayload).byteLength,
                },
                {
                  path: "calendar-context.json",
                  sha256: await sha256(calendarContextPayload),
                  bytes: new TextEncoder().encode(calendarContextPayload)
                    .byteLength,
                },
              ],
            },
          },
          null,
          2,
        );
        if (format === "secure-bundle") {
          return invoke<string>("api_encrypt_local_handoff", {
            bundleJson: bundle,
            password: securePassword,
          });
        }
        return bundle;
      }
      const cues = transcripts.map((transcript, index) => {
        const start = transcript.audio_start_time ?? 0;
        const end = transcript.audio_end_time ?? start;
        const cue = `${formatTimestamp(start, format === "srt" ? "," : ".")} --> ${formatTimestamp(Math.max(start + 0.001, end), format === "srt" ? "," : ".")}`;
        return format === "srt"
          ? `${index + 1}\n${cue}\n${transcript.text}`
          : `${cue}\n${transcript.text}`;
      });
      return format === "vtt"
        ? `WEBVTT\n\n${cues.join("\n\n")}\n`
        : `${cues.join("\n\n")}\n`;
    })();
    const mimeType =
      format === "json" || format === "bundle" || format === "secure-bundle"
        ? "application/json"
        : format === "vtt"
          ? "text/vtt"
          : "text/plain";
    const blob = new Blob([content], { type: `${mimeType};charset=utf-8` });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    const safeTitle =
      meetingData.meetingTitle.replace(/[<>:"/\\|?*]/g, "_").trim() ||
      "meeting";
    anchor.href = url;
    anchor.download = `${safeTitle}-transcript.${extension}`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(url);
    toast.success(
      format === "bundle" || format === "secure-bundle"
        ? format === "secure-bundle"
          ? "Encrypted handoff created"
          : "Meeting bundle created"
        : isRedacted
          ? "Redacted transcript export created"
          : "Transcript export created",
      {
        description:
          format === "secure-bundle"
            ? "The handoff is encrypted locally; share the password through a separate trusted channel."
            : format === "bundle"
              ? "The manifest lists SHA-256 checksums for local transcript and artifact data."
              : isRedacted
                ? "Common email, phone, and token patterns were replaced locally. Review the result before sharing."
                : `Your ${extension.toUpperCase()} file contains only local meeting data.`,
      },
    );
  };

  const handleImportCalendar = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      const parsed = parseCalendarIcs(await file.text());
      await invoke("api_save_meeting_calendar_context", {
        meetingId: meeting.id,
        context: JSON.stringify(parsed),
      });
      setCalendarContext(parsed);
      toast.success("Calendar context imported locally", {
        description: "No calendar account or network request was used.",
      });
    } catch (reason) {
      toast.error("Calendar import rejected", {
        description: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };
  const handleImportBundle = () => bundleInputRef.current?.click();
  const handleBundleFile = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    try {
      let bundleJson = await file.text();
      try {
        const parsed = JSON.parse(bundleJson) as { handoff_type?: string };
        if (parsed.handoff_type === "menie-encrypted-local-handoff") {
          const password = window.prompt(
            "Enter the password for this encrypted local handoff.",
          );
          if (!password) return;
          bundleJson = await invoke<string>("api_decrypt_local_handoff", {
            envelopeJson: bundleJson,
            password,
          });
        }
      } catch (error) {
        if (error instanceof SyntaxError)
          throw new Error("The selected file is not valid JSON.");
        throw error;
      }
      const importedMeetingId = await invoke<string>(
        "api_import_meeting_bundle",
        { bundleJson },
      );
      toast.success("Meeting bundle imported", {
        description: `Imported ${importedMeetingId} after checksum verification.`,
      });
      window.location.reload();
    } catch (reason) {
      toast.error("Bundle import rejected", {
        description: reason instanceof Error ? reason.message : String(reason),
      });
    }
  };

  const meetingOperations = useMeetingOperations({
    meeting,
  });

  const handleCitationClick = (timestampSeconds: number) => {
    const rows = Array.from(
      document.querySelectorAll<HTMLElement>("[data-audio-start]"),
    );
    const target = rows
      .map((row) => ({ row, timestamp: Number(row.dataset.audioStart) }))
      .filter((entry) => Number.isFinite(entry.timestamp))
      .sort(
        (left, right) =>
          Math.abs(left.timestamp - timestampSeconds) -
          Math.abs(right.timestamp - timestampSeconds),
      )[0]?.row;
    if (!target) {
      toast.info("Load more transcript segments to open this citation.");
      return;
    }
    target.scrollIntoView({ behavior: "smooth", block: "center" });
    target.classList.add("ring-2", "ring-blue-400");
    window.setTimeout(
      () => target.classList.remove("ring-2", "ring-blue-400"),
      1800,
    );
  };

  // Track page view
  useEffect(() => {
    Analytics.trackPageView("meeting_details");
  }, []);

  // Auto-generate summary when flag is set
  useEffect(() => {
    let cancelled = false;

    const autoGenerate = async () => {
      if (
        shouldAutoGenerate &&
        meetingData.transcripts.length > 0 &&
        !cancelled
      ) {
        console.log(
          `🤖 Auto-generating summary with ${modelConfig.provider}/${modelConfig.model}...`,
        );
        await summaryGeneration.handleGenerateSummary("");

        // Notify parent that auto-generation is complete (only if not cancelled)
        if (onAutoGenerateComplete && !cancelled) {
          onAutoGenerateComplete();
        }
      }
    };

    autoGenerate();

    // Cleanup: cancel if component unmounts or meeting changes
    return () => {
      cancelled = true;
    };
  }, [shouldAutoGenerate, meeting.id]); // Re-run if meeting changes

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className="brand-shell flex flex-col h-screen"
    >
      {recordingMarkers.length > 0 && (
        <section
          className="border-b border-blue-200 bg-blue-50 px-4 py-2"
          aria-label="Recording notes"
        >
          <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-xs text-blue-900">
            <span className="font-semibold">Recording notes</span>
            {recordingMarkers.map((marker, index) => {
              const minutes = Math.floor(marker.offset_seconds / 60)
                .toString()
                .padStart(2, "0");
              const seconds = Math.floor(marker.offset_seconds % 60)
                .toString()
                .padStart(2, "0");
              return (
                <span
                  key={`${marker.offset_seconds}-${index}`}
                  className="rounded border border-blue-200 bg-white px-2 py-1"
                >
                  [{minutes}:{seconds}] {marker.text}
                </span>
              );
            })}
          </div>
        </section>
      )}
      <input
        ref={bundleInputRef}
        type="file"
        accept="application/json,.json,.menie-bundle.json"
        className="hidden"
        onChange={(event) => void handleBundleFile(event)}
        aria-label="Import local meeting bundle"
      />
      <input
        ref={calendarInputRef}
        type="file"
        accept=".ics,text/calendar"
        className="hidden"
        onChange={(event) => void handleImportCalendar(event)}
        aria-label="Import local calendar event"
      />
      <section
        className="border-b border-emerald-200 bg-emerald-50 px-4 py-2"
        aria-label="Local calendar context"
      >
        <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-2 text-xs text-emerald-950">
          {calendarContext?.SUMMARY ? (
            <span>
              <span className="font-semibold">Calendar:</span>{" "}
              {calendarContext.SUMMARY}
            </span>
          ) : (
            <span className="text-emerald-800">
              Optional local calendar context can be imported from an .ics file.
            </span>
          )}
          <button
            type="button"
            onClick={() => calendarInputRef.current?.click()}
            className="rounded border border-emerald-300 bg-white px-2 py-1 font-medium hover:bg-emerald-100"
          >
            {calendarContext ? "Replace .ics" : "Import .ics"}
          </button>
          {calendarContext && (
            <button
              type="button"
              onClick={async () => {
                await invoke("api_save_meeting_calendar_context", {
                  meetingId: meeting.id,
                  context: null,
                });
                setCalendarContext(null);
              }}
              className="rounded border border-emerald-300 bg-white px-2 py-1 hover:bg-emerald-100"
            >
              Clear
            </button>
          )}
        </div>
      </section>
      <div className="flex flex-1 overflow-hidden">
        <TranscriptPanel
          transcripts={meetingData.transcripts}
          customPrompt={customPrompt}
          onPromptChange={setCustomPrompt}
          onCopyTranscript={copyOperations.handleCopyTranscript}
          onOpenMeetingFolder={meetingOperations.handleOpenMeetingFolder}
          isRecording={isRecording}
          disableAutoScroll={true}
          // Pagination props for efficient loading
          usePagination={true}
          segments={segments}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          // Retranscription props
          meetingId={meeting.id}
          meetingFolderPath={meeting.folder_path}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        <SummaryPanel
          meeting={meeting}
          meetingTitle={meetingData.meetingTitle}
          onTitleChange={meetingData.handleTitleChange}
          isEditingTitle={meetingData.isEditingTitle}
          onStartEditTitle={() => meetingData.setIsEditingTitle(true)}
          onFinishEditTitle={() => meetingData.setIsEditingTitle(false)}
          isTitleDirty={meetingData.isTitleDirty}
          summaryRef={meetingData.blockNoteSummaryRef}
          isSaving={meetingData.isSaving}
          onSaveAll={meetingData.saveAllChanges}
          onCopySummary={copyOperations.handleCopySummary}
          onExportTranscript={handleExportTranscript}
          onImportBundle={handleImportBundle}
          onOpenFolder={meetingOperations.handleOpenMeetingFolder}
          aiSummary={meetingData.aiSummary}
          summaryStatus={summaryGeneration.summaryStatus}
          transcripts={meetingData.transcripts}
          modelConfig={modelConfig}
          setModelConfig={setModelConfig}
          onSaveModelConfig={handleSaveModelConfig}
          onGenerateSummary={summaryGeneration.handleGenerateSummary}
          onStopGeneration={summaryGeneration.handleStopGeneration}
          customPrompt={customPrompt}
          summaryResponse={summaryResponse}
          onSaveSummary={meetingData.handleSaveSummary}
          onSummaryChange={meetingData.handleSummaryChange}
          onDirtyChange={meetingData.setIsSummaryDirty}
          summaryError={summaryGeneration.summaryError}
          onRegenerateSummary={summaryGeneration.handleRegenerateSummary}
          getSummaryStatusMessage={summaryGeneration.getSummaryStatusMessage}
          availableTemplates={templates.availableTemplates}
          selectedTemplate={templates.selectedTemplate}
          onTemplateSelect={templates.handleTemplateSelection}
          isModelConfigLoading={false}
          onOpenModelSettings={handleRegisterModalOpen}
          onCitationClick={handleCitationClick}
        />
      </div>
    </motion.div>
  );
}

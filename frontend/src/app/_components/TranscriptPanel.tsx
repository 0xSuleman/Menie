import { VirtualizedTranscriptView } from "@/components/VirtualizedTranscriptView";
import { PermissionWarning } from "@/components/PermissionWarning";
import { Button } from "@/components/ui/button";
import { ButtonGroup } from "@/components/ui/button-group";
import {
  Copy,
  GlobeIcon,
  Mic,
  Upload,
  ShieldCheck,
  Database,
  Settings2,
} from "lucide-react";
import { useTranscripts } from "@/contexts/TranscriptContext";
import { useConfig } from "@/contexts/ConfigContext";
import { useRecordingState } from "@/contexts/RecordingStateContext";
import { usePermissionCheck } from "@/hooks/usePermissionCheck";
import { ModalType } from "@/hooks/useModalState";
import { useIsLinux } from "@/hooks/usePlatform";
import { useMemo } from "react";
import { useImportDialog } from "@/contexts/ImportDialogContext";

/**
 * TranscriptPanel Component
 *
 * Displays transcript content with controls for copying and language settings.
 * Uses TranscriptContext, ConfigContext, and RecordingStateContext internally.
 */

interface TranscriptPanelProps {
  // indicates stop-processing state for transcripts; derived from backend statuses.
  isProcessingStop: boolean;
  isStopping: boolean;
  showModal: (name: ModalType, message?: string) => void;
}

export function TranscriptPanel({
  isProcessingStop,
  isStopping,
  showModal,
}: TranscriptPanelProps) {
  // Contexts
  const { transcripts, transcriptContainerRef, copyTranscript } =
    useTranscripts();
  const { transcriptModelConfig } = useConfig();
  const { isRecording, isPaused } = useRecordingState();
  const { checkPermissions, isChecking, hasSystemAudio, hasMicrophone } =
    usePermissionCheck();
  const { openImportDialog } = useImportDialog();
  const isLinux = useIsLinux();

  // Convert transcripts to segments for virtualized view
  const segments = useMemo(
    () =>
      transcripts.map((t) => ({
        id: t.id,
        timestamp: t.audio_start_time ?? 0,
        endTime: t.audio_end_time,
        text: t.text,
        confidence: t.confidence,
        source: t.source,
      })),
    [transcripts],
  );

  return (
    <div
      ref={transcriptContainerRef}
      className="menie-panel w-full border-r border-gray-200 bg-white flex flex-col overflow-y-auto"
    >
      {/* Title area - Sticky header */}
      <div className="menie-panel-header sticky top-0 z-10 bg-white px-7 py-4 border-gray-200">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="text-[11px] font-semibold uppercase tracking-[0.16em] text-blue-600">
              Meeting workspace
            </p>
            <h1 className="mt-1 font-brand text-2xl tracking-normal text-slate-950">
              {isRecording ? "Live meeting" : "New meeting"}
            </h1>
          </div>
          <div className="flex items-center gap-2">
            {!isRecording && (
              <>
                <Button
                  type="button"
                  onClick={() =>
                    window.dispatchEvent(
                      new CustomEvent("start-recording-from-sidebar"),
                    )
                  }
                  className="h-10 bg-[#2457ff] px-4 font-semibold text-white shadow-sm hover:bg-[#1d46d0]"
                >
                  <Mic className="mr-2 h-4 w-4" /> Start recording
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => openImportDialog()}
                  className="h-10"
                >
                  <Upload className="mr-2 h-4 w-4" /> Import audio
                </Button>
              </>
            )}
            <ButtonGroup>
              {transcripts?.length > 0 && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={copyTranscript}
                  title="Copy Transcript"
                >
                  <Copy />
                  <span className="hidden md:inline">Copy</span>
                </Button>
              )}
              {transcriptModelConfig.provider === "localWhisper" && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => showModal("languageSettings")}
                  title="Language"
                >
                  <GlobeIcon />
                  <span className="hidden md:inline">Language</span>
                </Button>
              )}
            </ButtonGroup>
          </div>
        </div>
      </div>

      {/* Permission Warning - Not needed on Linux */}
      {!isRecording && !isChecking && !isLinux && (
        <div className="flex justify-center px-6 pt-3">
          <PermissionWarning
            hasMicrophone={hasMicrophone}
            hasSystemAudio={hasSystemAudio}
            onRecheck={checkPermissions}
            isRechecking={isChecking}
          />
        </div>
      )}

      {/* Transcript content */}
      {!isRecording && transcripts.length === 0 && (
        <div className="mx-auto grid w-full max-w-[1180px] grid-cols-[minmax(0,1fr)_300px] gap-5 px-7 pt-7 max-[900px]:grid-cols-1">
          <section className="rounded-xl border border-slate-200 bg-white p-7 shadow-[0_8px_24px_rgba(16,24,40,0.04)]">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-slate-500">
              Prepare your next call
            </p>
            <h2 className="mt-3 max-w-xl font-brand text-3xl tracking-normal text-slate-950">
              Clear notes start with a clear recording.
            </h2>
            <p className="mt-3 max-w-xl text-base leading-7 text-slate-600">
              MENIE keeps the conversation on this device, then turns it into
              decisions and next steps you can use.
            </p>
            <div className="mt-7 flex flex-wrap gap-3 text-sm text-slate-700">
              <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2">
                <ShieldCheck className="h-4 w-4 text-emerald-600" /> Local by
                default
              </span>
              <span className="inline-flex items-center gap-2 rounded-md bg-slate-100 px-3 py-2">
                <Database className="h-4 w-4 text-blue-600" /> Evidence grounded
              </span>
            </div>
          </section>
          <aside className="rounded-xl bg-slate-950 p-6 text-white">
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-cyan-300">
              Readiness
            </p>
            <div className="mt-5 space-y-4 text-sm">
              <div className="flex items-center justify-between">
                <span>Microphone</span>
                <span
                  className={
                    hasMicrophone ? "text-emerald-300" : "text-amber-300"
                  }
                >
                  {hasMicrophone ? "Ready" : "Needs setup"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>System audio</span>
                <span
                  className={
                    hasSystemAudio ? "text-emerald-300" : "text-slate-400"
                  }
                >
                  {hasSystemAudio ? "Ready" : "Optional"}
                </span>
              </div>
              <div className="flex items-center justify-between">
                <span>Local processing</span>
                <span className="text-emerald-300">Enabled</span>
              </div>
            </div>
            {!hasMicrophone && (
              <button
                type="button"
                onClick={checkPermissions}
                className="mt-6 inline-flex items-center gap-2 text-sm font-semibold text-cyan-300 hover:text-white"
              >
                <Settings2 className="h-4 w-4" /> Check microphone
              </button>
            )}
          </aside>
        </div>
      )}

      <div className="pb-20">
        <div className="flex justify-center">
          <div className="w-full max-w-[920px]">
            {(segments.length > 0 || isRecording || isProcessingStop) && (
              <VirtualizedTranscriptView
                segments={segments}
                isRecording={isRecording}
                isPaused={isPaused}
                isProcessing={isProcessingStop}
                isStopping={isStopping}
                enableStreaming={isRecording}
                showConfidence={true}
              />
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

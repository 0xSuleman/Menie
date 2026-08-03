"use client";

import { Transcript, TranscriptSegmentData } from "@/types";
import { TranscriptView } from "@/components/TranscriptView";
import { VirtualizedTranscriptView } from "@/components/VirtualizedTranscriptView";
import { TranscriptButtonGroup } from "./TranscriptButtonGroup";
import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";
import {
  applyRememberedSourceLabel,
  rememberSourceLabel,
} from "@/lib/sourceLabelMemory";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";

interface TranscriptPanelProps {
  transcripts: Transcript[];
  customPrompt: string;
  onPromptChange: (value: string) => void;
  onCopyTranscript: () => void;
  onOpenMeetingFolder: () => Promise<void>;
  isRecording: boolean;
  disableAutoScroll?: boolean;

  // Optional pagination props (when using virtualization)
  usePagination?: boolean;
  segments?: TranscriptSegmentData[];
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;

  // Retranscription props
  meetingId?: string;
  meetingFolderPath?: string | null;
  onRefetchTranscripts?: () => Promise<void>;
}

export function TranscriptPanel({
  transcripts,
  customPrompt,
  onPromptChange,
  onCopyTranscript,
  onOpenMeetingFolder,
  isRecording,
  disableAutoScroll = false,
  usePagination = false,
  segments,
  hasMore,
  isLoadingMore,
  totalCount,
  loadedCount,
  onLoadMore,
  meetingId,
  meetingFolderPath,
  onRefetchTranscripts,
}: TranscriptPanelProps) {
  const sourceTracks = useMemo(
    () =>
      Array.from(
        new Set(
          transcripts
            .map((transcript) => transcript.source)
            .filter((source): source is string => Boolean(source)),
        ),
      ).sort(),
    [transcripts],
  );
  const [sourceToRelabel, setSourceToRelabel] = useState("");
  const [replacementSource, setReplacementSource] = useState("");
  const [relabelStatus, setRelabelStatus] = useState<string | null>(null);
  const [isRelabeling, setIsRelabeling] = useState(false);
  const [rememberForFuture, setRememberForFuture] = useState(false);
  const [meetingAudioPath, setMeetingAudioPath] = useState<string | null>(null);
  const audioPlayer = useAudioPlayer(meetingAudioPath);

  useEffect(() => {
    let cancelled = false;
    setMeetingAudioPath(null);
    if (meetingId) {
      invoke<string | null>("api_get_meeting_audio_path", { meetingId })
        .then((path) => {
          if (!cancelled) setMeetingAudioPath(path);
        })
        .catch(() => {
          if (!cancelled) setMeetingAudioPath(null);
        });
    }
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!sourceTracks.includes(sourceToRelabel)) {
      setSourceToRelabel(sourceTracks[0] ?? "");
    }
  }, [sourceTracks, sourceToRelabel]);

  const relabelSourceTrack = async () => {
    if (!meetingId || !sourceToRelabel || !replacementSource.trim()) return;
    setIsRelabeling(true);
    setRelabelStatus(null);
    try {
      const changed = await invoke<number>("api_rename_meeting_speaker_label", {
        meetingId,
        fromLabel: sourceToRelabel,
        toLabel: replacementSource,
      });
      setRelabelStatus(
        changed
          ? `Updated ${changed} local segment${changed === 1 ? "" : "s"}.`
          : "No matching local segments were changed.",
      );
      if (
        changed > 0 &&
        rememberForFuture &&
        (sourceToRelabel === "Me" || sourceToRelabel === "Remote participant")
      ) {
        rememberSourceLabel(sourceToRelabel, replacementSource);
        setRelabelStatus(
          `Updated ${changed} local segment${changed === 1 ? "" : "s"} and remembered this label for future local recordings.`,
        );
      }
      setReplacementSource("");
      setRememberForFuture(false);
      await onRefetchTranscripts?.();
    } catch (error) {
      setRelabelStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsRelabeling(false);
    }
  };

  const [findText, setFindText] = useState("");
  const [replaceText, setReplaceText] = useState("");
  const [replacePreview, setReplacePreview] = useState<
    Array<{
      transcript_id: string;
      before_text: string;
      after_text: string;
      occurrences: number;
    }>
  >([]);
  const [replaceStatus, setReplaceStatus] = useState<string | null>(null);
  const splitMeeting = async () => {
    if (!meetingId) return;
    const raw = window.prompt(
      "Split this meeting at recording seconds (for example, 180).",
    );
    if (!raw) return;
    const splitSeconds = Number(raw);
    if (!Number.isFinite(splitSeconds) || splitSeconds <= 0) return;
    try {
      const newMeetingId = await invoke<string>("api_split_meeting", {
        meetingId,
        splitSeconds,
        newTitle: null,
      });
      setReplaceStatus(
        `Created a local second meeting (${newMeetingId.slice(0, 8)}…) and rebased its evidence.`,
      );
      await onRefetchTranscripts?.();
    } catch (error) {
      setReplaceStatus(error instanceof Error ? error.message : String(error));
    }
  };
  const reviseSegmentText = async (transcriptId: string, text: string) => {
    if (!meetingId)
      throw new Error(
        "A meeting must be selected before editing a transcript.",
      );
    const changed = await invoke<boolean>(
      "api_revise_meeting_transcript_segment",
      {
        meetingId,
        transcriptId,
        text,
      },
    );
    if (!changed) throw new Error("No local transcript change was saved.");
    await onRefetchTranscripts?.();
  };

  const getSegmentRevisions = async (transcriptId: string) => {
    if (!meetingId)
      throw new Error(
        "A meeting must be selected before viewing transcript history.",
      );
    return invoke("api_get_meeting_transcript_segment_revisions", {
      meetingId,
      transcriptId,
    }) as Promise<
      Array<{
        id: string;
        previous_text: string;
        revised_text: string;
        changed_at: string;
      }>
    >;
  };

  // Convert transcripts to segments if pagination is not used but we want virtualization
  const convertedSegments = useMemo(() => {
    if (usePagination && segments) {
      return segments.map((segment) => ({
        ...segment,
        source: applyRememberedSourceLabel(segment.source) || undefined,
      }));
    }
    // Convert transcripts to segments for virtualization
    return transcripts.map((t) => ({
      id: t.id,
      timestamp: t.audio_start_time ?? 0,
      endTime: t.audio_end_time,
      text: t.text,
      confidence: t.confidence,
      source: applyRememberedSourceLabel(t.source) || undefined,
    }));
  }, [transcripts, usePagination, segments]);

  return (
    <div className="hidden md:flex md:w-1/4 lg:w-1/3 min-w-0 border-r border-gray-200 bg-white flex-col relative shrink-0">
      {/* Title area */}
      <div className="p-4 border-b border-gray-200">
        <TranscriptButtonGroup
          transcriptCount={
            usePagination
              ? (totalCount ?? convertedSegments.length)
              : transcripts?.length || 0
          }
          onCopyTranscript={onCopyTranscript}
          onOpenMeetingFolder={onOpenMeetingFolder}
          meetingId={meetingId}
          meetingFolderPath={meetingFolderPath}
          onRefetchTranscripts={onRefetchTranscripts}
        />
        {!isRecording && meetingId && convertedSegments.length > 1 && (
          <div className="mt-2 flex items-center justify-between gap-2 rounded border border-slate-200 bg-slate-50 px-2 py-1.5">
            <p className="text-[11px] text-slate-600">
              Repair a recording by splitting it at a timestamp.
            </p>
            <button
              type="button"
              onClick={() => void splitMeeting()}
              className="shrink-0 rounded border border-slate-300 bg-white px-2 py-1 text-xs text-slate-700 hover:bg-slate-100"
            >
              Split meeting
            </button>
          </div>
        )}{" "}
        {!isRecording && meetingAudioPath && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
            <div className="flex items-center justify-between gap-2">
              <p className="text-xs font-medium text-slate-700">
                Local recording
              </p>
              <button
                type="button"
                onClick={() => {
                  void (audioPlayer.isPlaying
                    ? audioPlayer.pause()
                    : audioPlayer.play());
                }}
                className="rounded bg-slate-700 px-2 py-1 text-xs text-white"
              >
                {audioPlayer.isPlaying ? "Pause" : "Play"}
              </button>
            </div>
            <input
              aria-label="Recording position"
              type="range"
              min="0"
              max={audioPlayer.duration || 0}
              step="0.1"
              value={audioPlayer.currentTime}
              onChange={(event) => audioPlayer.seek(Number(event.target.value))}
              className="mt-2 w-full"
              disabled={!audioPlayer.duration}
            />
            <p className="text-[11px] text-slate-500">
              {Math.floor(audioPlayer.currentTime)}s /{" "}
              {Math.floor(audioPlayer.duration)}s
            </p>
            {audioPlayer.error && (
              <p role="status" className="mt-1 text-xs text-rose-600">
                {audioPlayer.error}
              </p>
            )}
          </div>
        )}
        {!isRecording && meetingId && sourceTracks.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-2">
            <p className="text-xs font-medium text-slate-700">
              Correct local speaker label
            </p>
            <p className="mt-0.5 text-xs text-slate-500">
              Renames a local speaker label for this meeting. It does not infer
              identity or send data anywhere.
            </p>
            <div className="mt-2 flex gap-1">
              <select
                aria-label="Speaker label to rename"
                value={sourceToRelabel}
                onChange={(event) => setSourceToRelabel(event.target.value)}
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
              >
                {sourceTracks.map((source) => (
                  <option key={source} value={source}>
                    {source}
                  </option>
                ))}
              </select>
              <input
                aria-label="New speaker label"
                value={replacementSource}
                maxLength={80}
                onChange={(event) => setReplacementSource(event.target.value)}
                placeholder="New label"
                className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-1.5 py-1 text-xs"
              />
              <button
                type="button"
                onClick={relabelSourceTrack}
                disabled={isRelabeling || !replacementSource.trim()}
                className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:cursor-not-allowed disabled:opacity-50"
              >
                {isRelabeling ? "Saving…" : "Apply"}
              </button>
            </div>
            {(sourceToRelabel === "Me" ||
              sourceToRelabel === "Remote participant") && (
              <label className="mt-2 flex items-center gap-1.5 text-xs text-slate-600">
                <input
                  type="checkbox"
                  checked={rememberForFuture}
                  onChange={(event) =>
                    setRememberForFuture(event.target.checked)
                  }
                />
                Remember this explicit label for future local recordings
              </label>
            )}
            {relabelStatus && (
              <p role="status" className="mt-1 text-xs text-slate-600">
                {relabelStatus}
              </p>
            )}
          </div>
        )}
      </div>

      {!isRecording && meetingId && (
        <div className="mt-3 rounded-md border border-slate-200 bg-white p-2">
          <p className="text-xs font-medium text-slate-700">
            Find and replace transcript text
          </p>
          <p className="mt-0.5 text-xs text-slate-500">
            Preview is local; applying creates revision history for every
            changed segment.
          </p>
          <div className="mt-2 grid grid-cols-2 gap-1">
            <input
              aria-label="Find transcript text"
              value={findText}
              onChange={(event) => setFindText(event.target.value)}
              placeholder="Find"
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
            <input
              aria-label="Replacement transcript text"
              value={replaceText}
              onChange={(event) => setReplaceText(event.target.value)}
              placeholder="Replace with"
              className="rounded border border-slate-300 px-1.5 py-1 text-xs"
            />
          </div>
          <div className="mt-1 flex gap-1">
            <button
              type="button"
              disabled={!findText.trim()}
              onClick={async () => {
                try {
                  const result = await invoke<typeof replacePreview>(
                    "api_preview_meeting_transcript_replace",
                    { meetingId, findText, replaceText },
                  );
                  setReplacePreview(result);
                  setReplaceStatus(
                    result.length
                      ? `${result.length} segment${result.length === 1 ? "" : "s"} will change.`
                      : "No exact matches found.",
                  );
                } catch (error) {
                  setReplaceStatus(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
              className="rounded border border-slate-300 px-2 py-1 text-xs disabled:opacity-50"
            >
              Preview
            </button>
            <button
              type="button"
              disabled={!replacePreview.length}
              onClick={async () => {
                try {
                  const changed = await invoke<number>(
                    "api_apply_meeting_transcript_replace",
                    { meetingId, findText, replaceText },
                  );
                  setReplacePreview([]);
                  setReplaceStatus(
                    `Updated ${changed} segment${changed === 1 ? "" : "s"} with revision history.`,
                  );
                  await onRefetchTranscripts?.();
                } catch (error) {
                  setReplaceStatus(
                    error instanceof Error ? error.message : String(error),
                  );
                }
              }}
              className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
            >
              Apply
            </button>
          </div>
          {replacePreview.length > 0 && (
            <p className="mt-1 max-h-16 overflow-auto text-xs text-slate-600">
              {replacePreview
                .map((item) => `${item.occurrences}× in ${item.transcript_id}`)
                .join(" · ")}
            </p>
          )}
          {replaceStatus && (
            <p role="status" className="mt-1 text-xs text-slate-600">
              {replaceStatus}
            </p>
          )}
        </div>
      )}
      {/* Transcript content - use virtualized view for better performance */}
      <div className="flex-1 overflow-hidden pb-4">
        <VirtualizedTranscriptView
          segments={convertedSegments}
          isRecording={isRecording}
          isPaused={false}
          isProcessing={false}
          isStopping={false}
          enableStreaming={false}
          showConfidence={true}
          disableAutoScroll={disableAutoScroll}
          hasMore={hasMore}
          isLoadingMore={isLoadingMore}
          totalCount={totalCount}
          loadedCount={loadedCount}
          onLoadMore={onLoadMore}
          onEditSegment={
            !isRecording && meetingId ? reviseSegmentText : undefined
          }
          getSegmentRevisions={
            !isRecording && meetingId ? getSegmentRevisions : undefined
          }
          onSeekSegment={
            !isRecording && meetingAudioPath
              ? (seconds) => {
                  void audioPlayer.seek(seconds);
                }
              : undefined
          }
        />
      </div>

      {/* Custom prompt input at bottom of transcript section */}
      {!isRecording && convertedSegments.length > 0 && (
        <div className="p-1 border-t border-gray-200">
          <textarea
            placeholder="Add context for AI summary. For example people involved, meeting overview, objective etc..."
            className="w-full px-3 py-2 border border-gray-200 rounded-md text-sm focus:outline-none focus:ring-1 focus:ring-blue-500 focus:border-blue-500 bg-white shadow-sm min-h-[80px] resize-y"
            value={customPrompt}
            onChange={(e) => onPromptChange(e.target.value)}
          />
        </div>
      )}
    </div>
  );
}

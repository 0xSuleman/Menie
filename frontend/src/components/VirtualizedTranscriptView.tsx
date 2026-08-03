"use client";

import {
  useCallback,
  useRef,
  useReducer,
  startTransition,
  useEffect,
  useState,
  memo,
} from "react";
import { useVirtualizer } from "@tanstack/react-virtual";
import { useAutoScroll } from "@/hooks/useAutoScroll";
import { useTranscriptStreaming } from "@/hooks/useTranscriptStreaming";
import { ConfidenceIndicator } from "./ConfidenceIndicator";
import { Tooltip, TooltipContent, TooltipTrigger } from "./ui/tooltip";
import { RecordingStatusBar } from "./RecordingStatusBar";
import { motion, AnimatePresence } from "framer-motion";
import { TranscriptSegmentData } from "@/types";

export interface VirtualizedTranscriptViewProps {
  /** Transcript segments to display */
  segments: TranscriptSegmentData[];
  /** Whether recording is in progress */
  isRecording?: boolean;
  /** Whether recording is paused */
  isPaused?: boolean;
  /** Whether processing/finalizing transcription */
  isProcessing?: boolean;
  /** Whether stopping */
  isStopping?: boolean;
  /** Enable streaming effect for latest segment */
  enableStreaming?: boolean;
  /** Show confidence indicators */
  showConfidence?: boolean;
  /** Completely disable auto-scroll behavior (for meeting details page) */
  disableAutoScroll?: boolean;

  // Pagination props (infinite scroll)
  hasMore?: boolean;
  isLoadingMore?: boolean;
  totalCount?: number;
  loadedCount?: number;
  onLoadMore?: () => void;
  /** Optional local-only correction handler for finalized transcript segments. */
  onEditSegment?: (segmentId: string, text: string) => Promise<void>;
  getSegmentRevisions?: (segmentId: string) => Promise<TranscriptRevision[]>;
  /** Seek local recording playback to a transcript timestamp. */
  onSeekSegment?: (seconds: number) => void;
}

interface TranscriptRevision {
  id: string;
  previous_text: string;
  revised_text: string;
  changed_at: string;
}

// Threshold for enabling virtualization (below this, use simple rendering)
const VIRTUALIZATION_THRESHOLD = 10;

// Helper function to format seconds as recording-relative time [MM:SS]
function formatRecordingTime(seconds: number | undefined): string {
  if (seconds === undefined) return "[--:--]";

  const totalSeconds = Math.floor(seconds);
  const minutes = Math.floor(totalSeconds / 60);
  const secs = totalSeconds % 60;

  return `[${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}]`;
}

// Helper function to remove filler words and repetitions
function cleanStopWords(text: string): string {
  const stopWords = ["uh", "um", "er", "ah", "hmm", "hm", "eh", "oh"];

  let cleanedText = text;
  stopWords.forEach((word) => {
    const pattern = new RegExp(`\\b${word}\\b[,\\s]*`, "gi");
    cleanedText = cleanedText.replace(pattern, " ");
  });

  return cleanedText.replace(/\s+/g, " ").trim();
}

// Memoized transcript segment component
const TranscriptSegment = memo(function TranscriptSegment({
  id,
  timestamp,
  text,
  confidence,
  source,
  isStreaming,
  showConfidence,
  onEditSegment,
  getSegmentRevisions,
  onSeekSegment,
}: {
  id: string;
  timestamp: number;
  text: string;
  confidence?: number;
  source?: string;
  isStreaming: boolean;
  showConfidence: boolean;
  onEditSegment?: (segmentId: string, text: string) => Promise<void>;
  getSegmentRevisions?: (segmentId: string) => Promise<TranscriptRevision[]>;
  /** Seek local recording playback to a transcript timestamp. */
  onSeekSegment?: (seconds: number) => void;
}) {
  const displayText =
    cleanStopWords(text) || (text.trim() === "" ? "[Silence]" : text);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [revisions, setRevisions] = useState<TranscriptRevision[] | null>(null);
  const [loadingHistory, setLoadingHistory] = useState(false);

  const loadHistory = async () => {
    if (!getSegmentRevisions) return;
    setLoadingHistory(true);
    setError(null);
    try {
      setRevisions(await getSegmentRevisions(id));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not load local revision history.",
      );
    } finally {
      setLoadingHistory(false);
    }
  };

  const save = async () => {
    if (!onEditSegment || !draft.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onEditSegment(id, draft);
      setEditing(false);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not save this local correction.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <div id={`segment-${id}`} className="mb-3">
      <div className="flex items-start gap-2">
        <Tooltip>
          <TooltipTrigger>
            <span className="text-xs text-gray-400 mt-1 flex-shrink-0 min-w-[50px]">
              {onSeekSegment ? (
                <button
                  type="button"
                  onClick={() => onSeekSegment(timestamp)}
                  className="text-xs text-gray-400 underline decoration-dotted hover:text-slate-700"
                  aria-label={`Play recording from ${formatRecordingTime(timestamp)}`}
                >
                  {formatRecordingTime(timestamp)}
                </button>
              ) : (
                formatRecordingTime(timestamp)
              )}
            </span>
          </TooltipTrigger>
          <TooltipContent>
            {confidence !== undefined && showConfidence && (
              <ConfidenceIndicator
                confidence={confidence}
                showIndicator={showConfidence}
              />
            )}
          </TooltipContent>
        </Tooltip>
        <div className="flex-1">
          {source && (
            <div className="mb-0.5 text-xs font-medium text-slate-500">
              {source}
            </div>
          )}
          {editing ? (
            <div className="space-y-2">
              <textarea
                aria-label={`Correct transcript segment at ${formatRecordingTime(timestamp)}`}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                className="min-h-20 w-full rounded border border-slate-300 px-2 py-1 text-sm"
                maxLength={20000}
              />
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={() => void save()}
                  disabled={saving || !draft.trim()}
                  className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
                >
                  {saving ? "Savingâ€¦" : "Save correction"}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setDraft(text);
                    setEditing(false);
                    setError(null);
                  }}
                  disabled={saving}
                  className="rounded border border-slate-300 px-2 py-1 text-xs text-slate-700"
                >
                  Cancel
                </button>
              </div>
              {error && (
                <p role="alert" className="text-xs text-red-700">
                  {error}
                </p>
              )}
            </div>
          ) : isStreaming ? (
            <div className="bg-gray-100 border border-gray-200 rounded-lg px-3 py-2">
              <p className="text-base text-gray-800 leading-relaxed">
                {displayText}
              </p>
            </div>
          ) : (
            <p className="text-base text-gray-800 leading-relaxed">
              {displayText}
            </p>
          )}
          {onEditSegment && !isStreaming && !editing && (
            <div className="mt-1 flex gap-2">
              <button
                type="button"
                onClick={() => setEditing(true)}
                className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
              >
                Correct text
              </button>
              {getSegmentRevisions && (
                <button
                  type="button"
                  onClick={() => void loadHistory()}
                  className="text-xs font-medium text-slate-600 underline hover:text-slate-900"
                >
                  {loadingHistory ? "Loading historyâ€¦" : "History"}
                </button>
              )}
            </div>
          )}
          {revisions && (
            <div className="mt-2 rounded border border-slate-200 bg-slate-50 p-2 text-xs text-slate-700">
              <p className="font-medium">Local revision history</p>
              {revisions.length === 0 ? (
                <p className="mt-1 text-slate-500">No corrections recorded.</p>
              ) : (
                revisions.map((revision) => (
                  <div
                    key={revision.id}
                    className="mt-2 border-t border-slate-200 pt-2"
                  >
                    <p className="text-slate-500">
                      {new Date(revision.changed_at).toLocaleString()}
                    </p>
                    <p>
                      <span className="font-medium">Before:</span>{" "}
                      {revision.previous_text}
                    </p>
                    <p>
                      <span className="font-medium">After:</span>{" "}
                      {revision.revised_text}
                    </p>
                  </div>
                ))
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

export const VirtualizedTranscriptView: React.FC<
  VirtualizedTranscriptViewProps
> = ({
  segments,
  isRecording = false,
  isPaused = false,
  isProcessing = false,
  isStopping = false,
  enableStreaming = false,
  showConfidence = true,
  disableAutoScroll = false,
  hasMore = false,
  isLoadingMore = false,
  totalCount = 0,
  loadedCount = 0,
  onLoadMore,
  onEditSegment,
  getSegmentRevisions,
  onSeekSegment,
}) => {
  // Create scroll ref first - shared between virtualizer and auto-scroll hook
  const scrollRef = useRef<HTMLDivElement>(null);
  // Ref for infinite scroll trigger element
  const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

  // Force re-render without flushSync (avoids React warning)
  const [, rerender] = useReducer((x: number) => x + 1, 0);

  // Setup virtualizer for efficient rendering of large lists
  const virtualizer = useVirtualizer({
    count: segments.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => 60, // Estimated height per segment
    overscan: 10, // Render extra items above/below viewport
    onChange: () => {
      startTransition(() => {
        rerender();
      });
    },
  });

  // Custom hook for auto-scrolling (supports both virtualized and non-virtualized)
  useAutoScroll({
    scrollRef,
    segments,
    isRecording,
    isPaused,
    virtualizer,
    virtualizationThreshold: VIRTUALIZATION_THRESHOLD,
    disableAutoScroll,
  });

  // Streaming text effect hook (typewriter animation for new transcripts)
  const { streamingSegmentId, getDisplayText } = useTranscriptStreaming(
    segments,
    isRecording,
    enableStreaming,
  );

  // Infinite scroll: IntersectionObserver to trigger loading more
  useEffect(() => {
    if (
      !onLoadMore ||
      !hasMore ||
      isLoadingMore ||
      isRecording ||
      segments.length === 0
    ) {
      return;
    }

    const triggerElement = loadMoreTriggerRef.current;
    if (!triggerElement) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isLoadingMore) {
          onLoadMore();
        }
      },
      {
        root: null,
        rootMargin: "100px",
        threshold: 0,
      },
    );

    observer.observe(triggerElement);

    return () => observer.disconnect();
  }, [hasMore, isLoadingMore, onLoadMore, isRecording, segments.length]);

  // Scroll-based fallback for fast scrolling
  useEffect(() => {
    if (!onLoadMore || !hasMore || isLoadingMore || isRecording) return;

    const scrollElement = scrollRef.current;
    if (!scrollElement) return;

    let ticking = false;

    const handleScroll = () => {
      if (ticking || isLoadingMore || !hasMore) return;

      ticking = true;
      requestAnimationFrame(() => {
        const { scrollTop, scrollHeight, clientHeight } = scrollElement;
        const scrollBottom = scrollHeight - scrollTop - clientHeight;

        // Trigger load when within 200px of bottom
        if (scrollBottom < 200 && hasMore && !isLoadingMore) {
          onLoadMore();
        }
        ticking = false;
      });
    };

    scrollElement.addEventListener("scroll", handleScroll, { passive: true });
    return () => scrollElement.removeEventListener("scroll", handleScroll);
  }, [onLoadMore, hasMore, isLoadingMore, isRecording]);

  // Use simple rendering for small lists, virtualization for large lists
  const useVirtualization = segments.length >= VIRTUALIZATION_THRESHOLD;

  return (
    <div
      ref={scrollRef}
      className="flex flex-col h-full overflow-y-auto px-4 py-2"
    >
      {/* Recording Status Bar - Sticky at top, always visible when recording */}
      <AnimatePresence>
        {isRecording && (
          <div className="sticky top-0 z-10 bg-white pb-2">
            <RecordingStatusBar isPaused={isPaused} />
          </div>
        )}
      </AnimatePresence>

      {/* Content - add padding when recording to prevent overlap */}
      <div className={isRecording ? "pt-2" : ""}>
        {segments.length === 0 ? (
          // Empty state
          <motion.div
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="text-center text-gray-500 mt-8"
          >
            {isRecording ? (
              <>
                <div className="flex items-center justify-center mb-3">
                  <div
                    className={`w-3 h-3 rounded-full ${isPaused ? "bg-orange-500" : "bg-blue-500 animate-pulse"}`}
                  ></div>
                </div>
                <p className="text-sm text-gray-600">
                  {isPaused ? "Recording paused" : "Listening for speech..."}
                </p>
                <p className="text-xs mt-1 text-gray-400">
                  {isPaused
                    ? "Click resume to continue recording"
                    : "Speak to see live transcription"}
                </p>
              </>
            ) : (
              <div className="menie-home-grid mt-10 px-3 text-left">
                <section className="brand-card rounded-2xl p-8">
                  <img
                    src="/menie-logo.png"
                    alt="MENIE logo"
                    className="hidden"
                  />
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-blue-600">
                    Your meeting workspace
                  </p>
                  <h1 className="mt-3 max-w-xl font-brand text-4xl leading-tight tracking-normal text-slate-950">
                    Ready for your next conversation?
                  </h1>
                  <p className="mt-2 text-sm leading-6 text-slate-500">
                    Capture the conversation. MENIE turns it into clear notes,
                    decisions, and next steps—locally.
                  </p>
                  <div className="mt-7 flex flex-wrap gap-3 text-sm">
                    <span className="rounded-md bg-blue-50 px-3 py-2 font-medium text-blue-700">
                      Local by default
                    </span>
                    <span className="rounded-md bg-slate-100 px-3 py-2 font-medium text-slate-700">
                      Private workspace
                    </span>
                  </div>
                </section>
                <aside className="rounded-2xl border border-slate-200 bg-slate-950 p-7 text-white">
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-300">
                    A simple flow
                  </p>
                  <ol className="mt-5 space-y-5 text-sm">
                    <li>
                      <span className="mr-3 text-cyan-300">01</span>Choose your
                      microphone
                    </li>
                    <li>
                      <span className="mr-3 text-cyan-300">02</span>Start the
                      conversation
                    </li>
                    <li>
                      <span className="mr-3 text-cyan-300">03</span>Review notes
                      and next steps
                    </li>
                  </ol>
                </aside>
              </div>
            )}
          </motion.div>
        ) : useVirtualization ? (
          // Virtualized rendering for large lists
          <>
            <div
              style={{
                height: virtualizer.getTotalSize(),
                width: "100%",
                position: "relative",
              }}
            >
              {virtualizer.getVirtualItems().map((virtualRow) => {
                const segment = segments[virtualRow.index];
                const isStreaming = streamingSegmentId === segment.id;

                return (
                  <div
                    key={segment.id}
                    data-audio-start={segment.timestamp}
                    data-index={virtualRow.index}
                    ref={virtualizer.measureElement}
                    style={{
                      position: "absolute",
                      top: 0,
                      left: 0,
                      width: "100%",
                      transform: `translateY(${virtualRow.start}px)`,
                    }}
                  >
                    <TranscriptSegment
                      id={segment.id}
                      timestamp={segment.timestamp}
                      text={getDisplayText(segment)}
                      confidence={segment.confidence}
                      source={segment.source}
                      isStreaming={isStreaming}
                      showConfidence={showConfidence}
                      onEditSegment={onEditSegment}
                      getSegmentRevisions={getSegmentRevisions}
                      onSeekSegment={onSeekSegment}
                    />
                  </div>
                );
              })}
            </div>

            {/* Infinite scroll trigger and loading indicator */}
            {(hasMore || isLoadingMore) &&
              !isRecording &&
              segments.length > 0 && (
                <div
                  ref={loadMoreTriggerRef}
                  className="flex justify-center items-center py-4 mt-2"
                >
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading more...</span>
                    </div>
                  ) : hasMore && totalCount > 0 ? (
                    <span className="text-sm text-gray-400">
                      Showing {loadedCount} of {totalCount} segments
                    </span>
                  ) : null}
                </div>
              )}

            {/* Listening indicator when recording */}
            {!isStopping &&
              isRecording &&
              !isPaused &&
              !isProcessing &&
              segments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 mt-4 text-gray-500"
                >
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Listening...</span>
                </motion.div>
              )}
          </>
        ) : (
          // Simple rendering for small lists (better animations)
          <>
            <div className="space-y-1">
              {segments.map((segment) => {
                const isStreaming = streamingSegmentId === segment.id;

                return (
                  <motion.div
                    key={segment.id}
                    data-audio-start={segment.timestamp}
                    initial={{ opacity: 0, y: 5 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.15 }}
                  >
                    <TranscriptSegment
                      id={segment.id}
                      timestamp={segment.timestamp}
                      text={getDisplayText(segment)}
                      confidence={segment.confidence}
                      source={segment.source}
                      isStreaming={isStreaming}
                      showConfidence={showConfidence}
                      onEditSegment={onEditSegment}
                      getSegmentRevisions={getSegmentRevisions}
                      onSeekSegment={onSeekSegment}
                    />
                  </motion.div>
                );
              })}
            </div>

            {/* Infinite scroll trigger (for small lists that grow) */}
            {(hasMore || isLoadingMore) &&
              !isRecording &&
              segments.length > 0 && (
                <div
                  ref={loadMoreTriggerRef}
                  className="flex justify-center items-center py-4 mt-2"
                >
                  {isLoadingMore ? (
                    <div className="flex items-center gap-2 text-gray-500">
                      <div className="w-4 h-4 border-2 border-gray-300 border-t-gray-600 rounded-full animate-spin" />
                      <span className="text-sm">Loading more...</span>
                    </div>
                  ) : hasMore && totalCount > 0 ? (
                    <span className="text-sm text-gray-400">
                      Showing {loadedCount} of {totalCount} segments
                    </span>
                  ) : null}
                </div>
              )}

            {/* Listening indicator when recording */}
            {!isStopping &&
              isRecording &&
              !isPaused &&
              !isProcessing &&
              segments.length > 0 && (
                <motion.div
                  initial={{ opacity: 0 }}
                  animate={{ opacity: 1 }}
                  exit={{ opacity: 0 }}
                  className="flex items-center gap-2 mt-4 text-gray-500"
                >
                  <div className="w-2 h-2 bg-blue-500 rounded-full animate-pulse"></div>
                  <span className="text-sm">Listening...</span>
                </motion.div>
              )}
          </>
        )}
      </div>
    </div>
  );
};

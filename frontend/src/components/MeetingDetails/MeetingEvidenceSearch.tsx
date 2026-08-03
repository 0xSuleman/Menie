"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Button } from "@/components/ui/button";

type EvidenceResult =
  | {
      Evidence: {
        citations: Array<{
          meeting_id: string;
          timestamp_seconds: number;
          text: string;
        }>;
      };
    }
  | {
      Generated: {
        answer: string;
        citations: Array<{
          meeting_id: string;
          timestamp_seconds: number;
          text: string;
        }>;
      };
    }
  | {
      InsufficientEvidence: {
        message: string;
        closest: Array<{
          meeting_id: string;
          timestamp_seconds: number;
          text: string;
        }>;
      };
    };

const formatTime = (seconds: number) => {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)
    .toString()
    .padStart(2, "0")}:${(total % 60).toString().padStart(2, "0")}`;
};

type EvidenceTurn = { query: string; scope: string; result: EvidenceResult };
type MeetingClip = {
  id: string;
  meeting_id: string;
  start_seconds: number;
  end_seconds: number;
  clip_file: string;
  checksum_sha256: string;
  created_at: string;
};
type MeetingComment = {
  id: string;
  meeting_id: string;
  author: string;
  body: string;
  resolved_at?: string | null;
  created_at: string;
};
type MeetingAttachment = {
  id: string;
  meeting_id: string;
  file_path: string;
  mime_type: string;
  checksum_sha256: string;
  offset_seconds?: number | null;
  created_at: string;
};

export function MeetingEvidenceSearch({
  meetingId,
  project,
  onCitationClick,
}: {
  meetingId: string;
  project?: string;
  onCitationClick?: (timestampSeconds: number) => void;
}) {
  const [query, setQuery] = useState("");
  const [scope, setScope] = useState<"meeting" | "project" | "library">(
    "meeting",
  );
  const [result, setResult] = useState<EvidenceResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [history, setHistory] = useState<EvidenceTurn[]>([]);
  const [excluded, setExcluded] = useState(false);
  const [projectExcluded, setProjectExcluded] = useState(false);
  const [savingExclusion, setSavingExclusion] = useState(false);
  const [clipStatus, setClipStatus] = useState<string | null>(null);
  const [clips, setClips] = useState<MeetingClip[]>([]);
  const [comments, setComments] = useState<MeetingComment[]>([]);
  const [commentBody, setCommentBody] = useState("");
  const [commentAuthor, setCommentAuthor] = useState("");
  const [commentStatus, setCommentStatus] = useState<string | null>(null);
  const [attachments, setAttachments] = useState<MeetingAttachment[]>([]);
  const [attachmentOffset, setAttachmentOffset] = useState("");

  useEffect(() => {
    let active = true;
    invoke<boolean>("api_get_meeting_knowledge_excluded", { meetingId })
      .then((value) => {
        if (active) setExcluded(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [meetingId]);

  useEffect(() => {
    let active = true;
    invoke<MeetingAttachment[]>("api_get_meeting_attachments", { meetingId })
      .then((value) => {
        if (active) setAttachments(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [meetingId]);

  useEffect(() => {
    let active = true;
    invoke<MeetingComment[]>("api_get_meeting_comments", { meetingId })
      .then((value) => {
        if (active) setComments(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [meetingId]);

  useEffect(() => {
    if (!project) return;
    let active = true;
    invoke<boolean>("api_get_project_knowledge_excluded", { project })
      .then((value) => {
        if (active) setProjectExcluded(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [project]);

  useEffect(() => {
    let active = true;
    invoke<MeetingClip[]>("api_get_meeting_clips", { meetingId })
      .then((value) => {
        if (active) setClips(value);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [meetingId]);

  const search = async () => {
    if (excluded) return;
    setLoading(true);
    try {
      const command =
        scope === "meeting"
          ? "api_query_meeting_evidence"
          : "api_query_library_evidence";
      const nextResult = await invoke<EvidenceResult>(
        command,
        scope === "meeting"
          ? { meetingId, query }
          : { query, project: scope === "project" ? project || null : null },
      );
      setResult(nextResult);
      setHistory((previous) =>
        [...previous, { query: query.trim(), scope, result: nextResult }].slice(
          -8,
        ),
      );
    } finally {
      setLoading(false);
    }
  };

  const createClip = async (citation: {
    meeting_id: string;
    timestamp_seconds: number;
  }) => {
    setClipStatus("Creating local clip…");
    try {
      await invoke("api_create_audio_clip", {
        meetingId: citation.meeting_id,
        startSeconds: Math.max(0, citation.timestamp_seconds - 30),
        endSeconds: citation.timestamp_seconds + 30,
      });
      setClips(
        await invoke<MeetingClip[]>("api_get_meeting_clips", { meetingId }),
      );
      setClipStatus("Local 60-second clip created with provenance.");
    } catch (reason) {
      setClipStatus(
        reason instanceof Error
          ? reason.message
          : "Could not create a local clip.",
      );
    }
  };

  const deleteClip = async (clipId: string) => {
    try {
      await invoke("api_delete_meeting_clip", { clipId });
      setClips((previous) => previous.filter((clip) => clip.id !== clipId));
      setClipStatus("Local clip removed.");
    } catch (reason) {
      setClipStatus(
        reason instanceof Error
          ? reason.message
          : "Could not remove the local clip.",
      );
    }
  };

  const addComment = async () => {
    if (!commentBody.trim()) return;
    setCommentStatus("Saving local review note…");
    try {
      const comment = await invoke<MeetingComment>("api_add_meeting_comment", {
        meetingId,
        author: commentAuthor,
        body: commentBody,
      });
      setComments((previous) => [...previous, comment]);
      setCommentBody("");
      setCommentStatus("Local review note saved.");
    } catch (reason) {
      setCommentStatus(
        reason instanceof Error
          ? reason.message
          : "Could not save the local review note.",
      );
    }
  };

  const toggleComment = async (comment: MeetingComment) => {
    try {
      await invoke("api_resolve_meeting_comment", {
        commentId: comment.id,
        resolved: !comment.resolved_at,
      });
      setComments((previous) =>
        previous.map((item) =>
          item.id === comment.id
            ? {
                ...item,
                resolved_at: comment.resolved_at
                  ? null
                  : new Date().toISOString(),
              }
            : item,
        ),
      );
    } catch (reason) {
      setCommentStatus(
        reason instanceof Error
          ? reason.message
          : "Could not update the local review note.",
      );
    }
  };

  const addAttachment = async () => {
    setClipStatus("Choose a local image or whiteboard…");
    try {
      const parsedOffset = attachmentOffset.trim()
        ? Number(attachmentOffset)
        : null;
      const attachment = await invoke<MeetingAttachment | null>(
        "api_add_meeting_attachment",
        { meetingId, offsetSeconds: parsedOffset },
      );
      if (attachment) {
        setAttachments((previous) => [attachment, ...previous]);
        setClipStatus("Local image attached with a checksum.");
      } else setClipStatus(null);
    } catch (reason) {
      setClipStatus(
        reason instanceof Error
          ? reason.message
          : "Could not attach the local image.",
      );
    }
  };

  const deleteAttachment = async (attachmentId: string) => {
    try {
      await invoke("api_delete_meeting_attachment", { attachmentId });
      setAttachments((previous) =>
        previous.filter((attachment) => attachment.id !== attachmentId),
      );
    } catch (reason) {
      setClipStatus(
        reason instanceof Error
          ? reason.message
          : "Could not remove the attachment.",
      );
    }
  };

  const toggleExclusion = async () => {
    setSavingExclusion(true);
    try {
      const next = !excluded;
      await invoke("api_set_meeting_knowledge_excluded", {
        meetingId,
        excluded: next,
      });
      setExcluded(next);
      setResult(null);
      setHistory([]);
    } finally {
      setSavingExclusion(false);
    }
  };

  const toggleProjectExclusion = async () => {
    if (!project) return;
    setSavingExclusion(true);
    try {
      const next = !projectExcluded;
      await invoke("api_set_project_knowledge_excluded", {
        project,
        excluded: next,
      });
      setProjectExcluded(next);
      setExcluded(next);
      setResult(null);
      setHistory([]);
    } finally {
      setSavingExclusion(false);
    }
  };

  return (
    <section
      className="mx-auto mt-3 max-w-2xl rounded-md border border-slate-200 bg-slate-50 p-3"
      aria-label="Search local meeting evidence"
    >
      <div className="text-sm font-medium text-slate-900">Ask this meeting</div>
      <p className="mt-0.5 text-xs text-slate-600">
        Searches this device’s transcript only. Results are source excerpts, not
        generated answers.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        <input
          type="checkbox"
          checked={excluded}
          onChange={() => void toggleExclusion()}
          disabled={savingExclusion}
        />
        Exclude this meeting from local knowledge search
      </label>
      {excluded && (
        <p className="mt-1 text-xs text-amber-700" role="status">
          This meeting is excluded from local evidence retrieval.
        </p>
      )}
      {project && (
        <label className="mt-1 flex items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={projectExcluded}
            onChange={() => void toggleProjectExclusion()}
            disabled={savingExclusion}
          />
          Exclude project “{project}” from local knowledge search
        </label>
      )}
      <div className="mt-2 flex gap-2">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => event.key === "Enter" && void search()}
          placeholder="e.g. launch date"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-sm"
          aria-label="Question about this meeting"
        />
        <Button
          size="sm"
          onClick={() => void search()}
          disabled={loading || !query.trim()}
        >
          {loading ? "Searching…" : "Search"}
        </Button>
      </div>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-600">
        Scope
        <select
          value={scope}
          onChange={(event) => {
            setScope(event.target.value as typeof scope);
            setResult(null);
            setHistory([]);
          }}
          className="rounded border border-slate-300 bg-white px-1 py-0.5"
          aria-label="Evidence search scope"
        >
          <option value="meeting">This meeting</option>
          {project && <option value="project">This project</option>}
          <option value="library">All active meetings</option>
        </select>
      </label>
      {result && "Generated" in result && (
        <div className="mt-3 rounded border border-blue-100 bg-blue-50 p-3 text-sm text-slate-800">
          <p className="font-medium text-blue-950">Local answer</p>
          <p className="mt-1 whitespace-pre-wrap">{result.Generated.answer}</p>
          <p className="mt-2 text-xs text-blue-800">
            Generated on this device from the cited local evidence below.
          </p>
          <ul className="mt-2 space-y-2">
            {result.Generated.citations.map((citation, index) => (
              <li
                key={`${citation.meeting_id}-${citation.timestamp_seconds}-${index}`}
                className="rounded bg-white p-2"
              >
                <button
                  type="button"
                  className="text-left hover:underline"
                  onClick={() => onCitationClick?.(citation.timestamp_seconds)}
                >
                  <span className="mr-2 font-medium text-slate-600">
                    {scope === "meeting" ? "" : `${citation.meeting_id} · `}
                    {formatTime(citation.timestamp_seconds)}
                  </span>
                  {citation.text}
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}
      {result && "Evidence" in result && (
        <ul className="mt-3 space-y-2 text-sm">
          {result.Evidence.citations.map((citation, index) => (
            <li
              key={`${citation.meeting_id}-${citation.timestamp_seconds}-${index}`}
              className="rounded bg-white p-2 text-slate-800"
            >
              <button
                type="button"
                className="text-left hover:underline"
                onClick={() => onCitationClick?.(citation.timestamp_seconds)}
              >
                <span className="mr-2 font-medium text-slate-600">
                  {scope === "meeting" ? "" : `${citation.meeting_id} · `}
                  {formatTime(citation.timestamp_seconds)}
                </span>
                {citation.text}
              </button>
            </li>
          ))}
        </ul>
      )}
      {result && ("Evidence" in result || "Generated" in result) && (
        <button
          type="button"
          className="mt-2 rounded border border-slate-300 px-2 py-1 text-xs text-slate-700 hover:bg-white"
          onClick={() =>
            void createClip(
              ("Evidence" in result
                ? result.Evidence.citations
                : result.Generated.citations)[0],
            )
          }
        >
          Create 60-second local clip from top source
        </button>
      )}
      {clipStatus && (
        <p className="mt-2 text-xs text-slate-600" role="status">
          {clipStatus}
        </p>
      )}
      {clips.length > 0 && (
        <div className="mt-3 rounded border border-slate-200 bg-white p-2 text-xs">
          <p className="font-medium text-slate-700">Local clips</p>
          {clips.map((clip) => (
            <div
              key={clip.id}
              className="mt-1 flex items-center justify-between gap-2"
            >
              <span className="text-slate-600">
                {formatTime(clip.start_seconds)}–{formatTime(clip.end_seconds)}{" "}
                · {clip.checksum_sha256.slice(0, 12)}…
              </span>
              <button
                type="button"
                className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-slate-50"
                onClick={() => void deleteClip(clip.id)}
              >
                Remove
              </button>
            </div>
          ))}
        </div>
      )}
      <div
        className="mt-3 rounded border border-slate-200 bg-white p-2 text-xs"
        aria-label="Local review notes"
      >
        <p className="font-medium text-slate-700">Local review notes</p>
        <p className="mt-1 text-slate-500">
          Notes stay in this library and are not synced or sent to integrations.
        </p>
        <div className="mt-2 flex gap-2">
          <input
            value={commentAuthor}
            onChange={(event) => setCommentAuthor(event.target.value)}
            placeholder="Name (optional)"
            aria-label="Review note author"
            className="w-32 rounded border border-slate-300 px-2 py-1"
          />
          <input
            value={commentBody}
            onChange={(event) => setCommentBody(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && (event.ctrlKey || event.metaKey))
                void addComment();
            }}
            placeholder="Add a review note…"
            aria-label="Review note"
            className="min-w-0 flex-1 rounded border border-slate-300 px-2 py-1"
          />
          <Button
            size="sm"
            onClick={() => void addComment()}
            disabled={!commentBody.trim()}
          >
            Add
          </Button>
        </div>
        {commentStatus && (
          <p className="mt-1 text-slate-600" role="status">
            {commentStatus}
          </p>
        )}
        {comments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {comments.map((comment) => (
              <li
                key={comment.id}
                className={`flex items-start gap-2 rounded p-2 ${comment.resolved_at ? "bg-slate-50 text-slate-400" : "bg-amber-50 text-slate-700"}`}
              >
                <input
                  type="checkbox"
                  checked={Boolean(comment.resolved_at)}
                  onChange={() => void toggleComment(comment)}
                  aria-label={`Mark note by ${comment.author} resolved`}
                />
                <span>
                  <span className="font-medium">{comment.author}:</span>{" "}
                  <span className={comment.resolved_at ? "line-through" : ""}>
                    {comment.body}
                  </span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div
        className="mt-3 rounded border border-slate-200 bg-white p-2 text-xs"
        aria-label="Local meeting attachments"
      >
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="font-medium text-slate-700">
            Local whiteboard / photo attachments
          </p>
          <div className="flex items-center gap-1">
            <input
              type="number"
              min={0}
              step="0.1"
              value={attachmentOffset}
              onChange={(event) => setAttachmentOffset(event.target.value)}
              placeholder="Timestamp (s)"
              aria-label="Attachment recording timestamp"
              className="w-28 rounded border border-slate-300 px-2 py-1"
            />
            <button
              type="button"
              onClick={() => void addAttachment()}
              className="rounded border border-slate-300 px-2 py-1 text-slate-700 hover:bg-slate-50"
            >
              Add image
            </button>
          </div>
        </div>
        <p className="mt-1 text-slate-500">
          Copied into this meeting folder with a SHA-256 checksum; the original
          file is not modified or uploaded.
        </p>
        {attachments.length > 0 && (
          <ul className="mt-2 space-y-1">
            {attachments.map((attachment) => (
              <li
                key={attachment.id}
                className="flex items-center justify-between gap-2 rounded bg-slate-50 p-2"
              >
                <span className="min-w-0 truncate text-slate-600">
                  {attachment.offset_seconds != null
                    ? `${formatTime(attachment.offset_seconds)} · `
                    : ""}
                  {attachment.mime_type} ·{" "}
                  {attachment.checksum_sha256.slice(0, 12)}…
                </span>
                <button
                  type="button"
                  onClick={() => void deleteAttachment(attachment.id)}
                  className="rounded border border-slate-300 px-2 py-0.5 text-slate-700 hover:bg-white"
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {result && "InsufficientEvidence" in result && (
        <div className="mt-3 text-sm text-slate-700">
          <p>{result.InsufficientEvidence.message}</p>
          {result.InsufficientEvidence.closest.length > 0 && (
            <div className="mt-2">
              <p className="text-xs font-medium text-slate-600">
                Closest local sources
              </p>
              <ul className="mt-1 space-y-1">
                {result.InsufficientEvidence.closest.map((citation, index) => (
                  <li
                    key={`${citation.meeting_id}-${citation.timestamp_seconds}-${index}`}
                    className="rounded bg-white p-2 text-xs"
                  >
                    <span className="mr-2 font-medium text-slate-600">
                      {formatTime(citation.timestamp_seconds)}
                    </span>
                    {citation.text}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      )}
      {history.length > 1 && (
        <details className="mt-3 rounded border border-slate-200 bg-white p-2 text-xs text-slate-600">
          <summary className="cursor-pointer font-medium">
            Recent questions in this scope ({history.length})
          </summary>
          <ol className="mt-2 space-y-1">
            {history
              .slice(0, -1)
              .reverse()
              .map((turn, index) => (
                <li key={`${turn.query}-${index}`}>
                  <span className="font-medium">{turn.query}</span>{" "}
                  <span aria-hidden="true">·</span> {turn.scope} scope
                </li>
              ))}
          </ol>
        </details>
      )}
    </section>
  );
}

"use client";

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

interface TalkTime {
  me_seconds: number;
  remote_seconds: number;
  unassigned_seconds: number;
}

const label = (seconds: number) =>
  `${Math.floor(seconds / 60)}m ${Math.floor(seconds % 60)}s`;

export function TalkTimePanel({ meetingId }: { meetingId: string }) {
  const [data, setData] = useState<TalkTime | null>(null);
  useEffect(() => {
    invoke<TalkTime>("api_get_meeting_talk_time", { meetingId })
      .then(setData)
      .catch((error) => console.error("Failed to load talk time:", error));
  }, [meetingId]);
  if (!data) return null;
  const total = data.me_seconds + data.remote_seconds + data.unassigned_seconds;
  if (total <= 0) return null;
  const mePercent = Math.round((data.me_seconds / total) * 100);
  const remotePercent = Math.round((data.remote_seconds / total) * 100);
  return (
    <section
      className="mx-auto mt-3 max-w-2xl rounded-md border border-slate-200 bg-white p-3"
      aria-label="Source-track talk time"
    >
      <div className="text-sm font-medium text-slate-900">
        Source-track talk time
      </div>
      <p className="mt-0.5 text-xs text-slate-600">
        Based on local transcript segment durations; this is not speaker
        identification.
      </p>
      <div
        className="mt-2 h-2 overflow-hidden rounded bg-slate-100"
        aria-label={`Me ${mePercent} percent, remote ${remotePercent} percent`}
      >
        <div
          className="h-full bg-blue-500"
          style={{ width: `${mePercent}%` }}
        />
      </div>
      <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-700">
        <span>
          Me: {label(data.me_seconds)} ({mePercent}%)
        </span>
        <span>
          Remote: {label(data.remote_seconds)} ({remotePercent}%)
        </span>
        {data.unassigned_seconds > 0 && (
          <span>Unassigned: {label(data.unassigned_seconds)}</span>
        )}
      </div>
    </section>
  );
}

"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

interface TalkTimeBreakdown {
  me_seconds: number;
  remote_seconds: number;
  unassigned_seconds: number;
}

function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}

export function CoachingPanel({ meetingId }: { meetingId: string }) {
  const [talkTime, setTalkTime] = useState<TalkTimeBreakdown | null>(null);

  useEffect(() => {
    let cancelled = false;
    invoke<TalkTimeBreakdown>("api_get_meeting_talk_time", { meetingId })
      .then((result) => {
        if (!cancelled) setTalkTime(result);
      })
      .catch((error) =>
        console.error("Failed to load local coaching signal:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [meetingId]);

  const cue = useMemo(() => {
    if (!talkTime) return null;
    const attributable = talkTime.me_seconds + talkTime.remote_seconds;
    if (attributable < 60)
      return "More recorded source-track time is needed before showing a coaching cue.";
    const share = talkTime.me_seconds / attributable;
    if (share > 0.7)
      return `Your source track accounts for ${formatPercent(share)} of attributable time. Consider leaving space for a response.`;
    if (share < 0.3)
      return `Your source track accounts for ${formatPercent(share)} of attributable time. Consider whether you want to add a perspective or clarify next steps.`;
    return `The recorded source tracks are relatively balanced (${formatPercent(share)} on your track).`;
  }, [talkTime]);

  if (!cue) return null;
  return (
    <section
      className="mt-3 rounded-md border border-indigo-200 bg-indigo-50 p-3"
      aria-labelledby="coaching-heading"
    >
      <h3
        id="coaching-heading"
        className="text-sm font-semibold text-indigo-950"
      >
        Local coaching cue
      </h3>
      <p className="mt-1 text-xs text-indigo-900">{cue}</p>
      <p className="mt-1 text-xs text-indigo-700">
        Based only on persisted source-track durations, not speaker
        identification or behavioral scoring.
      </p>
    </section>
  );
}

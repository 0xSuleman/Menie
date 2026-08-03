"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

interface TrendPoint {
  meeting_id: string;
  created_at: string;
  me_seconds: number;
  remote_seconds: number;
}

export function CoachingTrendPanel({ project }: { project?: string }) {
  const [points, setPoints] = useState<TrendPoint[]>([]);
  useEffect(() => {
    let cancelled = false;
    invoke<TrendPoint[]>("api_get_project_talk_time_trend", {
      project: project || null,
    })
      .then((result) => {
        if (!cancelled) setPoints(result);
      })
      .catch((error) =>
        console.error("Failed to load local coaching trend:", error),
      );
    return () => {
      cancelled = true;
    };
  }, [project]);
  const summary = useMemo(() => {
    const total = points.reduce(
      (sum, point) => sum + point.me_seconds + point.remote_seconds,
      0,
    );
    const me = points.reduce((sum, point) => sum + point.me_seconds, 0);
    return total >= 60
      ? `${Math.round((me / total) * 100)}% on your source track across ${points.length} active local meeting${points.length === 1 ? "" : "s"}.`
      : null;
  }, [points]);
  if (!summary) return null;
  return (
    <section className="mt-3 rounded-md border border-indigo-100 bg-white p-3">
      <h3 className="text-sm font-semibold text-indigo-950">
        Local conversation trend
      </h3>
      <p className="mt-1 text-xs text-indigo-900">{summary}</p>
      <p className="mt-1 text-xs text-indigo-700">
        Active {project ? `“${project}” project` : "library"} meetings only;
        source-track duration is not speaker identity.
      </p>
    </section>
  );
}

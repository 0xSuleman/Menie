"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useMemo, useState } from "react";

interface AuditEvent {
  id: string;
  occurred_at: string;
  event_type: string;
  meeting_id?: string | null;
  details_json: string;
}

export function AuditTrailPanel({ meetingId }: { meetingId: string }) {
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [expanded, setExpanded] = useState(false);

  const load = async () => {
    try {
      const loaded = await invoke<AuditEvent[]>("api_get_local_audit_events", {
        limit: 200,
      });
      setEvents(loaded.filter((event) => event.meeting_id === meetingId));
    } catch (error) {
      console.error("Failed to load local audit trail:", error);
    }
  };

  useEffect(() => {
    void load();
  }, [meetingId]);

  const exportEvents = () => {
    const blob = new Blob(
      [
        JSON.stringify(
          { schema_version: 1, local_only: true, events },
          null,
          2,
        ),
      ],
      { type: "application/json" },
    );
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `menie-audit-${meetingId}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  const visibleEvents = useMemo(
    () => (expanded ? events : events.slice(0, 3)),
    [events, expanded],
  );
  if (!events.length) return null;
  return (
    <section
      className="mt-3 rounded-md border border-slate-200 bg-white p-3"
      aria-labelledby="audit-heading"
    >
      <div className="flex items-center justify-between gap-2">
        <h3 id="audit-heading" className="text-sm font-semibold text-slate-800">
          Local audit trail
        </h3>
        <button
          type="button"
          onClick={exportEvents}
          className="text-xs text-slate-700 underline"
        >
          Export JSON
        </button>
      </div>
      <p className="mt-1 text-xs text-slate-500">
        Append-only events for approved delivery activity on this device.
      </p>
      <ul className="mt-2 space-y-1 text-xs text-slate-700">
        {visibleEvents.map((event) => (
          <li key={event.id}>
            <span className="font-medium">{event.event_type}</span> ·{" "}
            {new Date(event.occurred_at).toLocaleString()}
          </li>
        ))}
      </ul>
      {events.length > 3 && (
        <button
          type="button"
          onClick={() => setExpanded((value) => !value)}
          className="mt-2 text-xs text-slate-700 underline"
        >
          {expanded ? "Show less" : `Show all ${events.length}`}
        </button>
      )}
    </section>
  );
}

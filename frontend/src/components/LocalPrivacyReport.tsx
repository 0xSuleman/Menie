"use client";

import { invoke } from "@tauri-apps/api/core";
import { Download, RefreshCw, ShieldCheck } from "lucide-react";
import { useCallback, useEffect, useState } from "react";

interface LocalPrivacyReportData {
  schema_version: number;
  generated_at: string;
  local_ai_enforced: boolean;
  analytics_enabled: boolean;
  application_data_directory: string;
  meeting_count: number;
  trashed_meeting_count: number;
  meetings_with_retention_schedule: number;
  outbound_delivery_count: number;
  pending_outbound_delivery_count: number;
  encrypted_library_enabled: boolean;
  synchronization_enabled: boolean;
  notes: string[];
}

export function LocalPrivacyReport() {
  const [report, setReport] = useState<LocalPrivacyReportData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setReport(
        await invoke<LocalPrivacyReportData>("api_get_local_privacy_report"),
      );
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not read the local privacy report.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const downloadReport = () => {
    if (!report) return;
    const blob = new Blob([JSON.stringify(report, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `menie-local-privacy-report-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      aria-labelledby="privacy-report-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="privacy-report-title"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <ShieldCheck className="h-5 w-5 text-green-700" /> Local privacy
            report
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            A live local inventory of this library’s privacy and egress posture.
          </p>
        </div>
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void loadReport()}
            className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50"
            aria-label="Refresh privacy report"
            disabled={loading}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <button
            type="button"
            onClick={downloadReport}
            className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Download privacy report JSON"
            disabled={!report}
          >
            <Download className="h-4 w-4" />
          </button>
        </div>
      </div>

      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {report && (
        <>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
            <div className="rounded-md bg-green-50 p-3">
              <dt className="text-green-800">Local AI</dt>
              <dd className="mt-1 font-semibold text-green-950">
                {report.local_ai_enforced ? "Enforced" : "Unavailable"}
              </dd>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <dt className="text-gray-600">Analytics</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {report.analytics_enabled ? "Enabled" : "Disabled"}
              </dd>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <dt className="text-gray-600">Meetings</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {report.meeting_count} local / {report.trashed_meeting_count} in
                Trash
              </dd>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <dt className="text-gray-600">Retention schedules</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {report.meetings_with_retention_schedule}
              </dd>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <dt className="text-gray-600">Outbound records</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {report.outbound_delivery_count} total /{" "}
                {report.pending_outbound_delivery_count} awaiting resolution
              </dd>
            </div>
            <div className="rounded-md bg-gray-50 p-3">
              <dt className="text-gray-600">Private sync</dt>
              <dd className="mt-1 font-semibold text-gray-900">
                {report.synchronization_enabled ? "Enabled" : "Not enabled"}
              </dd>
            </div>
          </dl>
          <p className="mt-4 break-all text-xs text-gray-600">
            <span className="font-medium">Local application data:</span>{" "}
            {report.application_data_directory}
          </p>
          <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-gray-600">
            {report.notes.map((note) => (
              <li key={note}>{note}</li>
            ))}
          </ul>
        </>
      )}
    </section>
  );
}

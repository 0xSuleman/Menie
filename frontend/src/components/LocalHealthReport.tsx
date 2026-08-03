"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  CheckCircle2,
  CircleAlert,
  RefreshCw,
  Stethoscope,
  XCircle,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { useLocalization } from "@/contexts/LocalizationContext";

interface LocalHealthCheck {
  id: string;
  label: string;
  status: "ok" | "warning" | "error";
  detail: string;
}

interface LocalHealthReportData {
  schema_version: number;
  generated_at: string;
  checks: LocalHealthCheck[];
}

interface CaptureHealthData {
  is_recording: boolean;
  is_paused: boolean;
  is_privacy_paused: boolean;
  active_sources: string[];
  active_stream_count: number;
  chunks_processed: number;
  dropped_chunks: number;
  processing_lag_ms: number | null;
  capture_error_count: number;
  reconnecting: boolean;
  buffer_pressure: string;
}

interface ProcessingJobData {
  id: string;
  kind: string;
  status: string;
  attempts: number;
}

const statusPresentation = {
  ok: { label: "Ready", className: "text-green-700", Icon: CheckCircle2 },
  warning: {
    label: "Needs attention",
    className: "text-amber-700",
    Icon: CircleAlert,
  },
  error: { label: "Unavailable", className: "text-red-700", Icon: XCircle },
};

export function LocalHealthReport() {
  const { formatDateTime } = useLocalization();
  const [report, setReport] = useState<LocalHealthReportData | null>(null);
  const [capture, setCapture] = useState<CaptureHealthData | null>(null);
  const [jobs, setJobs] = useState<ProcessingJobData[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [rebuildingIndex, setRebuildingIndex] = useState(false);

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [healthReport, captureReport, processingJobs] = await Promise.all([
        invoke<LocalHealthReportData>("api_get_local_health_report"),
        invoke<CaptureHealthData>("get_capture_health"),
        invoke<ProcessingJobData[]>("list_processing_jobs"),
      ]);
      setReport(healthReport);
      setCapture(captureReport);
      setJobs(processingJobs);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not inspect the local runtime.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadReport();
  }, [loadReport]);

  const rebuildKnowledgeIndex = async () => {
    setRebuildingIndex(true);
    setError(null);
    try {
      await invoke("api_rebuild_knowledge_index", { meetingId: null });
      await loadReport();
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not rebuild the local knowledge index.",
      );
    } finally {
      setRebuildingIndex(false);
    }
  };

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      aria-labelledby="local-health-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="local-health-title"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <Stethoscope className="h-5 w-5 text-blue-700" /> Local runtime
            health
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Checks local prerequisites only. It does not record, start models,
            or contact a network service.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => void rebuildKnowledgeIndex()}
            className="rounded-md border border-gray-300 px-2 py-1 text-xs text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            disabled={loading || rebuildingIndex}
          >
            Rebuild local index
          </button>
          <button
            type="button"
            onClick={() => void loadReport()}
            className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
            aria-label="Refresh local runtime health"
            disabled={loading || rebuildingIndex}
          >
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
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
          <p className="mt-3 text-xs text-gray-500">
            Checked{" "}
            {formatDateTime(report.generated_at, {
              dateStyle: "medium",
              timeStyle: "short",
            })}
          </p>
          <ul className="mt-2 space-y-3" aria-live="polite">
            {report.checks.map((check) => {
              const presentation =
                statusPresentation[check.status] ?? statusPresentation.error;
              const Icon = presentation.Icon;
              return (
                <li
                  key={check.id}
                  className="flex gap-3 rounded-md bg-gray-50 p-3"
                >
                  <Icon
                    className={`mt-0.5 h-5 w-5 shrink-0 ${presentation.className}`}
                    aria-hidden="true"
                  />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-gray-900">
                      {check.label}{" "}
                      <span className={presentation.className}>
                        â€” {presentation.label}
                      </span>
                    </p>
                    <p className="mt-0.5 break-words text-xs text-gray-600">
                      {check.detail}
                    </p>
                  </div>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {capture && (
        <div
          className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"
          aria-label="Capture health"
        >
          <p className="text-sm font-medium text-gray-900">Capture health</p>
          <p className="mt-1 text-xs text-gray-600">
            Counters only; audio, transcript text, device names, and meeting
            content are excluded.
          </p>
          <dl className="mt-2 grid grid-cols-2 gap-2 text-xs sm:grid-cols-4">
            <div>
              <dt className="text-gray-500">Sources</dt>
              <dd className="font-medium text-gray-800">
                {capture.active_sources.length
                  ? capture.active_sources.join(", ")
                  : "none"}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Streams</dt>
              <dd className="font-medium text-gray-800">
                {capture.active_stream_count}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Dropped chunks</dt>
              <dd className="font-medium text-gray-800">
                {capture.dropped_chunks}
              </dd>
            </div>
            <div>
              <dt className="text-gray-500">Errors</dt>
              <dd className="font-medium text-gray-800">
                {capture.capture_error_count}
              </dd>
            </div>
          </dl>
          <p className="mt-2 text-xs text-gray-600">
            {capture.buffer_pressure}
            {capture.processing_lag_ms === null
              ? ""
              : `; last activity ${capture.processing_lag_ms} ms ago`}
          </p>
        </div>
      )}
      <div
        className="mt-4 rounded-md border border-slate-200 bg-slate-50 p-3"
        aria-label="Local processing queue"
      >
        <p className="text-sm font-medium text-gray-900">
          Local processing queue
        </p>
        <p className="mt-1 text-xs text-gray-600">
          Deferred work stays on this device and is retried after restart.
          Payloads and file paths are not shown here.
        </p>
        <dl className="mt-2 grid grid-cols-3 gap-2 text-xs sm:max-w-md">
          <div>
            <dt className="text-gray-500">Queued</dt>
            <dd className="font-medium text-gray-800">
              {
                jobs.filter(
                  (job) => job.status === "queued" || job.status === "retry",
                ).length
              }
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Running</dt>
            <dd className="font-medium text-gray-800">
              {jobs.filter((job) => job.status === "running").length}
            </dd>
          </div>
          <div>
            <dt className="text-gray-500">Failed</dt>
            <dd className="font-medium text-gray-800">
              {jobs.filter((job) => job.status === "failed").length}
            </dd>
          </div>
        </dl>
        {jobs
          .filter((job) => job.status === "queued" || job.status === "retry")
          .slice(0, 5)
          .map((job) => (
            <div
              key={job.id}
              className="mt-2 flex items-center justify-between gap-3 rounded border border-slate-200 bg-white px-2 py-1.5 text-xs"
            >
              <span className="text-gray-700">
                {job.kind} · attempt {job.attempts}
              </span>
              <button
                type="button"
                className="rounded border border-gray-300 px-2 py-1 text-gray-700 hover:bg-gray-50"
                onClick={async () => {
                  await invoke("cancel_processing_job", { jobId: job.id });
                  await loadReport();
                }}
              >
                Cancel
              </button>
            </div>
          ))}
      </div>
    </section>
  );
}

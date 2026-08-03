"use client";

import { invoke } from "@tauri-apps/api/core";
import {
  ChevronDown,
  ChevronUp,
  Download,
  FileWarning,
  RefreshCw,
} from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

interface DiagnosticData {
  schema_version: number;
  generated_at: string;
  [key: string]: unknown;
}

export function LocalDiagnosticsBundle() {
  const [privacy, setPrivacy] = useState<DiagnosticData | null>(null);
  const [health, setHealth] = useState<DiagnosticData | null>(null);
  const [capture, setCapture] = useState<DiagnosticData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reviewOpen, setReviewOpen] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [privacyReport, healthReport, captureReport] = await Promise.all([
        invoke<DiagnosticData>("api_get_local_privacy_report"),
        invoke<DiagnosticData>("api_get_local_health_report"),
        invoke<DiagnosticData>("get_capture_health"),
      ]);
      setPrivacy(privacyReport);
      setHealth(healthReport);
      setCapture(captureReport);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : "Could not prepare the local diagnostic bundle.",
      );
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const bundle = useMemo(
    () =>
      privacy && health
        ? {
            schema_version: 1,
            generated_at: new Date().toISOString(),
            bundle_type: "menie-local-diagnostics",
            collection: {
              network_used: false,
              meeting_content_included: false,
              credentials_included: false,
            },
            privacy_report: privacy,
            health_report: health,
            capture_health: capture,
          }
        : null,
    [privacy, health, capture],
  );

  const download = () => {
    if (!bundle) return;
    const blob = new Blob([JSON.stringify(bundle, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `menie-local-diagnostics-${new Date().toISOString().slice(0, 10)}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      aria-labelledby="diagnostics-title"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3
            id="diagnostics-title"
            className="flex items-center gap-2 text-lg font-semibold text-gray-900"
          >
            <FileWarning className="h-5 w-5 text-slate-700" /> Support
            diagnostics
          </h3>
          <p className="mt-1 text-sm text-gray-600">
            Create a local JSON bundle for support. It contains privacy and
            runtime-health checks only—never recordings, transcripts, prompts,
            or credentials.
          </p>
        </div>
        <button
          type="button"
          onClick={() => void load()}
          className="rounded-md border border-gray-300 p-2 text-gray-700 hover:bg-gray-50 disabled:opacity-50"
          aria-label="Refresh support diagnostics"
          disabled={loading}
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
        </button>
      </div>
      {error && (
        <p className="mt-3 text-sm text-red-700" role="alert">
          {error}
        </p>
      )}
      {bundle && (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => setReviewOpen((open) => !open)}
            className="inline-flex items-center gap-1 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
            aria-expanded={reviewOpen}
          >
            {reviewOpen ? (
              <ChevronUp className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}{" "}
            Review bundle
          </button>
          <button
            type="button"
            onClick={download}
            className="inline-flex items-center gap-1 rounded-md bg-slate-800 px-3 py-2 text-sm font-medium text-white hover:bg-slate-700"
          >
            <Download className="h-4 w-4" /> Download locally
          </button>
          <span className="text-xs text-gray-500">
            Menie does not upload this file.
          </span>
        </div>
      )}
      {bundle && reviewOpen && (
        <pre
          className="mt-3 max-h-64 overflow-auto rounded-md bg-slate-950 p-3 text-xs text-slate-100"
          aria-label="Diagnostic bundle preview"
        >
          {JSON.stringify(bundle, null, 2)}
        </pre>
      )}
    </section>
  );
}

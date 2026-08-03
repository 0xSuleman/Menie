"use client";

import { invoke } from "@tauri-apps/api/core";
import { useEffect, useState } from "react";

interface DeliveryRecord {
  id: string;
  destination: string;
  event_type: string;
  schema_version: number;
  idempotency_key: string;
  payload_json: string;
  state: "pending_approval" | "approved" | "sent" | "failed";
  created_at: string;
  last_error?: string | null;
}

export function WebhookDeliveryReview({ meetingId }: { meetingId: string }) {
  const [destination, setDestination] = useState("");
  const [redact, setRedact] = useState(false);
  const [outboundEnabled, setOutboundEnabled] = useState(true);
  const [deliveries, setDeliveries] = useState<DeliveryRecord[]>([]);
  const [isPreparing, setIsPreparing] = useState(false);
  const [status, setStatus] = useState<string | null>(null);

  const loadDeliveries = async () => {
    try {
      setDeliveries(
        await invoke<DeliveryRecord[]>("api_get_meeting_deliveries", {
          meetingId,
        }),
      );
    } catch (error) {
      console.error("Failed to load delivery reviews:", error);
    }
  };

  useEffect(() => {
    void loadDeliveries();
    void invoke<boolean>("api_get_outbound_webhook_policy")
      .then(setOutboundEnabled)
      .catch(() => undefined);
  }, [meetingId]);

  const prepare = async () => {
    if (!destination.trim()) return;
    setIsPreparing(true);
    setStatus(null);
    try {
      const record = await invoke<DeliveryRecord>(
        "api_prepare_webhook_delivery",
        { meetingId, destination, redact },
      );
      setDeliveries((current) => [
        record,
        ...current.filter((delivery) => delivery.id !== record.id),
      ]);
      setStatus(
        "Artifact prepared locally. Review the exact JSON before approving.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setIsPreparing(false);
    }
  };

  const approve = async (deliveryId: string) => {
    try {
      await invoke("api_approve_webhook_delivery", { deliveryId });
      await loadDeliveries();
      setStatus(
        "Approved locally. No network request has been sent by this review step.",
      );
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  const dispatch = async (deliveryId: string) => {
    if (
      !window.confirm(
        "Send the reviewed transcript artifact to this webhook now?",
      )
    )
      return;
    try {
      await invoke("api_dispatch_webhook_delivery", { deliveryId });
      await loadDeliveries();
      setStatus("Webhook accepted the approved artifact.");
    } catch (error) {
      await loadDeliveries();
      setStatus(error instanceof Error ? error.message : String(error));
    }
  };

  return (
    <section className="mt-3 rounded-md border border-slate-200 bg-slate-50 p-3">
      <h3 className="text-sm font-semibold text-slate-800">
        Webhook delivery review
      </h3>
      <p className="mt-0.5 text-xs text-slate-600">
        Creates a versioned local transcript artifact. Preparing and approving
        never sends meeting content.
      </p>
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={outboundEnabled}
          onChange={async (event) => {
            const next = event.target.checked;
            try {
              setOutboundEnabled(
                await invoke<boolean>("api_set_outbound_webhook_policy", {
                  enabled: next,
                }),
              );
            } catch (error) {
              setStatus(error instanceof Error ? error.message : String(error));
            }
          }}
        />
        Allow approved outbound webhooks on this device
      </label>{" "}
      <label className="mt-2 flex items-center gap-2 text-xs text-slate-700">
        <input
          type="checkbox"
          checked={redact}
          onChange={(event) => setRedact(event.target.checked)}
        />
        Redact common emails, phone numbers, and token patterns before this
        artifact is persisted
      </label>
      <div className="mt-2 flex gap-2">
        <input
          type="url"
          value={destination}
          onChange={(event) => setDestination(event.target.value)}
          placeholder="https://your-approved-endpoint"
          aria-label="Webhook destination"
          className="min-w-0 flex-1 rounded border border-slate-300 bg-white px-2 py-1 text-xs"
        />
        <button
          type="button"
          onClick={() => void prepare()}
          disabled={isPreparing || !destination.trim() || !outboundEnabled}
          className="rounded bg-slate-700 px-2 py-1 text-xs text-white disabled:opacity-50"
        >
          {isPreparing ? "Preparing…" : "Prepare"}
        </button>
      </div>
      {status && (
        <p role="status" className="mt-2 text-xs text-slate-600">
          {status}
        </p>
      )}
      {deliveries.map((delivery) => (
        <details
          key={delivery.id}
          className="mt-2 rounded border border-slate-200 bg-white p-2 text-xs"
        >
          <summary className="cursor-pointer text-slate-700">
            {delivery.state.replace("_", " ")} · {delivery.destination}
          </summary>
          <p className="mt-1 text-slate-500">
            Schema v{delivery.schema_version} · idempotency key{" "}
            {delivery.idempotency_key}
          </p>
          <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap rounded bg-slate-950 p-2 text-[11px] text-slate-100">
            {delivery.payload_json}
          </pre>
          {delivery.state === "pending_approval" && (
            <button
              type="button"
              onClick={() => void approve(delivery.id)}
              className="mt-2 rounded bg-emerald-700 px-2 py-1 text-xs text-white"
            >
              Approve exact artifact
            </button>
          )}
          {delivery.state === "approved" && (
            <button
              type="button"
              onClick={() => void dispatch(delivery.id)}
              className="mt-2 rounded bg-blue-700 px-2 py-1 text-xs text-white"
            >
              Send approved artifact
            </button>
          )}
          {delivery.state === "failed" && (
            <button
              type="button"
              onClick={() => void approve(delivery.id)}
              className="mt-2 rounded bg-amber-700 px-2 py-1 text-xs text-white"
            >
              Re-approve to retry
            </button>
          )}
          {delivery.last_error && (
            <p className="mt-1 text-red-700">{delivery.last_error}</p>
          )}
        </details>
      ))}
    </section>
  );
}

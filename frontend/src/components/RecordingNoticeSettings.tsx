"use client";

import {
  clearRecordingNoticeAcknowledgement,
  hasAcknowledgedRecordingNotice,
} from "@/lib/recordingNotice";
import { useState } from "react";

export function RecordingNoticeSettings() {
  const [acknowledged, setAcknowledged] = useState(
    hasAcknowledgedRecordingNotice,
  );

  return (
    <section
      className="bg-white rounded-lg border border-gray-200 p-6 shadow-sm"
      aria-labelledby="recording-notice-settings-title"
    >
      <h3
        id="recording-notice-settings-title"
        className="text-lg font-semibold text-gray-900"
      >
        Recording notice
      </h3>
      <p className="mt-1 text-sm text-gray-600">
        Menie asks you to inform participants before recording. This is a local
        reminder, not legal advice.
      </p>
      <p className="mt-3 text-sm text-gray-800">
        Current device acknowledgement:{" "}
        <span className="font-medium">
          {acknowledged ? "Acknowledged" : "Not acknowledged"}
        </span>
      </p>
      {acknowledged && (
        <button
          type="button"
          onClick={() => {
            clearRecordingNoticeAcknowledgement();
            setAcknowledged(false);
          }}
          className="mt-3 rounded-md border border-gray-300 px-3 py-2 text-sm font-medium text-gray-800 hover:bg-gray-50"
        >
          Require notice again
        </button>
      )}
    </section>
  );
}

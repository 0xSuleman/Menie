const recordingNoticeKey = "menie.recordingNoticeAcknowledged";

export function hasAcknowledgedRecordingNotice(): boolean {
  return (
    typeof window !== "undefined" &&
    window.localStorage.getItem(recordingNoticeKey) === "true"
  );
}

export function acknowledgeRecordingNotice(): void {
  if (typeof window !== "undefined")
    window.localStorage.setItem(recordingNoticeKey, "true");
}

export function clearRecordingNoticeAcknowledgement(): void {
  if (typeof window !== "undefined")
    window.localStorage.removeItem(recordingNoticeKey);
}

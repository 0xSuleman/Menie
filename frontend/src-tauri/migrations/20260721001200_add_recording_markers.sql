-- Recording-relative user markers are local meeting evidence.
CREATE TABLE IF NOT EXISTS recording_markers (
    id TEXT PRIMARY KEY NOT NULL,
    meeting_id TEXT NOT NULL,
    offset_seconds REAL NOT NULL,
    text TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_recording_markers_meeting_offset
    ON recording_markers(meeting_id, offset_seconds);

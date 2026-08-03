CREATE TABLE IF NOT EXISTS meeting_attachments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    file_path TEXT NOT NULL,
    mime_type TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_attachments_meeting_created
    ON meeting_attachments(meeting_id, created_at DESC);

CREATE TABLE IF NOT EXISTS meeting_clips (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    start_seconds REAL NOT NULL,
    end_seconds REAL NOT NULL,
    source_file TEXT NOT NULL,
    clip_file TEXT NOT NULL,
    checksum_sha256 TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_clips_meeting_created
    ON meeting_clips(meeting_id, created_at DESC);

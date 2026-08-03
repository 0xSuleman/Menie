CREATE TABLE IF NOT EXISTS meeting_comments (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    author TEXT NOT NULL,
    body TEXT NOT NULL,
    resolved_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_meeting_comments_meeting_created
    ON meeting_comments(meeting_id, created_at ASC);

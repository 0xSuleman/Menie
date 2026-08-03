CREATE TABLE IF NOT EXISTS transcript_revisions (
    id TEXT PRIMARY KEY,
    transcript_id TEXT NOT NULL,
    meeting_id TEXT NOT NULL,
    previous_text TEXT NOT NULL,
    revised_text TEXT NOT NULL,
    changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY(transcript_id) REFERENCES transcripts(id),
    FOREIGN KEY(meeting_id) REFERENCES meetings(id)
);

CREATE INDEX IF NOT EXISTS idx_transcript_revisions_segment_changed
ON transcript_revisions(transcript_id, changed_at DESC);

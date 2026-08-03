CREATE TABLE IF NOT EXISTS meeting_speaker_labels (
    id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL REFERENCES meetings(id) ON DELETE CASCADE,
    diarization_label TEXT NOT NULL,
    display_name TEXT NOT NULL,
    confidence REAL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(meeting_id, diarization_label)
);
CREATE INDEX IF NOT EXISTS idx_meeting_speaker_labels_meeting ON meeting_speaker_labels(meeting_id);
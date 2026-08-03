-- Recoverable library lifecycle state; media and transcript rows are retained.
ALTER TABLE meetings ADD COLUMN pinned_at TEXT;
ALTER TABLE meetings ADD COLUMN archived_at TEXT;
ALTER TABLE meetings ADD COLUMN trashed_at TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_active_created ON meetings(trashed_at, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_archived_at ON meetings(archived_at);

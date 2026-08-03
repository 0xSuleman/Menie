ALTER TABLE meetings ADD COLUMN retention_due_at DATETIME;
CREATE INDEX IF NOT EXISTS idx_meetings_retention_due_at ON meetings(retention_due_at) WHERE trashed_at IS NULL;

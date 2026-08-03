ALTER TABLE meetings ADD COLUMN knowledge_excluded_at TEXT;

CREATE INDEX IF NOT EXISTS idx_meetings_knowledge_excluded
    ON meetings(knowledge_excluded_at);

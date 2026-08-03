CREATE TABLE IF NOT EXISTS knowledge_embeddings (
    transcript_id TEXT PRIMARY KEY,
    meeting_id TEXT NOT NULL,
    model_id TEXT NOT NULL,
    embedding_json TEXT NOT NULL,
    indexed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (transcript_id) REFERENCES transcripts(id) ON DELETE CASCADE,
    FOREIGN KEY (meeting_id) REFERENCES meetings(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_knowledge_embeddings_meeting
    ON knowledge_embeddings(meeting_id, indexed_at DESC);

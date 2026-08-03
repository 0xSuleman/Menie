CREATE VIRTUAL TABLE IF NOT EXISTS transcripts_fts USING fts5(
    transcript,
    meeting_id UNINDEXED,
    timestamp UNINDEXED
);

INSERT INTO transcripts_fts (rowid, transcript, meeting_id, timestamp)
SELECT rowid, transcript, meeting_id, timestamp FROM transcripts;

CREATE TRIGGER IF NOT EXISTS transcripts_fts_after_insert
AFTER INSERT ON transcripts BEGIN
    INSERT INTO transcripts_fts (rowid, transcript, meeting_id, timestamp)
    VALUES (new.rowid, new.transcript, new.meeting_id, new.timestamp);
END;

CREATE TRIGGER IF NOT EXISTS transcripts_fts_after_delete
AFTER DELETE ON transcripts BEGIN
    DELETE FROM transcripts_fts WHERE rowid = old.rowid;
END;

CREATE TRIGGER IF NOT EXISTS transcripts_fts_after_update
AFTER UPDATE OF transcript, meeting_id, timestamp ON transcripts BEGIN
    DELETE FROM transcripts_fts WHERE rowid = old.rowid;
    INSERT INTO transcripts_fts (rowid, transcript, meeting_id, timestamp)
    VALUES (new.rowid, new.transcript, new.meeting_id, new.timestamp);
END;

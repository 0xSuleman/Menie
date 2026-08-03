-- Logical workspace organization is independent of the local media folder.
ALTER TABLE meetings ADD COLUMN project TEXT;
CREATE INDEX IF NOT EXISTS idx_meetings_project ON meetings(project);

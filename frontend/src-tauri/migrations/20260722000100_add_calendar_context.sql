-- Optional user-imported calendar context; no calendar network access is performed.
ALTER TABLE meetings ADD COLUMN calendar_context TEXT;

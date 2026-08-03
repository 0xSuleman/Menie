CREATE TABLE IF NOT EXISTS project_vocabulary_terms (
    id TEXT PRIMARY KEY,
    project TEXT NOT NULL,
    normalized_term TEXT NOT NULL,
    term TEXT NOT NULL,
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(project, normalized_term)
);

CREATE INDEX IF NOT EXISTS idx_project_vocabulary_terms_project
ON project_vocabulary_terms(project, term);

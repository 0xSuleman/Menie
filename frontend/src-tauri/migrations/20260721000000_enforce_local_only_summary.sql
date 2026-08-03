-- Migrate persisted remote-summary selections to the packaged local runtime.
-- The original API-key columns are intentionally retained for schema rollback
-- compatibility, but no production inference code reads them after this release.
UPDATE settings
SET provider = 'builtin-ai',
    model = 'qwen3.5:2b',
    ollamaEndpoint = NULL
WHERE lower(provider) IN ('openai', 'claude', 'groq', 'ollama', 'openrouter', 'custom-openai', 'local-llama', 'localllama');

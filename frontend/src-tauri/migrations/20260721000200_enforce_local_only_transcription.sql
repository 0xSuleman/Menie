UPDATE transcript_settings
SET provider = 'parakeet',
    model = 'parakeet-tdt-0.6b-v3'
WHERE lower(provider) NOT IN ('parakeet', 'localwhisper');

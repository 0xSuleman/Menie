# Security policy

Menie is designed so that core capture, transcription, summaries, embeddings, retrieval, and local handoff processing happen on the user-controlled device. Security reports are welcome for the desktop client, native code, renderer, migrations, model acquisition, export/import boundaries, and optional outbound integrations.

## Reporting a vulnerability

Please do not publish a suspected vulnerability or attach meeting content to a public issue. Send a minimal reproduction to the security contact published by the project maintainers, or use the repository's private security-advisory workflow when it is enabled. Include:

- affected version/commit and operating system;
- the smallest reproducible steps or a proof-of-concept;
- expected and observed behavior;
- whether the issue can expose meeting content, credentials, model files, or filesystem/network access; and
- any logs with meeting text, paths, tokens, or personal data removed.

If the report contains user data, redact it before transmission or reproduce the issue with the bundled sample meeting. Menie maintainers will acknowledge a report, triage severity and exploitability, reproduce it in an isolated environment, and coordinate a fix or mitigation with the reporter.

## Response targets

These are service targets, not a guarantee:

| Severity | Acknowledgement | Triage target | Release target |
|---|---:|---:|---:|
| Critical (remote code execution, credential exfiltration, or broad local-content disclosure) | 2 business days | 5 business days | Emergency fix or mitigation as soon as practical |
| High (privilege boundary, import/export compromise, or targeted content disclosure) | 3 business days | 10 business days | Next security release when verified |
| Moderate/Low | 5 business days | 20 business days | Scheduled release or documented mitigation |

## Disclosure and fixes

The project will avoid public disclosure until a fix or practical mitigation is available, unless coordinated disclosure requires another schedule. Security releases should include affected versions, impact, upgrade/mitigation guidance, and whether local data migration or model re-verification is required. Do not include meeting content, transcript excerpts, raw audio, passwords, API keys, or private reporter details in release notes.

## Supported security boundaries

- External AI providers and Ollama are not supported inference paths.
- Optional webhooks/connectors are explicit outbound boundaries and should receive only approved payloads.
- Portable bundles are untrusted input and must pass schema, size, path, duplicate, and checksum validation before import.
- Encrypted handoffs use authenticated encryption, but the password must be transferred separately and is not recoverable by Menie.
- Core analytics and content telemetry are disabled by default in the local-only build.

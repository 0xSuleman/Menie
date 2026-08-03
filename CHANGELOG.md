# Changelog

All notable local-only product changes are recorded here. Entries distinguish new behavior, changed behavior, fixes, and security/privacy work. This file describes the current development worktree; packaged release notes should include the corresponding version and commit.

## Unreleased

### Added

- Local transcript evidence search with scoped meeting/project/library retrieval, closest-source refusal, citations, persisted embeddings, and grounded on-device answers.
- Timestamped recording markers, local review comments with resolve state, project vocabulary hints, provenance-preserving audio clips, and deterministic redacted transcript exports.
- Verified portable meeting bundles, password-protected AES-256-GCM handoff envelopes, comment/artifact preservation, and backward-compatible import validation.
- Local voice-memo/audio import routing to an optional project.
- Configurable consent-gated meeting-app auto-start/auto-stop timing for supported desktop process detection.
- Compatibility and security reporting documentation in `docs/COMPATIBILITY.md` and `SECURITY.md`.

### Changed

- Local health and privacy reports expose index coverage, exclusions, model readiness, retention, outbound-delivery, and synchronization boundaries.
- Bundle manifests now checksum comments in addition to transcript, marker, and summary payloads; older bundles remain importable.
- Meeting detection explicitly avoids browser-tab inspection, so Google Meet browser calls require manual recording or the visible prompt.

### Security and privacy

- External AI providers, Ollama inference, hidden network fallbacks, and historical credential paths remain disabled in the local-only build.
- Model artifacts and portable payloads are validated with integrity checks before activation or import.
- Encrypted handoff passwords are never logged or transmitted by Menie; users must share them through a separate trusted channel.

### Verification

The repository quality gate runs the frontend build, renderer budget, focused local-only tests, migration checks, and native test suite:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/check-quality-gates.ps1
```

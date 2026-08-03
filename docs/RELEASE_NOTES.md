# Release notes policy

Every Menie release note must clearly separate:

- **New** — user-visible additions.
- **Changed** — behavior, compatibility, or default changes.
- **Fixed** — corrected defects and affected platforms.
- **Deprecated** — supported paths scheduled for removal, migration path, and timing.
- **Security** — user-impacting security or privacy changes, without disclosing exploit details before users can update.

## Required release evidence

Before a release is promoted, maintainers record the supported platform/model matrix, migration and backup outcome, automated-test results, known limitations, and any compatibility impact on exports or approved webhook payloads. A local model, prompt, template, runtime, or retrieval change must not ship when it exceeds its declared privacy, stability, or quality threshold.

## Local-only notices

Release notes must not claim cloud AI, bot joining, calendar integration, diarization, speaker identity, or private synchronization unless that capability is present in the released build. They must explicitly call out changes to local-only enforcement, outbound approval behavior, storage migrations, and any unsupported model/configuration removal.

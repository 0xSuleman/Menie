# Attribution and contribution boundary

Menie is derived from [Meetily](https://github.com/Zackriya-Solutions/meetily), the local-first AI meeting assistant maintained by Zackriya Solutions and its contributors. The repository retains the upstream MIT license and Zackriya Solutions copyright notice.

## Upstream foundation

Meetily provides the core Tauri/Next.js/Rust desktop architecture, audio capture and transcription pipeline, local summarization approach, platform build machinery, and a substantial portion of the user interface and native implementation.

## Current derivative work

The current Menie tree contains additional local-only policy checks, privacy and health reporting, transcript evidence retrieval, review artifacts, bundle integrity and encrypted handoff behavior, and related quality-gate work described in `CHANGELOG.md`.

The repository was published as a single squashed commit and still contains inherited Meetily naming in workflows. Until a base revision and change inventory are fully verified, public descriptions must call Menie a derivative and must not attribute the complete application to Suleman Ahmed.

Future changes should use normal issues, branches, pull requests, and releases so the downstream contribution record is independently auditable.

Menie is not affiliated with or endorsed by Zackriya Solutions or the Meetily project.


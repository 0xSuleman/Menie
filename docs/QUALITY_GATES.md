# Desktop quality gates

The local-only desktop release gate is reproducible from a clean checkout. Run
`powershell -ExecutionPolicy Bypass -File scripts/check-quality-gates.ps1` from
the repository root.

The gate first regenerates `docs/ears-requirements.csv` from the supplied EARS plan and fails unless all 406 immutable requirement IDs are present. The catalog is the machine-readable traceability input for release review.

The gate must pass the production renderer build, Rust formatting, migration
smoke coverage, no-egress policy tests, transcript revision integrity,
explicit action-owner/deadline parsing, and content-free capture-health tests.
It also emits Cargo dependency
metadata under `target/quality-gates-cargo-metadata.json` for release review.
This full Rust dependency inventory is the release SBOM input; the frontend
`package-lock.json` remains the corresponding JavaScript dependency lockfile.
The local evaluation harness also emits `target/local-evaluation-report.json`
with grounded-evidence, refusal, revision-history, and capture-health results;
it uses synthetic fixtures only and records no meeting content.
After the production build, the gate also runs
`scripts/check-renderer-budget.ps1`. By default it caps the complete
`frontend/out` artifact tree at 25 MB and the largest JavaScript asset at 5 MB,
and writes the measured values to
`target/renderer-budget-report.json` (also uploaded by CI).

## Performance budgets

Reference hardware runs must record these budgets before a release is promoted:

| Surface | Budget | Measurement boundary |
| --- | ---: | --- |
| Renderer production build | 60 s | `npm.cmd run build` wall clock |
| Local FTS search | 500 ms | query-to-result for 100,000 segments |
| Stop or privacy-pause command | 250 ms acknowledgement | command invocation to visible state change |
| Transcript update latency | 2 s p95 | captured chunk to rendered final segment |
| Local summary progress | visible progress | every long-running operation exposes progress or cancellation |

These are release gates, not telemetry defaults. Meeting content, audio, and
transcript text must never be included in performance logs or dependency
inventories.

## Release evidence

Release review records the supported OS/model matrix, migration and verified
backup result, quality-gate output, updater-signing verification, known
limitations, and export/webhook compatibility impact. A failed quality gate or
an unresolved critical security finding blocks promotion.

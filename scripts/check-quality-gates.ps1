[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$frontendRoot = Join-Path $repoRoot 'frontend'
$tauriManifest = Join-Path $frontendRoot 'src-tauri/Cargo.toml'
$earsExport = Join-Path $repoRoot 'scripts/export-ears-requirements.ps1'
powershell -ExecutionPolicy Bypass -File $earsExport

Push-Location $frontendRoot
try {
    npm.cmd run build
} finally {
    Pop-Location
}
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/check-renderer-budget.ps1')

$env:WHISPER_DONT_GENERATE_BINDINGS = '1'
cargo fmt --manifest-path $tauriManifest -- --check
cargo test -p menie zero_egress_policy_tests --lib
cargo test -p menie fresh_database_applies_the_complete_local_upgrade_chain --lib
cargo test -p menie segment_revision_preserves_before_after_history --lib
cargo test -p menie action_metadata_requires_explicit_owner_and_due_labels --lib
cargo test -p menie capture_health_serialization_is_content_free --lib
cargo test -p menie local_only_defaults_cannot_create_a_network_telemetry_client --lib
cargo test -p menie test_validate_audio_file_wrong_extension --lib
cargo test -p menie analytics_properties_drop_sensitive_meeting_metadata --lib
cargo test -p menie jobs::tests --lib
cargo test -p menie delivery_tests --lib
cargo test -p menie model_redirect_policy_allows_only_huggingface_hosts --lib

powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/run-local-evaluation.ps1')

# Keep a machine-readable dependency inventory with each local quality run.
$metadataPath = Join-Path $repoRoot 'target/quality-gates-cargo-metadata.json'
cargo metadata --format-version 1 | Out-File -FilePath $metadataPath -Encoding utf8
Write-Host "Quality gates passed. Dependency metadata: $metadataPath"
powershell -ExecutionPolicy Bypass -File (Join-Path $repoRoot 'scripts/generate-sbom.ps1')

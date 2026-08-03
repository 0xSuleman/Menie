[CmdletBinding()]
param()

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$env:WHISPER_DONT_GENERATE_BINDINGS = '1'

$checks = @(
  @{ id = 'grounded_evidence'; filter = 'local_retrieval_returns_timestamped_evidence_instead_of_an_uncited_answer' },
  @{ id = 'insufficient_evidence_refusal'; filter = 'local_retrieval_refuses_when_the_scope_has_no_supporting_evidence' },
  @{ id = 'source_revision_history'; filter = 'segment_revision_preserves_before_after_history' },
  @{ id = 'capture_health_privacy'; filter = 'capture_health_serialization_is_content_free' }
)

$results = foreach ($check in $checks) {
  $timer = [Diagnostics.Stopwatch]::StartNew()
  Push-Location $repoRoot
  try {
    $previousErrorAction = $ErrorActionPreference
    $ErrorActionPreference = 'Continue'
    cargo test -p menie $check.filter --lib 2>&1 | Out-Null
    $exitCode = $LASTEXITCODE
    $ErrorActionPreference = $previousErrorAction
  } finally {
    Pop-Location
  }
  $timer.Stop()
  [pscustomobject]@{
    id = $check.id
    passed = ($exitCode -eq 0)
    duration_ms = $timer.ElapsedMilliseconds
  }
}

$report = [pscustomobject]@{
  schema_version = 1
  generated_at = [DateTime]::UtcNow.ToString('o')
  local_only = $true
  meeting_content_used = $false
  checks = @($results)
  passed = (@($results | Where-Object { -not $_.passed }).Count -eq 0)
}
$outputPath = Join-Path $repoRoot 'target/local-evaluation-report.json'
New-Item -ItemType Directory -Force -Path (Split-Path $outputPath) | Out-Null
$report | ConvertTo-Json -Depth 5 | Out-File -FilePath $outputPath -Encoding utf8
if (-not $report.passed) { throw "Local evaluation harness failed. See $outputPath" }
Write-Host "Local evaluation passed. Report: $outputPath"

[CmdletBinding()]
param(
    [int64]$MaxOutputBytes = 25MB,
    [int64]$MaxJavaScriptFileBytes = 5MB
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
$outputRoot = Join-Path $repoRoot 'frontend/out'
if (-not (Test-Path -LiteralPath $outputRoot)) {
    throw "Renderer output was not found. Run the frontend production build first."
}

$files = Get-ChildItem -LiteralPath $outputRoot -Recurse -File
$totalBytes = ($files | Measure-Object -Property Length -Sum).Sum
$largestJavaScript = $files |
    Where-Object { $_.Extension -eq '.js' } |
    Sort-Object Length -Descending |
    Select-Object -First 1

if ($totalBytes -gt $MaxOutputBytes) {
    throw "Renderer output is $totalBytes bytes; budget is $MaxOutputBytes bytes."
}
if ($largestJavaScript -and $largestJavaScript.Length -gt $MaxJavaScriptFileBytes) {
    throw "Largest JavaScript file '$($largestJavaScript.Name)' is $($largestJavaScript.Length) bytes; budget is $MaxJavaScriptFileBytes bytes."
}

$report = [ordered]@{
    generated_at = [DateTime]::UtcNow.ToString('o')
    output_bytes = [int64]$totalBytes
    output_budget_bytes = $MaxOutputBytes
    largest_javascript_file = if ($largestJavaScript) { $largestJavaScript.Name } else { $null }
    largest_javascript_bytes = if ($largestJavaScript) { [int64]$largestJavaScript.Length } else { 0 }
    javascript_budget_bytes = $MaxJavaScriptFileBytes
}
$reportPath = Join-Path $repoRoot 'target/renderer-budget-report.json'
New-Item -ItemType Directory -Force -Path (Split-Path -Parent $reportPath) | Out-Null
$report | ConvertTo-Json | Out-File -FilePath $reportPath -Encoding utf8
Write-Host "Renderer budget passed. Report: $reportPath"

[CmdletBinding()]
param(
    [string]$OutputPath = ""
)

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path -Parent $PSScriptRoot
if ([string]::IsNullOrWhiteSpace($OutputPath)) {
    $OutputPath = Join-Path $repoRoot 'target/menie-sbom.json'
}
$outputDirectory = Split-Path -Parent $OutputPath
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null

$cargoJson = cargo metadata --manifest-path (Join-Path $repoRoot 'frontend/src-tauri/Cargo.toml') --format-version 1 --locked | ConvertFrom-Json
$packageJson = Get-Content (Join-Path $repoRoot 'frontend/package.json') -Raw | ConvertFrom-Json
$components = @(
    foreach ($package in $cargoJson.packages) {
        [ordered]@{ type = 'library'; ecosystem = 'cargo'; name = $package.name; version = $package.version; source = $package.source }
    }
    foreach ($property in $packageJson.dependencies.PSObject.Properties) {
        [ordered]@{ type = 'library'; ecosystem = 'npm'; name = $property.Name; version = [string]$property.Value; source = 'frontend/package.json' }
    }
    foreach ($property in $packageJson.devDependencies.PSObject.Properties) {
        [ordered]@{ type = 'library'; ecosystem = 'npm-dev'; name = $property.Name; version = [string]$property.Value; source = 'frontend/package.json' }
    }
)
$sbom = [ordered]@{
    bomFormat = 'Menie dependency inventory'
    specVersion = 1
    generatedAt = (Get-Date).ToUniversalTime().ToString('o')
    repository = 'Menie local-only desktop build'
    components = $components
}
$sbom | ConvertTo-Json -Depth 8 | Out-File -FilePath $OutputPath -Encoding utf8
Write-Host "SBOM generated: $OutputPath"

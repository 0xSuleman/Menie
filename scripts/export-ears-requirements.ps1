[CmdletBinding()]
param(
  [string]$PlanPath = "Menie_Local_Only_Product_Upgrade_Plan.docx",
  [string]$OutputPath = "docs/ears-requirements.csv"
)
$ErrorActionPreference = "Stop"
Add-Type -AssemblyName System.IO.Compression.FileSystem
if (-not (Test-Path -LiteralPath $PlanPath)) { throw "Plan not found: $PlanPath" }
$plan = (Resolve-Path -LiteralPath $PlanPath).Path
$temp = Join-Path ([IO.Path]::GetTempPath()) ("menie-ears-" + [guid]::NewGuid().ToString("N"))
New-Item -ItemType Directory -Path $temp | Out-Null
try {
  [IO.Compression.ZipFile]::ExtractToDirectory($plan, $temp)
  [xml]$doc = Get-Content -LiteralPath (Join-Path $temp "word/document.xml")
  $ns = New-Object System.Xml.XmlNamespaceManager($doc.NameTable)
  $ns.AddNamespace("w", "http://schemas.openxmlformats.org/wordprocessingml/2006/main")
  $rows = foreach ($tr in $doc.SelectNodes("//w:tbl/w:tr", $ns)) {
    $cells = foreach ($tc in $tr.SelectNodes("./w:tc", $ns)) {
      (($tc.SelectNodes(".//w:t", $ns) | ForEach-Object { $_.InnerText }) -join "")
    }
    if ($cells.Count -ge 5 -and $cells[0] -match '^[A-Z]{2,5}-\d{3}$' -and $cells[1]) {
      [pscustomobject]@{
        ID = $cells[0]
        Requirement = $cells[1]
        Priority = $cells[2]
        Target = $cells[3]
        Verify = $cells[4]
      }
    }
  }
  $rows = @($rows | Sort-Object ID -Unique)
  if ($rows.Count -ne 406) { throw "Expected 406 EARS requirements, extracted $($rows.Count)" }
  $parent = Split-Path -Parent $OutputPath
  if ($parent) { New-Item -ItemType Directory -Force -Path $parent | Out-Null }
  $rows | Export-Csv -LiteralPath $OutputPath -NoTypeInformation -Encoding UTF8
  Write-Output "Exported $($rows.Count) EARS requirements to $OutputPath"
} finally {
  if (Test-Path -LiteralPath $temp) { Remove-Item -LiteralPath $temp -Recurse -Force }
}
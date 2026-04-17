param(
  [string]$Host = '127.0.0.1',
  [int]$Port = 3306,
  [string]$User = 'root',
  [string]$Database = 'okshopee24',
  [string]$Label = 'phase-a'
)

$ErrorActionPreference = 'Stop'

$scriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$backendDir = Resolve-Path (Join-Path $scriptDir '..')
$sqlPath = Join-Path $scriptDir 'v2-phase-a-seeding-checks.sql'

if (-not (Test-Path $sqlPath)) {
  Write-Host "ERROR: SQL file not found: $sqlPath" -ForegroundColor Red
  exit 1
}

$mysqlCmd = Get-Command mysql -ErrorAction SilentlyContinue
if (-not $mysqlCmd) {
  Write-Host 'ERROR: mysql command not found in PATH.' -ForegroundColor Red
  Write-Host 'Install MySQL client or run this from a machine where mysql CLI is available.' -ForegroundColor Yellow
  exit 1
}

$timestamp = Get-Date -Format 'yyyy-MM-dd_HH-mm-ss'
$evidenceRoot = Join-Path $backendDir 'data\cutover-evidence'
$evidenceDir = Join-Path $evidenceRoot "$timestamp-$Label"

New-Item -ItemType Directory -Path $evidenceDir -Force | Out-Null

$outputFile = Join-Path $evidenceDir 'phase-a-seeding-checks-output.txt'
$metaFile = Join-Path $evidenceDir 'phase-a-run-meta.txt'

@(
  "StartedAt: $(Get-Date -Format o)",
  "Host: $Host",
  "Port: $Port",
  "User: $User",
  "Database: $Database",
  "SqlFile: $sqlPath"
) | Set-Content -Path $metaFile -Encoding UTF8

Write-Host '--- Running V2 Phase A seeding checks ---' -ForegroundColor Cyan
Write-Host "SQL: $sqlPath"
Write-Host "Evidence output: $outputFile"
Write-Host ''
Write-Host 'You will be prompted for MySQL password now.' -ForegroundColor Yellow

$sqlText = Get-Content -Path $sqlPath -Raw

$mysqlArgs = @(
  "--host=$Host",
  "--port=$Port",
  "--user=$User",
  "--database=$Database",
  '--table',
  '--show-warnings',
  '--password'
)

$sqlText |
  & $mysqlCmd.Source @mysqlArgs 2>&1 |
  Tee-Object -FilePath $outputFile

$exitCode = $LASTEXITCODE
if ($exitCode -ne 0) {
  Add-Content -Path $metaFile -Value "FinishedAt: $(Get-Date -Format o)"
  Add-Content -Path $metaFile -Value "ExitCode: $exitCode"
  Write-Host ''
  Write-Host "ERROR: mysql command failed (exit code $exitCode)." -ForegroundColor Red
  Write-Host "Check output: $outputFile"
  exit $exitCode
}

Add-Content -Path $metaFile -Value "FinishedAt: $(Get-Date -Format o)"
Add-Content -Path $metaFile -Value 'ExitCode: 0'

Write-Host ''
Write-Host 'Phase A SQL checks completed.' -ForegroundColor Green
Write-Host "Evidence folder: $evidenceDir"
Write-Host 'Pass rule: each summary count in output must be 0, and detail sections should have no rows.' -ForegroundColor Green

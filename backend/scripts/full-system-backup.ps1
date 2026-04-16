param(
  [string]$RepoRoot = (Resolve-Path (Join-Path $PSScriptRoot "..\..")).Path,
  [string]$OutputRoot,
  [string]$BackendApiBaseUrl = "http://127.0.0.1:4000",
  [switch]$SkipApiBackup,
  [switch]$SkipMySqlDump,
  [string]$MySqlHost,
  [int]$MySqlPort,
  [string]$MySqlUser,
  [string]$MySqlPassword,
  [string]$MySqlDatabase,
  [string]$MysqldumpPath = "mysqldump"
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] $Message" -ForegroundColor Cyan
}

function Write-Warn {
  param([string]$Message)
  Write-Host "[WARN] $Message" -ForegroundColor Yellow
}

function Test-Command {
  param([string]$Name)
  return $null -ne (Get-Command $Name -ErrorAction SilentlyContinue)
}

function Get-DotEnvValue {
  param(
    [string]$FilePath,
    [string]$Key
  )

  if (-not (Test-Path $FilePath)) {
    return $null
  }

  $line = Get-Content -Path $FilePath | Where-Object {
    $_ -match "^\s*$([Regex]::Escape($Key))\s*="
  } | Select-Object -First 1

  if (-not $line) {
    return $null
  }

  $value = $line -replace "^\s*$([Regex]::Escape($Key))\s*=\s*", ""
  $value = $value.Trim()

  if (($value.StartsWith('"') -and $value.EndsWith('"')) -or ($value.StartsWith("'") -and $value.EndsWith("'"))) {
    $value = $value.Substring(1, $value.Length - 2)
  }

  return $value
}

function Ensure-Dir {
  param([string]$Path)
  New-Item -ItemType Directory -Path $Path -Force | Out-Null
}

function Invoke-RobocopySafe {
  param(
    [string]$Source,
    [string]$Destination,
    [string[]]$ExcludeDirs = @()
  )

  if (-not (Test-Path $Source)) {
    Write-Warn "Source path missing, skip copy: $Source"
    return
  }

  Ensure-Dir -Path $Destination

  $args = @($Source, $Destination, "/E")
  foreach ($dir in $ExcludeDirs) {
    $args += "/XD"
    $args += $dir
  }

  & robocopy @args | Out-Null
  $code = $LASTEXITCODE
  if ($code -gt 7) {
    throw "Robocopy failed with exit code $code for source '$Source'"
  }
}

try {
  $repoRootResolved = (Resolve-Path $RepoRoot).Path
  $backendDir = Join-Path $repoRootResolved "backend"
  $frontendDir = Join-Path $repoRootResolved "frontend"

  if (-not (Test-Path $backendDir)) {
    throw "Backend directory not found: $backendDir"
  }

  if (-not (Test-Path $frontendDir)) {
    Write-Warn "Frontend directory not found: $frontendDir"
  }

  $timestamp = Get-Date -Format "yyyy-MM-dd_HH-mm-ss"
  if ([string]::IsNullOrWhiteSpace($OutputRoot)) {
    $OutputRoot = Join-Path $repoRootResolved "_system_backups"
  }

  $backupRoot = Join-Path $OutputRoot "refernex_$timestamp"
  $dbDir = Join-Path $backupRoot "db"
  $stateDir = Join-Path $backupRoot "state"
  $filesDir = Join-Path $backupRoot "files"
  $srcDir = Join-Path $backupRoot "src"
  $checksumsDir = Join-Path $backupRoot "checksums"

  Write-Step "Creating backup directory structure"
  Ensure-Dir -Path $dbDir
  Ensure-Dir -Path $stateDir
  Ensure-Dir -Path $filesDir
  Ensure-Dir -Path $srcDir
  Ensure-Dir -Path $checksumsDir

  $dotenvPath = Join-Path $backendDir ".env"
  $resolvedMySqlHost = if ($MySqlHost) { $MySqlHost } else { Get-DotEnvValue -FilePath $dotenvPath -Key "MYSQL_HOST" }
  $resolvedMySqlPort = if ($MySqlPort) { $MySqlPort } else { [int](Get-DotEnvValue -FilePath $dotenvPath -Key "MYSQL_PORT") }
  $resolvedMySqlUser = if ($MySqlUser) { $MySqlUser } else { Get-DotEnvValue -FilePath $dotenvPath -Key "MYSQL_USER" }
  $resolvedMySqlPassword = if ($MySqlPassword) { $MySqlPassword } else { Get-DotEnvValue -FilePath $dotenvPath -Key "MYSQL_PASSWORD" }
  $resolvedMySqlDatabase = if ($MySqlDatabase) { $MySqlDatabase } else { Get-DotEnvValue -FilePath $dotenvPath -Key "MYSQL_DATABASE" }

  if (-not $resolvedMySqlHost) { $resolvedMySqlHost = "127.0.0.1" }
  if (-not $resolvedMySqlPort -or $resolvedMySqlPort -le 0) { $resolvedMySqlPort = 3306 }
  if (-not $resolvedMySqlUser) { $resolvedMySqlUser = "root" }
  if (-not $resolvedMySqlDatabase) { $resolvedMySqlDatabase = "okshopee24" }

  if (-not $SkipApiBackup) {
    Write-Step "Requesting backend API state backup"
    $apiCreateBody = @{ prefix = "manual-backup"; source = "manual"; reason = "full-system-backup" } | ConvertTo-Json
    try {
      $apiCreate = Invoke-RestMethod -Uri "$BackendApiBaseUrl/api/backups/create" -Method Post -ContentType "application/json" -Body $apiCreateBody
      $apiCreate | ConvertTo-Json -Depth 12 | Out-File (Join-Path $stateDir "api-backup-create-response.json") -Encoding utf8

      $apiList = Invoke-RestMethod -Uri "$BackendApiBaseUrl/api/backups?limit=1" -Method Get
      $apiList | ConvertTo-Json -Depth 12 | Out-File (Join-Path $stateDir "api-backup-latest.json") -Encoding utf8
    }
    catch {
      Write-Warn "Backend API backup failed: $($_.Exception.Message)"
      @{ ok = $false; error = $_.Exception.Message } | ConvertTo-Json | Out-File (Join-Path $stateDir "api-backup-error.json") -Encoding utf8
    }
  }
  else {
    Write-Step "Skipping API state backup by request"
  }

  if (-not $SkipMySqlDump) {
    Write-Step "Creating MySQL dumps"

    if (-not (Test-Command $MysqldumpPath)) {
      throw "mysqldump command not found. Install MySQL client tools or pass -SkipMySqlDump."
    }

    if (-not $resolvedMySqlPassword) {
      Write-Warn "MYSQL_PASSWORD is empty. mysqldump will run without password."
    }

    $fullDumpPath = Join-Path $dbDir "full_database.sql"
    $stateStoreDumpPath = Join-Path $dbDir "state_store_only.sql"

    $argsFull = @(
      "--host=$resolvedMySqlHost",
      "--port=$resolvedMySqlPort",
      "--user=$resolvedMySqlUser",
      "--single-transaction",
      "--routines",
      "--triggers",
      "--events",
      "--databases",
      "$resolvedMySqlDatabase"
    )

    $argsState = @(
      "--host=$resolvedMySqlHost",
      "--port=$resolvedMySqlPort",
      "--user=$resolvedMySqlUser",
      "--single-transaction",
      "$resolvedMySqlDatabase",
      "state_store"
    )

    if ($resolvedMySqlPassword) {
      $env:MYSQL_PWD = $resolvedMySqlPassword
    }

    try {
      & $MysqldumpPath @argsFull > $fullDumpPath
      if ($LASTEXITCODE -ne 0) {
        throw "mysqldump full database failed with exit code $LASTEXITCODE"
      }

      & $MysqldumpPath @argsState > $stateStoreDumpPath
      if ($LASTEXITCODE -ne 0) {
        throw "mysqldump state_store failed with exit code $LASTEXITCODE"
      }
    }
    finally {
      Remove-Item Env:MYSQL_PWD -ErrorAction SilentlyContinue
    }
  }
  else {
    Write-Step "Skipping MySQL dump by request"
  }

  Write-Step "Copying backend runtime data and uploads"
  $backendDataDir = Join-Path $backendDir "data"
  Invoke-RobocopySafe -Source (Join-Path $backendDataDir "backups") -Destination (Join-Path $filesDir "backend-data-backups")
  Invoke-RobocopySafe -Source (Join-Path $backendDataDir "uploads") -Destination (Join-Path $filesDir "backend-uploads")

  $stateFile1 = Join-Path $backendDataDir "app-state.json"
  $stateFile2 = Join-Path $backendDataDir "app-state.local.json"
  if (Test-Path $stateFile1) { Copy-Item $stateFile1 (Join-Path $filesDir "app-state.json") -Force }
  if (Test-Path $stateFile2) { Copy-Item $stateFile2 (Join-Path $filesDir "app-state.local.json") -Force }

  Write-Step "Copying environment files"
  $backendEnv = Join-Path $backendDir ".env"
  $frontendEnv = Join-Path $frontendDir ".env"
  $frontendEnvProd = Join-Path $frontendDir ".env.production"

  if (Test-Path $backendEnv) { Copy-Item $backendEnv (Join-Path $filesDir "backend.env") -Force }
  if (Test-Path $frontendEnv) { Copy-Item $frontendEnv (Join-Path $filesDir "frontend.env") -Force }
  if (Test-Path $frontendEnvProd) { Copy-Item $frontendEnvProd (Join-Path $filesDir "frontend.env.production") -Force }

  Write-Step "Creating source code archive (without node_modules/dist/heavy runtime folders)"
  $stageDir = Join-Path $backupRoot "_stage"
  $stageBackend = Join-Path $stageDir "backend"
  $stageFrontend = Join-Path $stageDir "frontend"
  Ensure-Dir -Path $stageBackend
  Ensure-Dir -Path $stageFrontend

  Invoke-RobocopySafe -Source $backendDir -Destination $stageBackend -ExcludeDirs @("node_modules", "data\uploads", "data\backups")

  if (Test-Path $frontendDir) {
    Invoke-RobocopySafe -Source $frontendDir -Destination $stageFrontend -ExcludeDirs @("node_modules", "dist")
  }

  $rootReadme = Join-Path $repoRootResolved "README.md"
  if (Test-Path $rootReadme) {
    Copy-Item $rootReadme (Join-Path $stageDir "README.md") -Force
  }

  $sourceZipPath = Join-Path $srcDir "source-no-deps.zip"
  if (Test-Path $sourceZipPath) { Remove-Item $sourceZipPath -Force }
  Compress-Archive -Path (Join-Path $stageDir "*") -DestinationPath $sourceZipPath -CompressionLevel Optimal
  Remove-Item $stageDir -Recurse -Force

  Write-Step "Generating checksum manifest"
  Get-ChildItem $backupRoot -Recurse -File |
    Get-FileHash -Algorithm SHA256 |
    Export-Csv (Join-Path $checksumsDir "sha256.csv") -NoTypeInformation

  Write-Step "Writing backup metadata"
  $metadata = [ordered]@{
    createdAt = (Get-Date).ToString("o")
    backupRoot = $backupRoot
    repoRoot = $repoRootResolved
    backendApiBaseUrl = $BackendApiBaseUrl
    mysql = [ordered]@{
      host = $resolvedMySqlHost
      port = $resolvedMySqlPort
      user = $resolvedMySqlUser
      database = $resolvedMySqlDatabase
      dumpCreated = (-not $SkipMySqlDump)
    }
    artifacts = [ordered]@{
      db = $dbDir
      state = $stateDir
      files = $filesDir
      sourceZip = $sourceZipPath
      checksums = (Join-Path $checksumsDir "sha256.csv")
    }
  }

  $metadata | ConvertTo-Json -Depth 10 | Out-File (Join-Path $backupRoot "backup-metadata.json") -Encoding utf8

  Write-Host ""
  Write-Host "Backup completed successfully." -ForegroundColor Green
  Write-Host "Backup root: $backupRoot" -ForegroundColor Green
  exit 0
}
catch {
  Write-Host ""
  Write-Host "Backup failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

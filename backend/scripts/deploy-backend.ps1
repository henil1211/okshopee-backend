param(
  [string]$RepoDir = "E:\apps\okshopee-backend\backend",
  [string]$Branch = "main",
  [string]$Pm2Process = "refernex-api",
  [string]$Pm2Home = "E:\apps\.pm2",
  [string]$LocalHealthUrl = "http://127.0.0.1:4000/api/health",
  [string]$PublicHealthUrl = "https://api.refernex.com/api/health",
  [int]$HealthRetries = 24,
  [int]$HealthRetryDelaySec = 5
)

$ErrorActionPreference = "Stop"

function Write-Step {
  param([string]$Message)
  $ts = Get-Date -Format "yyyy-MM-dd HH:mm:ss"
  Write-Host "[$ts] $Message" -ForegroundColor Cyan
}

function Ensure-Command {
  param([string]$Name)
  if (-not (Get-Command $Name -ErrorAction SilentlyContinue)) {
    throw "Required command not found: $Name"
  }
}

function Test-Health {
  param(
    [string]$Url,
    [int]$Retries,
    [int]$DelaySec
  )

  for ($i = 1; $i -le $Retries; $i++) {
    try {
      $response = Invoke-WebRequest -Uri $Url -UseBasicParsing -TimeoutSec 10
      if ($response.StatusCode -ge 200 -and $response.StatusCode -lt 300) {
        Write-Host "Health OK: $Url (HTTP $($response.StatusCode))" -ForegroundColor Green
        return $true
      }
    } catch {
      Write-Host "Health attempt $i/$Retries failed for $Url" -ForegroundColor Yellow
    }
    Start-Sleep -Seconds $DelaySec
  }

  return $false
}

try {
  Write-Step "Validating tools"
  Ensure-Command "git"
  Ensure-Command "npm"
  Ensure-Command "pm2"

  if (-not (Test-Path $RepoDir)) {
    throw "Repo directory does not exist: $RepoDir"
  }

  $env:PM2_HOME = $Pm2Home
  $env:NODE_ENV = "production"
  if (-not (Test-Path $Pm2Home)) {
    New-Item -ItemType Directory -Path $Pm2Home -Force | Out-Null
  }

  Write-Step "Switching to repo directory: $RepoDir"
  Set-Location $RepoDir

  $beforeCommit = (git rev-parse --short HEAD).Trim()
  Write-Step "Current commit: $beforeCommit"

  Write-Step "Pulling latest code from origin/$Branch"
  git fetch origin $Branch
  git pull origin $Branch

  $afterCommit = (git rev-parse --short HEAD).Trim()
  Write-Step "Updated commit: $afterCommit"

  Write-Step "Installing/updating dependencies"
  npm install --no-audit --no-fund

  Write-Step "Checking PM2 process: $Pm2Process"
  $pm2PidRaw = (pm2 pid $Pm2Process 2>$null | Out-String).Trim()
  $pm2PidNum = 0
  if ($pm2PidRaw -match '^\d+$') {
    $pm2PidNum = [int]$pm2PidRaw
  }

  if ($pm2PidNum -gt 0) {
    Write-Step "Restarting PM2 process: $Pm2Process"
    pm2 restart $Pm2Process --update-env
  } else {
    Write-Step "PM2 process not found. Starting new process: $Pm2Process"
    pm2 start server.js --name $Pm2Process --time
  }

  Write-Step "Saving PM2 process list"
  pm2 save

  Write-Step "PM2 status"
  pm2 status

  Write-Step "Running local health check: $LocalHealthUrl"
  $localOk = Test-Health -Url $LocalHealthUrl -Retries $HealthRetries -DelaySec $HealthRetryDelaySec
  if (-not $localOk) {
    throw "Local health check failed: $LocalHealthUrl"
  }

  Write-Step "Running public health check: $PublicHealthUrl"
  $publicOk = Test-Health -Url $PublicHealthUrl -Retries $HealthRetries -DelaySec $HealthRetryDelaySec
  if (-not $publicOk) {
    Write-Host "Warning: Public health check failed. Local API is healthy; verify Caddy/DNS/SSL." -ForegroundColor Yellow
  }

  Write-Host ""
  Write-Host "Deploy completed successfully." -ForegroundColor Green
  Write-Host "Commit: $beforeCommit -> $afterCommit"
  exit 0
}
catch {
  Write-Host ""
  Write-Host "Deploy failed: $($_.Exception.Message)" -ForegroundColor Red
  exit 1
}

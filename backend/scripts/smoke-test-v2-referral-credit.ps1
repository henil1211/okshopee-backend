param(
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$ActorUserCode = '1000001',
  [string]$SourceUserCode = '1000001',
  [string]$BeneficiaryUserCode = '2000002',
  [long]$SourceTxnId = 0,
  [ValidateSet('direct_referral', 'level_referral')]
  [string]$EventType = 'direct_referral',
  [int]$LevelNo = 1,
  [long]$AmountCents = 500,
  [string]$SystemVersion = 'v2',
  [string]$Description = 'Referral credit smoke test',
  [string]$IdempotencyKey = ''
)

$ErrorActionPreference = 'Stop'

if ($SourceTxnId -le 0) {
  Write-Host 'ERROR: SourceTxnId is required and must be > 0.' -ForegroundColor Red
  Write-Host 'Example:'
  Write-Host '  powershell -ExecutionPolicy Bypass -File .\backend\scripts\smoke-test-v2-referral-credit.ps1 -SourceTxnId 12345'
  exit 1
}

if ([string]::IsNullOrWhiteSpace($IdempotencyKey)) {
  $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
  $IdempotencyKey = "ref-$SourceUserCode-$BeneficiaryUserCode-$SourceTxnId-$LevelNo-$timestamp"
}

$endpoint = "$($BackendUrl.TrimEnd('/'))/api/v2/referrals/credit"

$headers = @{
  Authorization = "Bearer $ActorUserCode"
  'X-System-Version' = $SystemVersion
  'Idempotency-Key' = $IdempotencyKey
}

$payload = @{
  sourceUserCode = $SourceUserCode
  beneficiaryUserCode = $BeneficiaryUserCode
  sourceTxnId = $SourceTxnId
  eventType = $EventType
  levelNo = $LevelNo
  amountCents = $AmountCents
  description = $Description
}

$body = $payload | ConvertTo-Json -Depth 5 -Compress

Write-Host '--- V2 Referral Credit Smoke Test ---' -ForegroundColor Cyan
Write-Host "Endpoint: $endpoint"
Write-Host "Idempotency-Key: $IdempotencyKey"
Write-Host "Request Body: $body"

try {
  $response = Invoke-WebRequest -Uri $endpoint -Method Post -Headers $headers -Body $body -ContentType 'application/json'
  Write-Host "HTTP: $($response.StatusCode)" -ForegroundColor Green
  Write-Host 'Response:'
  Write-Host $response.Content
  exit 0
} catch {
  $statusCode = $null
  $responseBody = $null

  if ($_.Exception.Response) {
    try {
      $statusCode = [int]$_.Exception.Response.StatusCode
    } catch {
      $statusCode = $null
    }

    try {
      $stream = $_.Exception.Response.GetResponseStream()
      if ($stream) {
        $reader = New-Object System.IO.StreamReader($stream)
        $responseBody = $reader.ReadToEnd()
        $reader.Dispose()
      }
    } catch {
      $responseBody = $null
    }
  }

  if ($statusCode) {
    Write-Host "HTTP: $statusCode" -ForegroundColor Yellow
  } else {
    Write-Host 'HTTP: request failed before receiving response' -ForegroundColor Yellow
  }

  if ($responseBody) {
    Write-Host 'Response:'
    Write-Host $responseBody
  } else {
    Write-Host "Error: $($_.Exception.Message)" -ForegroundColor Red
  }

  exit 1
}

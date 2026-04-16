param(
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$ActorUserCode = '1000001',
  [string]$BuyerUserCode = '1000001',
  [int]$Quantity = 2,
  [Nullable[long]]$PinPriceCents = $null,
  [string]$ExpiresAt = '',
  [string]$SystemVersion = 'v2',
  [string]$Description = 'Pin purchase smoke test',
  [string]$IdempotencyKey = ''
)

$ErrorActionPreference = 'Stop'

if ($Quantity -lt 1) {
  Write-Host 'ERROR: Quantity must be >= 1.' -ForegroundColor Red
  exit 1
}

if ($null -ne $PinPriceCents -and $PinPriceCents -le 0) {
  Write-Host 'ERROR: PinPriceCents must be > 0 when provided.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($IdempotencyKey)) {
  $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
  $IdempotencyKey = "pin-$BuyerUserCode-$Quantity-$timestamp"
}

$endpoint = "$($BackendUrl.TrimEnd('/'))/api/v2/pins/purchase"

$headers = @{
  Authorization = "Bearer $ActorUserCode"
  'X-System-Version' = $SystemVersion
  'Idempotency-Key' = $IdempotencyKey
}

$payload = @{
  buyerUserCode = $BuyerUserCode
  quantity = $Quantity
  description = $Description
}

if ($null -ne $PinPriceCents) {
  $payload.pinPriceCents = [long]$PinPriceCents
}

if (-not [string]::IsNullOrWhiteSpace($ExpiresAt)) {
  $payload.expiresAt = $ExpiresAt.Trim()
}

$body = $payload | ConvertTo-Json -Depth 5 -Compress

Write-Host '--- V2 Pin Purchase Smoke Test ---' -ForegroundColor Cyan
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

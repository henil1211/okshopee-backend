param(
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$ActorUserCode = '1000001',
  [string]$TargetUserCode = '2000002',
  [string]$ApproverUserCode = '3000003',
  [ValidateSet('fund', 'income', 'royalty')]
  [string]$WalletType = 'income',
  [ValidateSet('credit', 'debit')]
  [string]$Direction = 'credit',
  [long]$AmountCents = 500,
  [string]$ReasonCode = 'MANUAL_FIX',
  [string]$TicketId = 'INC-0001',
  [string]$Note = 'Emergency correction approved by operations',
  [string]$SystemVersion = 'v2',
  [string]$Description = 'Admin adjustment smoke test',
  [string]$IdempotencyKey = ''
)

$ErrorActionPreference = 'Stop'

if ($AmountCents -le 0) {
  Write-Host 'ERROR: AmountCents must be > 0.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($ReasonCode)) {
  Write-Host 'ERROR: ReasonCode is required.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($TicketId)) {
  Write-Host 'ERROR: TicketId is required.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($Note)) {
  Write-Host 'ERROR: Note is required.' -ForegroundColor Red
  exit 1
}

if ([string]::IsNullOrWhiteSpace($IdempotencyKey)) {
  $timestamp = Get-Date -Format 'yyyyMMddHHmmss'
  $IdempotencyKey = "adj-$TargetUserCode-$Direction-$AmountCents-$timestamp"
}

$endpoint = "$($BackendUrl.TrimEnd('/'))/api/v2/admin/adjustments"

$headers = @{
  Authorization = "Bearer $ActorUserCode"
  'X-System-Version' = $SystemVersion
  'Idempotency-Key' = $IdempotencyKey
}

$payload = @{
  targetUserCode = $TargetUserCode
  approverUserCode = $ApproverUserCode
  walletType = $WalletType
  direction = $Direction
  amountCents = $AmountCents
  reasonCode = $ReasonCode.Trim().ToUpperInvariant()
  ticketId = $TicketId
  note = $Note
  description = $Description
}

$body = $payload | ConvertTo-Json -Depth 5 -Compress

Write-Host '--- V2 Admin Adjustment Smoke Test ---' -ForegroundColor Cyan
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

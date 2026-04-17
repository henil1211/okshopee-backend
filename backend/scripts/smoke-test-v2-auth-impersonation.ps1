param(
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$UserId = '1000001',
  [string]$Password,
  [string]$OtherUserCode = '2000002',
  [string]$AdminApproverUserCode = '3000003'
)

$ErrorActionPreference = 'Stop'

if ([string]::IsNullOrWhiteSpace($Password)) {
  Write-Host 'ERROR: Password is required.' -ForegroundColor Red
  exit 1
}

$baseUrl = $BackendUrl.TrimEnd('/')
$loginUrl = "$baseUrl/api/auth/login"

function Invoke-JsonRequest {
  param(
    [string]$Method,
    [string]$Url,
    [hashtable]$Headers,
    [hashtable]$BodyObject
  )

  $bodyJson = if ($BodyObject) { $BodyObject | ConvertTo-Json -Depth 8 -Compress } else { $null }

  try {
    $response = Invoke-WebRequest -Uri $Url -Method $Method -Headers $Headers -Body $bodyJson -ContentType 'application/json' -UseBasicParsing
    $parsedBody = $null
    if ($response.Content) {
      try { $parsedBody = $response.Content | ConvertFrom-Json } catch { $parsedBody = $null }
    }

    return [PSCustomObject]@{
      ok = $true
      status = [int]$response.StatusCode
      body = $parsedBody
      rawBody = $response.Content
    }
  } catch {
    $statusCode = 0
    $responseBody = ''
    $parsedBody = $null

    if ($_.ErrorDetails -and $_.ErrorDetails.Message) {
      $responseBody = [string]$_.ErrorDetails.Message
    }

    if ($_.Exception.Response) {
      try { $statusCode = [int]$_.Exception.Response.StatusCode } catch { $statusCode = 0 }
      if ([string]::IsNullOrWhiteSpace($responseBody)) {
        try {
          $stream = $_.Exception.Response.GetResponseStream()
          if ($stream) {
            $reader = New-Object System.IO.StreamReader($stream)
            $responseBody = $reader.ReadToEnd()
            $reader.Dispose()
          }
        } catch {
          $responseBody = ''
        }
      }
    }

    if ($responseBody) {
      try { $parsedBody = $responseBody | ConvertFrom-Json } catch { $parsedBody = $null }
    }

    return [PSCustomObject]@{
      ok = $false
      status = $statusCode
      body = $parsedBody
      rawBody = $responseBody
    }
  }
}

function Assert-Expected {
  param(
    [string]$Name,
    [object]$Response,
    [int]$ExpectedStatus,
    [string]$ExpectedCode
  )

  $actualCode = if ($Response.body) { [string]$Response.body.code } else { '' }
  $pass = ($Response.status -eq $ExpectedStatus) -and ($actualCode -eq $ExpectedCode)

  [PSCustomObject]@{
    name = $Name
    expectedStatus = $ExpectedStatus
    actualStatus = $Response.status
    expectedCode = $ExpectedCode
    actualCode = $actualCode
    pass = $pass
    rawBody = $Response.rawBody
  }
}

function New-Headers {
  param(
    [hashtable]$Base,
    [hashtable]$Extra
  )

  $merged = @{}
  if ($Base) {
    foreach ($key in $Base.Keys) {
      $merged[$key] = $Base[$key]
    }
  }
  if ($Extra) {
    foreach ($key in $Extra.Keys) {
      $merged[$key] = $Extra[$key]
    }
  }
  return $merged
}

Write-Host '--- V2 Auth/AuthZ Verification Smoke Test ---' -ForegroundColor Cyan
Write-Host "Backend: $baseUrl"
Write-Host "UserId: $UserId"

$loginResponse = Invoke-JsonRequest -Method 'POST' -Url $loginUrl -Headers @{} -BodyObject @{
  userId = $UserId
  password = $Password
}

if ($loginResponse.status -ne 200 -or -not ($loginResponse.body -and $loginResponse.body.ok)) {
  Write-Host 'ERROR: Login failed.' -ForegroundColor Red
  Write-Host $loginResponse.rawBody
  exit 1
}

$accessToken = [string]$loginResponse.body.v2Auth.accessToken
if ([string]::IsNullOrWhiteSpace($accessToken)) {
  $accessToken = $UserId
  Write-Host 'Login response did not include signed V2 token; falling back to legacy Bearer userCode.' -ForegroundColor Yellow
} else {
  Write-Host 'Login returned signed V2 access token.' -ForegroundColor Green
}

$commonHeaders = @{
  Authorization = "Bearer $accessToken"
  'X-System-Version' = 'v2'
}

$isAdminCaller = $false
if ($loginResponse.body -and $loginResponse.body.user) {
  $isAdminCaller = [bool]$loginResponse.body.user.isAdmin
}

$results = @()

$invalidBearerHeaders = @{
  Authorization = 'Bearer not-a-valid-v2-token'
  'X-System-Version' = 'v2'
  'Idempotency-Key' = "auth-invalid-$(Get-Date -Format 'yyyyMMddHHmmss')"
}
$invalidBearerResponse = Invoke-JsonRequest -Method 'POST' -Url "$baseUrl/api/v2/fund-transfers" -Headers $invalidBearerHeaders -BodyObject @{
  senderUserCode = $UserId
  receiverUserCode = $OtherUserCode
  amountCents = 100
}
$results += Assert-Expected -Name 'invalid-bearer-token' -Response $invalidBearerResponse -ExpectedStatus 401 -ExpectedCode 'INVALID_BEARER_TOKEN'

$fundTransferResponse = Invoke-JsonRequest -Method 'POST' -Url "$baseUrl/api/v2/fund-transfers" -Headers (New-Headers -Base $commonHeaders -Extra @{ 'Idempotency-Key' = "auth-ft-$(Get-Date -Format 'yyyyMMddHHmmss')"; 'X-Request-Id' = [guid]::NewGuid().ToString() }) -BodyObject @{
  senderUserCode = $OtherUserCode
  receiverUserCode = $UserId
  amountCents = 100
}
$results += Assert-Expected -Name 'fund-transfer-actor-mismatch' -Response $fundTransferResponse -ExpectedStatus 403 -ExpectedCode 'ACTOR_SENDER_MISMATCH'

$pinPurchaseResponse = Invoke-JsonRequest -Method 'POST' -Url "$baseUrl/api/v2/pins/purchase" -Headers (New-Headers -Base $commonHeaders -Extra @{ 'Idempotency-Key' = "auth-pin-$(Get-Date -Format 'yyyyMMddHHmmss')" }) -BodyObject @{
  buyerUserCode = $OtherUserCode
  quantity = 1
}
$results += Assert-Expected -Name 'pin-purchase-actor-mismatch' -Response $pinPurchaseResponse -ExpectedStatus 403 -ExpectedCode 'ACTOR_BUYER_MISMATCH'

$referralResponse = Invoke-JsonRequest -Method 'POST' -Url "$baseUrl/api/v2/referrals/credit" -Headers (New-Headers -Base $commonHeaders -Extra @{ 'Idempotency-Key' = "auth-ref-$(Get-Date -Format 'yyyyMMddHHmmss')" }) -BodyObject @{
  sourceUserCode = $OtherUserCode
  beneficiaryUserCode = $UserId
  sourceTxnId = 1
  eventType = 'direct_referral'
  levelNo = 1
  amountCents = 500
}
$results += Assert-Expected -Name 'referral-credit-actor-mismatch' -Response $referralResponse -ExpectedStatus 403 -ExpectedCode 'ACTOR_SOURCE_MISMATCH'

if ($isAdminCaller) {
  Write-Host 'Skipping admin-adjustment-admin-role-required check because login user is admin.' -ForegroundColor Yellow
  $results += [PSCustomObject]@{
    name = 'admin-adjustment-admin-role-required'
    expectedStatus = 403
    actualStatus = 'skipped'
    expectedCode = 'ADMIN_ROLE_REQUIRED'
    actualCode = 'SKIPPED_FOR_ADMIN_CALLER'
    pass = $true
    rawBody = ''
  }
} else {
  $adminAdjustmentResponse = Invoke-JsonRequest -Method 'POST' -Url "$baseUrl/api/v2/admin/adjustments" -Headers (New-Headers -Base $commonHeaders -Extra @{ 'Idempotency-Key' = "auth-adj-$(Get-Date -Format 'yyyyMMddHHmmss')" }) -BodyObject @{
    targetUserCode = $OtherUserCode
    approverUserCode = $AdminApproverUserCode
    walletType = 'income'
    direction = 'credit'
    amountCents = 500
    reasonCode = 'MANUAL_FIX'
    ticketId = 'AUTH-VERIFY-001'
    note = 'Auth verification should block non-admin caller'
  }
  $results += Assert-Expected -Name 'admin-adjustment-admin-role-required' -Response $adminAdjustmentResponse -ExpectedStatus 403 -ExpectedCode 'ADMIN_ROLE_REQUIRED'
}

Write-Host ''
Write-Host 'Results:' -ForegroundColor Cyan
$results | Format-Table -AutoSize | Out-String | Write-Host

$failed = @($results | Where-Object { -not $_.pass })
if ($failed.Count -gt 0) {
  Write-Host 'Failures:' -ForegroundColor Red
  $failed | Select-Object name, actualStatus, actualCode, rawBody | Format-List | Out-String | Write-Host
  exit 1
}

Write-Host 'Auth/AuthZ smoke verification passed.' -ForegroundColor Green
exit 0

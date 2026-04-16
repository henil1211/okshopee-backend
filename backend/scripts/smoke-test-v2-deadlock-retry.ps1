param(
  [string]$BackendUrl = 'http://127.0.0.1:4000',
  [string]$ActorUserCode = '1000001',
  [string]$SenderUserCode = '1000001',
  [string]$ReceiverUserCode = '2000002',
  [long]$AmountCents = 100,
  [int]$Requests = 12,
  [int]$Parallelism = 6,
  [string]$SystemVersion = 'v2',
  [string]$IdempotencyPrefix = 'ft-retry-smoke',
  [switch]$SaveReport
)

$ErrorActionPreference = 'Stop'

if ($Requests -lt 1) {
  Write-Host 'ERROR: Requests must be >= 1.' -ForegroundColor Red
  exit 1
}

if ($Parallelism -lt 1) {
  Write-Host 'ERROR: Parallelism must be >= 1.' -ForegroundColor Red
  exit 1
}

$endpoint = "$($BackendUrl.TrimEnd('/'))/api/v2/fund-transfers"
$timestamp = Get-Date -Format 'yyyyMMddHHmmss'
$jobs = New-Object System.Collections.Generic.List[System.Management.Automation.Job]
$results = @()

Write-Host '--- V2 Deadlock Retry Smoke Test ---' -ForegroundColor Cyan
Write-Host "Endpoint: $endpoint"
Write-Host "Requests: $Requests"
Write-Host "Parallelism: $Parallelism"
Write-Host "Sender -> Receiver: $SenderUserCode -> $ReceiverUserCode"
Write-Host "AmountCents: $AmountCents"

$invokeScript = {
  param($Endpoint, $Actor, $SystemVersion, $IdempotencyKey, $BodyJson)

  $headers = @{
    Authorization = "Bearer $Actor"
    'X-System-Version' = $SystemVersion
    'Idempotency-Key' = $IdempotencyKey
  }

  try {
    $response = Invoke-WebRequest -Uri $Endpoint -Method Post -Headers $headers -Body $BodyJson -ContentType 'application/json' -UseBasicParsing
    [PSCustomObject]@{
      idempotencyKey = $IdempotencyKey
      status = [int]$response.StatusCode
      ok = $true
      code = $null
      retryAttemptsUsed = $null
      body = $response.Content
    }
  } catch {
    $statusCode = 0
    $responseBody = ''

    if ($_.Exception.Response) {
      try {
        $statusCode = [int]$_.Exception.Response.StatusCode
      } catch {
        $statusCode = 0
      }

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

    $code = $null
    $retryAttemptsUsed = $null
    if ($responseBody) {
      try {
        $parsed = $responseBody | ConvertFrom-Json
        $code = $parsed.code
        $retryAttemptsUsed = $parsed.retryAttemptsUsed
      } catch {
        $code = $null
      }
    }

    [PSCustomObject]@{
      idempotencyKey = $IdempotencyKey
      status = $statusCode
      ok = $false
      code = $code
      retryAttemptsUsed = $retryAttemptsUsed
      body = $responseBody
    }
  }
}

function Receive-CompletedJobs {
  param([System.Collections.Generic.List[System.Management.Automation.Job]]$JobList)

  $completed = @($JobList | Where-Object { $_.State -in @('Completed', 'Failed', 'Stopped') })
  if ($completed.Count -eq 0) {
    return @()
  }

  $out = @()
  foreach ($job in $completed) {
    $out += Receive-Job -Job $job -Keep
    Remove-Job -Job $job -Force | Out-Null
    [void]$JobList.Remove($job)
  }

  return $out
}

for ($i = 1; $i -le $Requests; $i += 1) {
  while (($jobs | Where-Object { $_.State -eq 'Running' }).Count -ge $Parallelism) {
    Start-Sleep -Milliseconds 100
    $results += Receive-CompletedJobs -JobList $jobs
  }

  $requestId = '{0:D3}' -f $i
  $idempotencyKey = "$IdempotencyPrefix-$timestamp-$requestId"

  $payload = @{
    senderUserCode = $SenderUserCode
    receiverUserCode = $ReceiverUserCode
    amountCents = $AmountCents
    referenceId = "retry-smoke-$timestamp-$requestId"
    description = 'Deadlock retry smoke test'
  }

  $bodyJson = $payload | ConvertTo-Json -Depth 6 -Compress
  $job = Start-Job -ScriptBlock $invokeScript -ArgumentList @($endpoint, $ActorUserCode, $SystemVersion, $idempotencyKey, $bodyJson)
  [void]$jobs.Add($job)
}

while ($jobs.Count -gt 0) {
  Start-Sleep -Milliseconds 100
  $results += Receive-CompletedJobs -JobList $jobs
}

$total = $results.Count
$successCount = ($results | Where-Object { $_.status -eq 200 }).Count
$conflictCount = ($results | Where-Object { $_.status -eq 409 }).Count
$retryExhaustedCount = ($results | Where-Object { $_.code -eq 'TX_RETRY_EXHAUSTED' }).Count
$serverErrorCount = ($results | Where-Object { $_.status -ge 500 }).Count

$summary = [PSCustomObject]@{
  generatedAt = (Get-Date).ToString('o')
  endpoint = $endpoint
  requests = $total
  success200 = $successCount
  conflict409 = $conflictCount
  retryExhausted = $retryExhaustedCount
  serverErrors5xx = $serverErrorCount
}

Write-Host ''
Write-Host 'Summary:' -ForegroundColor Cyan
$summary | Format-List | Out-String | Write-Host

$non200 = @($results | Where-Object { $_.status -ne 200 })
if ($non200.Count -gt 0) {
  Write-Host 'Non-200 samples:' -ForegroundColor Yellow
  $non200 | Select-Object -First 5 idempotencyKey, status, code, retryAttemptsUsed, body | Format-Table -AutoSize | Out-String | Write-Host
}

if ($SaveReport) {
  $reportName = "deadlock-retry-report-$timestamp.json"
  $reportPath = Join-Path -Path (Get-Location) -ChildPath $reportName
  $report = [PSCustomObject]@{
    summary = $summary
    results = $results
  }
  $report | ConvertTo-Json -Depth 8 | Set-Content -Path $reportPath -Encoding UTF8
  Write-Host "Saved report: $reportPath" -ForegroundColor Green
}

if ($serverErrorCount -gt 0 -or $retryExhaustedCount -gt 0) {
  exit 1
}

exit 0

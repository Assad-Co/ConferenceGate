param(
  [string]$CredentialPath = ".env.ethereal.secure.json",
  [string]$ServiceId = "srv-d9n2mdrncjis739bas80",
  [string]$Recipient = "qa-launch-20261025-01@example.invalid"
)
$ErrorActionPreference = "Stop"
$VerbosePreference = "SilentlyContinue"
$DebugPreference = "SilentlyContinue"
if ($Recipient -notmatch '^qa-[a-zA-Z0-9._+-]+@example\.invalid$') { throw "Only an explicit synthetic QA recipient is permitted." }
$stored = Get-Content -LiteralPath $CredentialPath -Raw | ConvertFrom-Json
$apiSecret = Read-Host "Render API key (hidden; never stored)" -AsSecureString
$headers = @{ Authorization = "Bearer " + [System.Net.NetworkCredential]::new("", $apiSecret).Password }
$variables = @{
  ETHEREAL_TEST_RECIPIENTS = $Recipient
  ETHEREAL_TEST_USER = [System.Net.NetworkCredential]::new("", (ConvertTo-SecureString $stored.user)).Password
  ETHEREAL_TEST_PASSWORD = [System.Net.NetworkCredential]::new("", (ConvertTo-SecureString $stored.password)).Password
}
try {
  foreach ($name in @("ETHEREAL_TEST_USER", "ETHEREAL_TEST_PASSWORD", "ETHEREAL_TEST_RECIPIENTS")) {
    $body = @{ value = $variables[$name] } | ConvertTo-Json -Compress
    try {
      $null = Invoke-RestMethod -Uri "https://api.render.com/v1/services/$ServiceId/env-vars/$name" -Method Put -Headers $headers -ContentType "application/json" -Body $body -TimeoutSec 30
    } catch {
      throw "Could not save $name on Render. Provider response and secrets suppressed. Other service variables were not replaced."
    }
    Write-Output "Saved $name (value hidden)."
  }
  Write-Output "Test inbox settings saved. Deploy the existing build and verify capture before testing recovery."
} finally {
  $headers.Clear()
  $variables.Clear()
  $body = $null
  $apiSecret = $null
}

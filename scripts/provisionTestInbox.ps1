param([string]$OutputPath = ".env.ethereal.secure.json")
$ErrorActionPreference = "Stop"
if (Test-Path -LiteralPath $OutputPath) { throw "A protected inbox file already exists. Reuse it instead of overwriting." }
$response = Invoke-RestMethod -Uri "https://api.nodemailer.com/user" -Method Post -ContentType "application/json" -Body '{"requestor":"ConferenceGate QA","version":"1.0"}' -TimeoutSec 30
if ($response.status -ne "success" -or -not $response.user -or -not $response.pass) { throw "Test inbox provisioning failed." }
# Windows DPAPI binds the credentials to this OS account. Never print the response.
$protectedUser = ConvertFrom-SecureString (ConvertTo-SecureString $response.user -AsPlainText -Force)
$protectedPassword = ConvertFrom-SecureString (ConvertTo-SecureString $response.pass -AsPlainText -Force)
@{ user = $protectedUser; password = $protectedPassword } | ConvertTo-Json | Set-Content -LiteralPath $OutputPath
Write-Output "Free test inbox provisioned; credentials saved with Windows DPAPI protection."

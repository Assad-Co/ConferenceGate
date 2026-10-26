param([string]$CredentialPath = ".env.ethereal.secure.json", [ValidateSet("connection", "recovery")][string]$Mode = "connection")
$ErrorActionPreference = "Stop"
$stored = Get-Content -LiteralPath $CredentialPath -Raw | ConvertFrom-Json
$userSecret = ConvertTo-SecureString $stored.user
$passwordSecret = ConvertTo-SecureString $stored.password
$processInfo = [System.Diagnostics.ProcessStartInfo]::new()
$processInfo.FileName = "node"
$script = if ($Mode -eq "recovery") { "smokeCapturedRecovery.mjs" } else { "checkTestInbox.mjs" }
$processInfo.ArgumentList.Add((Join-Path $PSScriptRoot $script))
$processInfo.UseShellExecute = $false
$processInfo.Environment["ETHEREAL_TEST_USER"] = [System.Net.NetworkCredential]::new("", $userSecret).Password
$processInfo.Environment["ETHEREAL_TEST_PASSWORD"] = [System.Net.NetworkCredential]::new("", $passwordSecret).Password
$child = [System.Diagnostics.Process]::Start($processInfo)
$child.WaitForExit()
$processInfo.Environment.Remove("ETHEREAL_TEST_USER") | Out-Null
$processInfo.Environment.Remove("ETHEREAL_TEST_PASSWORD") | Out-Null
exit $child.ExitCode

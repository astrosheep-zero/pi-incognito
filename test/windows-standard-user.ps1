param(
  [Parameter(Mandatory=$true)][string]$Node,
  [Parameter(Mandatory=$true)][string]$Root,
  [Parameter(Mandatory=$true)][string]$Temp
)
$ErrorActionPreference = 'Stop'
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if ($principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Expected a non-admin token.' }
$developerMode = (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\AppModelUnlock').AllowDevelopmentWithoutDevLicense
if ($developerMode -ne 0) { throw 'Expected Developer Mode disabled.' }
Write-Host "Standard-user verification: $($identity.Name); administrator=False; developerMode=False"
$env:TEMP = $Temp
$env:TMP = $Temp
$env:PI_OFFLINE = '1'
Set-Location $Root
& $Node --experimental-strip-types --test test/cli.test.ts test/incognito.test.ts test/crash.test.ts
exit $LASTEXITCODE

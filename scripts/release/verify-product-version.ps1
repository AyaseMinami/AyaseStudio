param(
  [Parameter(Mandatory = $true)][string]$Installer,
  [Parameter(Mandatory = $true)][string]$Version
)

$ErrorActionPreference = 'Stop'
$actual = (Get-Item -LiteralPath $Installer).VersionInfo.ProductVersion
if ($actual -cne $Version) { throw 'Built/downloaded installer ProductVersion mismatch' }
Write-Output 'Installer ProductVersion verified.'

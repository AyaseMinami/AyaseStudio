param([string]$NsisDirectory = "$env:LOCALAPPDATA\tauri\NSIS")

$ErrorActionPreference = 'Stop'
$repoRoot = Split-Path $PSScriptRoot -Parent
$template = Get-Content -Raw (Join-Path $repoRoot 'src-tauri/windows/installer.nsi')
$start = $template.IndexOf('  nsis_tauri_utils::SemverCompare')
$end = $template.IndexOf('  ; Reinstalling the same version', $start)
if ($start -lt 0 -or $end -lt 0) { throw 'Installer policy block not found' }
$policy = $template.Substring($start, $end - $start).Replace('"${VERSION}" $R0', '"$1" $R0')
$outputDirectory = Join-Path $repoRoot 'installer-policy.local'
New-Item -ItemType Directory -Force -Path $outputDirectory | Out-Null
$header = @'
Unicode true
!include FileFunc.nsh
!include LogicLib.nsh
Name "Ayase installer policy test"
OutFile "policy.exe"
RequestExecutionLevel user
SilentInstall silent
Var WixMode
Function .onInit
  ${GetParameters} $0
  ${GetOptions} $0 "/Old=" $R0
  ${GetOptions} $0 "/New=" $1
  ${GetOptions} $0 "/Wix=" $WixMode
  ; In .onInit, Abort exits with the current code. No files or registry writes.
  SetErrorLevel 42
  Call Policy
  SetErrorLevel 0
  Quit
FunctionEnd
Section
SectionEnd
Function Policy
'@
$header = $header.Replace('Unicode true', "Unicode true`n!addplugindir `"$NsisDirectory\Plugins\x86-unicode\additional`"")
$source = $header + "`n" + $policy + "`nFunctionEnd`n"
Set-Content -LiteralPath (Join-Path $outputDirectory 'policy.nsi') -Value $source -Encoding utf8
Push-Location $outputDirectory
try {
  & (Join-Path $NsisDirectory 'makensis.exe') /V2 "policy.nsi"
  if ($LASTEXITCODE -ne 0) { throw 'NSIS policy harness compilation failed' }
  $cases = @(
    @{ Name = 'Alpha to Beta upgrade'; Old = '0.1.0-alpha.3'; New = '0.1.0-beta.1'; Wix = 0; Code = 42 },
    @{ Name = 'Beta same-version reinstall'; Old = '0.1.0-beta.1'; New = '0.1.0-beta.1'; Wix = 0; Code = 42 },
    @{ Name = 'Beta to Alpha downgrade retains choices'; Old = '0.1.0-beta.1'; New = '0.1.0-alpha.3'; Wix = 0; Code = 0 },
    @{ Name = 'upgrade'; Old = '0.1.0-alpha.1'; New = '0.1.0-alpha.2'; Wix = 0; Code = 42 },
    @{ Name = 'same-version reinstall'; Old = '0.1.0-alpha.2'; New = '0.1.0-alpha.2'; Wix = 0; Code = 42 },
    @{ Name = 'numeric prerelease upgrade'; Old = '0.1.0-alpha.2'; New = '0.1.0-alpha.10'; Wix = 0; Code = 42 },
    @{ Name = 'downgrade retains choices'; Old = '0.1.0-alpha.2'; New = '0.1.0-alpha.1'; Wix = 0; Code = 0 },
    @{ Name = 'WiX upgrade retains migration'; Old = '0.1.0-alpha.1'; New = '0.1.0-alpha.2'; Wix = 1; Code = 0 },
    @{ Name = 'WiX same-version retains migration'; Old = '0.1.0-alpha.2'; New = '0.1.0-alpha.2'; Wix = 1; Code = 0 }
  )
  foreach ($case in $cases) {
    $process = Start-Process -FilePath (Join-Path $outputDirectory 'policy.exe') -ArgumentList "/Old=$($case.Old)", "/New=$($case.New)", "/Wix=$($case.Wix)" -WindowStyle Hidden -PassThru -Wait
    if ($process.ExitCode -ne $case.Code) { throw "$($case.Name): expected $($case.Code), got $($process.ExitCode)" }
    Write-Output "PASS: $($case.Name)"
  }
} finally {
  Pop-Location
}

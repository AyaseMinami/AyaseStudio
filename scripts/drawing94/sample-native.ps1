param([int]$Seconds = 900)
$ErrorActionPreference = 'Stop'
$repoRoot = (Resolve-Path (Join-Path $PSScriptRoot '../..')).Path
$expectedExecutable = Join-Path $repoRoot 'src-tauri/target/debug/ayase-studio.exe'
$output = Join-Path $repoRoot '.drawing94.local/native-memory.jsonl'
$started = Get-Date
$stop = $started.AddSeconds($Seconds)
while ((Get-Date) -lt $stop) {
  $processRows = @(Get-CimInstance Win32_Process -Filter "Name='ayase-studio.exe' OR Name='msedgewebview2.exe'")
  $root = $processRows | Where-Object { $_.ExecutablePath -eq $expectedExecutable -and $_.CreationDate -ge $started } | Select-Object -First 1
  if ($root) {
    $ids = [System.Collections.Generic.HashSet[int]]::new(); [void]$ids.Add([int]$root.ProcessId)
    do { $changed = $false; foreach ($row in $processRows) { if ($ids.Contains([int]$row.ParentProcessId) -and $ids.Add([int]$row.ProcessId)) { $changed = $true } } } while ($changed)
    $samples = @($ids | ForEach-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue } | Select-Object Id,ProcessName,WorkingSet64,PrivateMemorySize64)
    $sample = @{ utc = [DateTime]::UtcNow.ToString('o'); root = $root.ProcessId; workingSetBytes = ($samples | Measure-Object WorkingSet64 -Sum).Sum; privateBytes = ($samples | Measure-Object PrivateMemorySize64 -Sum).Sum; processes = $samples }
    $sample | ConvertTo-Json -Depth 4 -Compress | Add-Content -LiteralPath $output -Encoding utf8
  }
  Start-Sleep -Seconds 1
}

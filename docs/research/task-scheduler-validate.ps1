<#
Throwaway validation script (NOT product code) for the Task Scheduler service design in the
"Windows background-service model" wayfinder ticket. Works on Windows PowerShell 5.1 and pwsh 7.

Checks, as a NON-ELEVATED user:
  1. schtasks /create /xml into a custom task folder works without admin.
  2. conhost.exe --headless launches cmd+node with no visible console window
     (compared against a control task that launches the same command visibly).
  3. Paths with spaces and non-ASCII characters survive (working directory, shim path, log path).
  4. schtasks /end terminates the whole process tree (cmd + node).
  5. RestartOnFailure restarts after a non-zero exit (and not after exit 0).
  6. The task folder can be enumerated and its XML read back.

Findings on Windows 11 build 26200 (non-elevated, 2026-10-01), see the wayfinder ticket for detail:
  - Headless launch works only in the relative-shim form used below (WorkingDirectory = shim folder).
    The nested  cmd /c ""<path with space>\shim.cmd" ..""  form fails under conhost --headless.
  - schtasks /end kills only the task's root process; node.exe (and cmd.exe) survive as orphans.
    Use  taskkill /PID <pid> /T /F  on the PID in .syncthis.lock.
  - conhost --headless swallows the child's exit code (LastTaskResult 0), and RestartOnFailure never
    restarted even a plain cmd.exe task that ended with exit code 1. Do not rely on it.
  - To judge "no visible window" watch the screen while the visible control task runs.

Usage:  powershell -NoProfile -ExecutionPolicy Bypass -File task-scheduler-validate.ps1
Needs node on PATH. Creates tasks under \SyncThisValidate\ and removes everything afterwards.
Takes about 2 minutes (it waits for the 1-minute restart interval).
Results are printed and written to %TEMP%\syncthis-task-validation.json - send that file back.
#>
param(
  [string]$Node = (Get-Command node -ErrorAction Stop).Source,
  [int]$RestartWaitSeconds = 100
)
$ErrorActionPreference = 'Stop'
$folder = '\SyncThisValidate'
$results = [ordered]@{}
$os = Get-CimInstance Win32_OperatingSystem
$results.os = "$($os.Caption) build $($os.BuildNumber)"
$results.powershell = $PSVersionTable.PSVersion.ToString()
$results.elevated = ([Security.Principal.WindowsPrincipal][Security.Principal.WindowsIdentity]::GetCurrent()).IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)
$results.node = (& $Node -v)

$root = Join-Path $env:TEMP ('SyncThisTaskTest-' + [guid]::NewGuid().ToString('N').Substring(0, 8))
$userDir = Join-Path $root ('Zo' + [char]0x00EB + ' Smith\My Notes')
$binDir = Join-Path $root 'bin dir'
New-Item -ItemType Directory -Force $userDir, $binDir | Out-Null

# worker: logs start, then runs / exits depending on mode
$worker = Join-Path $binDir 'worker.js'
@'
const fs = require('fs'), path = require('path');
const mode = process.argv[2] || 'run';
const pi = process.argv.indexOf('--path');
const dir = pi >= 0 ? process.argv[pi + 1] : process.cwd();
fs.appendFileSync(path.join(dir, 'worker.log'),
  'start pid=' + process.pid + ' mode=' + mode + ' path=' + dir + '\n', 'utf8');
if (mode === 'exit1') setTimeout(() => process.exit(1), 2000);
else if (mode === 'exit0') setTimeout(() => process.exit(0), 2000);
else setInterval(() => {}, 1000);
'@ | Set-Content -Path $worker -Encoding UTF8
$shim = Join-Path $binDir 'syncthis-test.cmd'
"@echo off`r`n`"$Node`" `"$worker`" %*`r`n" | Set-Content -Path $shim -Encoding ASCII

function Esc([string]$s) { [System.Security.SecurityElement]::Escape($s) }
function New-TaskXml([string]$exe, [string]$arguments, [string]$workDir) {
  $user = [Security.Principal.WindowsIdentity]::GetCurrent().Name
  @"
<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <RegistrationInfo><Description>syncthis validation (safe to delete)</Description></RegistrationInfo>
  <Principals><Principal id="Author"><UserId>$(Esc $user)</UserId><LogonType>InteractiveToken</LogonType><RunLevel>LeastPrivilege</RunLevel></Principal></Principals>
  <Settings>
    <MultipleInstancesPolicy>IgnoreNew</MultipleInstancesPolicy>
    <DisallowStartIfOnBatteries>false</DisallowStartIfOnBatteries>
    <StopIfGoingOnBatteries>false</StopIfGoingOnBatteries>
    <ExecutionTimeLimit>PT0S</ExecutionTimeLimit>
    <RestartOnFailure><Interval>PT1M</Interval><Count>3</Count></RestartOnFailure>
    <Enabled>true</Enabled>
  </Settings>
  <Actions Context="Author"><Exec><Command>$(Esc $exe)</Command><Arguments>$(Esc $arguments)</Arguments><WorkingDirectory>$(Esc $workDir)</WorkingDirectory></Exec></Actions>
</Task>
"@
}

function Register-Test([string]$name, [string]$mode, [bool]$headless) {
  $work = Join-Path $userDir $name
  New-Item -ItemType Directory -Force $work | Out-Null
  $log = Join-Path $work 'task-out.log'
  # Form validated on Win11: the shim is called by RELATIVE name with WorkingDirectory = the shim's
  # folder. The nested  cmd /c ""<path with space>\shim.cmd" ..""  form FAILS under conhost --headless
  # when the shim path contains a space (e.g. C:\Users\Jane Doe\...).
  $inner = 'syncthis-test.cmd ' + $mode + ' --path "' + $work + '" >> "' + $log + '" 2>&1'
  if ($headless) { $exe = 'conhost.exe'; $arguments = '--headless cmd.exe /d /c ' + $inner }
  else { $exe = 'cmd.exe'; $arguments = '/d /c ' + $inner }
  $xmlPath = Join-Path $root ($name + '.xml')
  New-TaskXml $exe $arguments $binDir | Set-Content -Path $xmlPath -Encoding Unicode
  $out = & schtasks /create /tn "$folder\$name" /xml $xmlPath /f 2>&1
  [pscustomobject]@{ name = $name; work = $work; exit = $LASTEXITCODE; out = ($out -join ' ') }
}

function Read-WorkerLog([string]$work) {
  $p = Join-Path $work 'worker.log'
  # [string] cast strips the PSPath/PSDrive note properties that PS 5.1 would otherwise serialise into the JSON
  if (Test-Path -LiteralPath $p) { @(Get-Content -LiteralPath $p -Encoding UTF8 | ForEach-Object { [string]$_ }) } else { @() }
}
function Wait-Until([scriptblock]$cond, [int]$seconds) {
  $end = (Get-Date).AddSeconds($seconds)
  while ((Get-Date) -lt $end) { if (& $cond) { return $true }; Start-Sleep -Milliseconds 500 }
  return $false
}
function Window-Snapshot {
  # processes that own a visible top-level window (console windows are owned by conhost/WindowsTerminal/cmd)
  @(Get-Process | Where-Object { $_.MainWindowHandle -ne 0 } | ForEach-Object { '{0}:{1}' -f $_.Id, $_.ProcessName })
}
function Tree-Info([string]$markerPath) {
  # processes whose command line mentions our temp root, plus their window handles
  $procs = Get-CimInstance Win32_Process | Where-Object { $_.CommandLine -and $_.CommandLine -like "*$markerPath*" }
  $info = @()
  foreach ($p in $procs) {
    $gp = Get-Process -Id $p.ProcessId -ErrorAction SilentlyContinue
    $info += [pscustomobject]@{ pid = $p.ProcessId; name = $p.Name; hwnd = $(if ($gp) { [int64]$gp.MainWindowHandle } else { -1 }) }
  }
  $info
}

try {
  # --- 1/6: registration without admin, readback, enumeration
  $reg = @()
  $reg += Register-Test 'run' 'run' $true
  $reg += Register-Test 'visible' 'run' $false
  $reg += Register-Test 'exit1' 'exit1' $true
  $reg += Register-Test 'exit0' 'exit0' $true
  $results.register = @($reg | ForEach-Object { [ordered]@{ task = $_.name; exitCode = $_.exit; output = $_.out } })

  $xml = & schtasks /query /tn "$folder\run" /xml 2>&1
  $results.xmlReadback = [ordered]@{ exitCode = $LASTEXITCODE; containsWorkingDir = (($xml -join "`n") -like '*My Notes*'); containsHeadless = (($xml -join "`n") -like '*--headless*') }
  $enum = & schtasks /query /tn "$folder\" /fo csv /nh 2>&1
  $results.enumerateFolderForm1 = [ordered]@{ exitCode = $LASTEXITCODE; lines = @($enum) }
  $enum2 = & schtasks /query /fo csv /nh 2>&1 | Where-Object { $_ -like '*SyncThisValidate*' }
  $results.enumerateViaFullQuery = @($enum2)

  # --- 2,3,4/6: headless vs visible, quoting, tree kill
  $before = Window-Snapshot
  & schtasks /run /tn "$folder\run" | Out-Null
  $okRun = Wait-Until { (Read-WorkerLog (Join-Path $userDir 'run')).Count -ge 1 } 15
  Start-Sleep -Seconds 2
  $afterHeadless = Window-Snapshot
  $runTree = @(Tree-Info (Join-Path $userDir 'run'))
  $runLog = Read-WorkerLog (Join-Path $userDir 'run')
  $newHeadless = @($afterHeadless | Where-Object { $before -notcontains $_ })
  & schtasks /run /tn "$folder\visible" | Out-Null
  $okVis = Wait-Until { (Read-WorkerLog (Join-Path $userDir 'visible')).Count -ge 1 } 15
  Start-Sleep -Seconds 2
  $afterVisible = Window-Snapshot
  $visTree = @(Tree-Info (Join-Path $userDir 'visible'))
  $newVisible = @($afterVisible | Where-Object { $afterHeadless -notcontains $_ })
  $results.headless = [ordered]@{
    started = $okRun
    workerLog = $runLog
    pathWithSpaceAndUnicodeSurvived = (($runLog -join "`n") -like ('*path=' + (Join-Path $userDir 'run') + '*'))
    processes = $runTree
    newVisibleWindowOwners = $newHeadless
  }
  $results.visibleControl = [ordered]@{
    started = $okVis
    processes = $visTree
    newVisibleWindowOwners = $newVisible
    note = 'If this is empty, the snapshot method cannot tell visible from hidden here: check by eye whether a console window flashed.'
  }

  $pidsBefore = @($runTree | ForEach-Object { $_.pid }) + @($visTree | ForEach-Object { $_.pid })
  & schtasks /end /tn "$folder\run" | Out-Null
  & schtasks /end /tn "$folder\visible" | Out-Null
  Start-Sleep -Seconds 3
  $alive = @($pidsBefore | Where-Object { Get-Process -Id $_ -ErrorAction SilentlyContinue })
  $results.endKillsTree = [ordered]@{ pidsBefore = $pidsBefore; stillAlive = $alive; killedWholeTree = ($alive.Count -eq 0) }

  # --- 5/6: restart on failure vs clean exit
  & schtasks /run /tn "$folder\exit1" | Out-Null
  & schtasks /run /tn "$folder\exit0" | Out-Null
  $restarted = Wait-Until { (Read-WorkerLog (Join-Path $userDir 'exit1')).Count -ge 2 } $RestartWaitSeconds
  $results.restart = [ordered]@{
    exit1Starts = (Read-WorkerLog (Join-Path $userDir 'exit1')).Count
    exit1RestartedWithin = "$RestartWaitSeconds s: $restarted"
    exit0Starts = (Read-WorkerLog (Join-Path $userDir 'exit0')).Count
    exit0StayedStopped = ((Read-WorkerLog (Join-Path $userDir 'exit0')).Count -eq 1)
  }
}
finally {
  foreach ($n in 'run', 'visible', 'exit1', 'exit0') {
    & schtasks /end /tn "$folder\$n" 2>&1 | Out-Null
    & schtasks /delete /tn "$folder\$n" /f 2>&1 | Out-Null
  }
  Start-Sleep -Seconds 1
  Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
  $left = & schtasks /query /fo csv /nh 2>&1 | Where-Object { $_ -like '*SyncThisValidate*' }
  $results.cleanupLeftoverTasks = @($left)
  $out = Join-Path $env:TEMP 'syncthis-task-validation.json'
  $results | ConvertTo-Json -Depth 6 | Set-Content -Path $out -Encoding UTF8
  $results | ConvertTo-Json -Depth 6
  Write-Host "`nResults written to $out"
}

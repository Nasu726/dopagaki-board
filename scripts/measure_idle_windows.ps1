param(
    [Parameter(Mandatory = $true)]
    [int]$RootPid,

    [double]$SettleSeconds = 60,
    [double]$DurationSeconds = 300,
    [double]$IntervalSeconds = 1,
    [string]$CsvPath = ""
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

if ($RootPid -le 0) {
    throw "RootPid must be positive"
}
if ($SettleSeconds -lt 0) {
    throw "SettleSeconds must be >= 0"
}
if ($DurationSeconds -le 0) {
    throw "DurationSeconds must be > 0"
}
if ($IntervalSeconds -le 0) {
    throw "IntervalSeconds must be > 0"
}

$MiB = 1024 * 1024
$StopwatchFrequency = [double][System.Diagnostics.Stopwatch]::Frequency

function Get-ProcessTreeSnapshot {
    param([int]$RootProcessId)

    $processTable = @(Get-CimInstance Win32_Process | Select-Object ProcessId, ParentProcessId, Name)
    if (-not ($processTable | Where-Object { [int]$_.ProcessId -eq $RootProcessId })) {
        throw "root PID $RootProcessId is not running"
    }

    $children = @{}
    foreach ($entry in $processTable) {
        $parentId = [int]$entry.ParentProcessId
        if (-not $children.ContainsKey($parentId)) {
            $children[$parentId] = [System.Collections.Generic.List[int]]::new()
        }
        $children[$parentId].Add([int]$entry.ProcessId)
    }

    $namesByPid = @{}
    foreach ($entry in $processTable) {
        $namesByPid[[int]$entry.ProcessId] = [string]$entry.Name
    }

    $stack = [System.Collections.Generic.Stack[int]]::new()
    $stack.Push($RootProcessId)
    $seen = [System.Collections.Generic.HashSet[int]]::new()
    $selected = [System.Collections.Generic.List[object]]::new()

    while ($stack.Count -gt 0) {
        $processId = $stack.Pop()
        if (-not $seen.Add($processId)) {
            continue
        }

        $process = Get-Process -Id $processId -ErrorAction SilentlyContinue
        if ($null -ne $process) {
            $selected.Add([pscustomobject]@{
                Pid = $processId
                Name = if ($namesByPid.ContainsKey($processId)) { $namesByPid[$processId] } else { $process.ProcessName }
                CpuSeconds = [double]$process.TotalProcessorTime.TotalSeconds
                WorkingSetBytes = [long]$process.WorkingSet64
            })
        }

        if ($children.ContainsKey($processId)) {
            foreach ($childId in $children[$processId]) {
                $stack.Push($childId)
            }
        }
    }

    if (-not ($selected | Where-Object { $_.Pid -eq $RootProcessId })) {
        throw "root PID $RootProcessId exited while sampling"
    }
    return $selected
}

function Get-TreeSample {
    param([int]$RootProcessId)

    $processes = @(Get-ProcessTreeSnapshot -RootProcessId $RootProcessId)
    $cpuByPid = @{}
    [long]$workingSetBytes = 0
    $names = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)

    foreach ($process in $processes) {
        $cpuByPid[[int]$process.Pid] = [double]$process.CpuSeconds
        $workingSetBytes += [long]$process.WorkingSetBytes
        [void]$names.Add([string]$process.Name)
    }

    return [pscustomobject]@{
        Timestamp = [double][System.Diagnostics.Stopwatch]::GetTimestamp() / $StopwatchFrequency
        ProcessCount = $processes.Count
        CpuByPid = $cpuByPid
        WorkingSetBytes = $workingSetBytes
        Names = @($names | Sort-Object)
    }
}

function Get-CpuPercent {
    param($Previous, $Current)

    $elapsed = [double]$Current.Timestamp - [double]$Previous.Timestamp
    if ($elapsed -le 0) {
        return 0.0
    }

    [double]$deltaCpuSeconds = 0
    foreach ($entry in $Current.CpuByPid.GetEnumerator()) {
        $processId = [int]$entry.Key
        $currentCpu = [double]$entry.Value
        if ($Previous.CpuByPid.ContainsKey($processId)) {
            $previousCpu = [double]$Previous.CpuByPid[$processId]
            if ($currentCpu -ge $previousCpu) {
                $deltaCpuSeconds += $currentCpu - $previousCpu
            }
        } else {
            # Match the Linux helper: count lifetime CPU for a newly observed
            # child rather than silently ignoring work that started mid-sample.
            $deltaCpuSeconds += $currentCpu
        }
    }

    # One fully occupied logical CPU is 100%; a multi-process tree may exceed 100%.
    return ($deltaCpuSeconds / $elapsed) * 100.0
}

function Get-Mean {
    param([double[]]$Values)
    if ($Values.Count -eq 0) {
        return [double]::NaN
    }
    return ($Values | Measure-Object -Average).Average
}

function Get-Median {
    param([double[]]$Values)
    if ($Values.Count -eq 0) {
        return [double]::NaN
    }
    $sorted = @($Values | Sort-Object)
    $middle = [int][math]::Floor($sorted.Count / 2)
    if (($sorted.Count % 2) -eq 1) {
        return [double]$sorted[$middle]
    }
    return ([double]$sorted[$middle - 1] + [double]$sorted[$middle]) / 2.0
}

Write-Host ("settling for {0:N1}s; keep dopagaki-board in Idle and do not interact" -f $SettleSeconds)
if ($SettleSeconds -gt 0) {
    Start-Sleep -Milliseconds ([int][math]::Ceiling($SettleSeconds * 1000))
}

$previous = Get-TreeSample -RootProcessId $RootPid
$startTimestamp = [double]$previous.Timestamp
$rows = [System.Collections.Generic.List[object]]::new()
$namesSeen = [System.Collections.Generic.HashSet[string]]::new([System.StringComparer]::OrdinalIgnoreCase)
foreach ($name in $previous.Names) {
    [void]$namesSeen.Add($name)
}

$deadline = $startTimestamp + $DurationSeconds
while ($true) {
    $now = [double][System.Diagnostics.Stopwatch]::GetTimestamp() / $StopwatchFrequency
    $remaining = $deadline - $now
    if ($remaining -le 0) {
        break
    }

    $sleepSeconds = [math]::Min($IntervalSeconds, $remaining)
    Start-Sleep -Milliseconds ([int][math]::Max(1, [math]::Ceiling($sleepSeconds * 1000)))

    $current = Get-TreeSample -RootProcessId $RootPid
    foreach ($name in $current.Names) {
        [void]$namesSeen.Add($name)
    }

    $rows.Add([pscustomobject]@{
        elapsed_s = [math]::Round(([double]$current.Timestamp - $startTimestamp), 3)
        process_count = [int]$current.ProcessCount
        cpu_percent = Get-CpuPercent -Previous $previous -Current $current
        working_set_mib = [double]$current.WorkingSetBytes / $MiB
    })
    $previous = $current

    if ([double]$current.Timestamp -ge $deadline) {
        break
    }
}

if ($rows.Count -eq 0) {
    throw "no samples collected"
}

if ($CsvPath) {
    $fullCsvPath = [System.IO.Path]::GetFullPath($CsvPath)
    $parent = Split-Path -Parent $fullCsvPath
    if ($parent) {
        [System.IO.Directory]::CreateDirectory($parent) | Out-Null
    }
    $rows | Export-Csv -Path $fullCsvPath -NoTypeInformation -Encoding UTF8
}

$cpu = [double[]]@($rows | ForEach-Object { [double]$_.cpu_percent })
$workingSet = [double[]]@($rows | ForEach-Object { [double]$_.working_set_mib })
$processCounts = [int[]]@($rows | ForEach-Object { [int]$_.process_count })

Write-Host ""
Write-Host "Idle process-tree summary"
Write-Host ("samples: {0}" -f $rows.Count)
Write-Host ("observed processes: {0}..{1}" -f (($processCounts | Measure-Object -Minimum).Minimum), (($processCounts | Measure-Object -Maximum).Maximum))
Write-Host ("process names: {0}" -f ((@($namesSeen | Sort-Object)) -join ", "))
Write-Host ("CPU mean: {0:N3}%" -f (Get-Mean -Values $cpu))
Write-Host ("CPU max: {0:N3}%" -f (($cpu | Measure-Object -Maximum).Maximum))
Write-Host ("Working set mean: {0:N2} MiB" -f (Get-Mean -Values $workingSet))
Write-Host ("Working set median: {0:N2} MiB" -f (Get-Median -Values $workingSet))
Write-Host ("Working set max: {0:N2} MiB" -f (($workingSet | Measure-Object -Maximum).Maximum))
if ($CsvPath) {
    Write-Host ("raw CSV: {0}" -f ([System.IO.Path]::GetFullPath($CsvPath)))
}
Write-Host "note: very short-lived descendants can start and exit between samples; use a shorter IntervalSeconds if process churn is visible"
Write-Host "note: this helper does not attribute network traffic; verify app-attributable idle network separately with Resource Monitor or an equivalent tool"

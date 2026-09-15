# Performance baseline

This file records reproducible performance observations for the permanently resident app. Do not optimize from intuition alone; update this document whenever a meaningful architectural change affects startup, idle behavior, memory, or responsiveness.

Performance budgets, priorities, and regression-response policy are owned by `PERFORMANCE.md`. This file owns measurement definitions, procedures, conditions, and observed results; use the same definitions across runs so comparisons remain meaningful.

## First real Windows observation — 2026-09-14

The first external release-build Windows use was completed after the functional MVP checkpoint. It is the first real machine observation and replaces the previous `measurement pending` status, but it was reported as a practical-use check rather than a scripted 60 s settle + 300 s sampled benchmark. Preserve that distinction rather than inventing precision that was not recorded.

Reported observations:

| Metric | Result | Notes |
| --- | --- | --- |
| cached startup / usability | immediately usable | qualitative; no millisecond timing captured |
| Idle memory | about **109 MB**, stable | Windows practical observation |
| Idle CPU | **0%** displayed | no sustained background work observed |
| Idle disk | **0 MB/s** displayed | no background disk churn observed |
| Idle network | **0 Mbps** displayed | no idle traffic observed |
| Board with five widgets | app process about **5.3 MB**, WebView2 Manager about **120.0 MB** | separate observation from the 109 MB Idle reading; do not sum or treat as the same sample |
| state transitions | responsive / one-click | no visible transition stall |
| widget drag/resize | no visible stutter | real interaction feedback |

The memory observations are within the initial `<= 150 MiB` resident budget at the level visible in Task Manager. CPU/network behavior also matches the intended idle behavior. Because the user did not record an exact sampling duration, process-tree definition, Windows version, or hardware in that report, do not treat these values as a laboratory-quality regression series. They are strong evidence that the architecture is in the correct range and that product correctness/UX should currently take priority over speculative optimization.

The pre-adapter numeric baseline was never captured. Do not reconstruct one from CI, code inspection, or estimates.

## Canonical Linux idle measurement

Use a **release build**, not `tauri dev`. Dev servers, debug builds, hot reload, and development logging are not representative resident costs.

```bash
npm ci
npm run tauri build

./src-tauri/target/release/dopagaki-board &
APP_PID=$!

python3 scripts/measure_idle_linux.py \
  --pid "$APP_PID" \
  --settle 60 \
  --duration 300 \
  --interval 1 \
  --csv /tmp/dopagaki-idle.csv
```

During the settle and sample windows:

- leave the app in **Idle**
- do not interact with it
- do not intentionally trigger shortcut transitions
- ensure no refresh/preload work is due
- for the cleanest current baseline, use a profile with no supported source widget scheduled, or set automatic refresh OFF and wait until no manual/background request is running
- avoid compiling or running unrelated heavy jobs if the run is intended for comparison

The helper uses only Python's standard library and `/proc`. It recursively follows the root process's descendants so WebKit subprocesses are not omitted.

### CPU semantics

CPU follows the usual Unix process convention: one fully occupied logical CPU is `100%`. A multi-process tree can exceed `100%`. The reported mean is computed from process CPU-time deltas over the sampling window, not from one instantaneous `top` snapshot.

### RSS and PSS

The helper reports:

- **RSS sum**: sum of resident memory across the process tree. This is intentionally conservative and can double-count shared pages. Use this value for the repository's current `<= 150 MiB` RSS budget so comparisons remain consistent.
- **PSS sum**: when every sampled process exposes `/proc/<pid>/smaps_rollup`, proportional set size is also reported. PSS is a useful shared-memory-aware companion metric for WebKit's multi-process model, but do not silently substitute it for an RSS result.

### Short-lived subprocess limitation

A subprocess that starts and exits entirely between two `/proc` samples can be missed. If process churn is visible or suspected, repeat with a shorter interval such as `--interval 0.25`. Do not increase sampling frequency permanently unless the extra precision is needed.

## Canonical Windows idle measurement

Use the release executable and the repository PowerShell helper. The helper uses only built-in PowerShell/.NET and Windows process information; it is a development measurement tool, not part of the resident app.

```powershell
npm ci
npm run tauri build

$app = Start-Process .\src-tauri\target\release\dopagaki-board.exe -PassThru
.\scripts\measure_idle_windows.ps1 `
  -RootPid $app.Id `
  -SettleSeconds 60 `
  -DurationSeconds 300 `
  -IntervalSeconds 1 `
  -CsvPath "$env:TEMP\dopagaki-idle.csv"
```

During the settle and sample windows, use the same idle conditions as the Linux run: keep the app in Idle, do not interact, and ensure no source refresh is due or running.

The helper recursively follows `Win32_Process` parent IDs from the Tauri root process so WebView2/helper descendants are included when they remain in that process tree. It reports:

- **CPU percent** from summed `TotalProcessorTime` deltas. One fully occupied logical CPU is `100%`, matching the Linux helper's convention; a multi-process tree can exceed `100%`.
- **Working-set sum** from `WorkingSet64` for the sampled process tree. Treat this as the Windows measurement series; it is not PSS and should not be silently substituted for the Linux RSS/PSS series.

A process that starts and exits entirely between two samples can be missed. If process churn is visible, repeat with a shorter `-IntervalSeconds` value. Do not shorten the interval permanently without a measurement reason.

## Network-idle verification

Neither resident measurement helper claims app-attributable network bytes. Verify app-attributable traffic separately with an OS tool that can attribute network activity to processes: for example `nethogs` on Linux when already installed, or Resource Monitor on Windows. Record the tool and observation. Do not add a permanent runtime dependency merely to measure this.

A valid "truly idle" network run must have no due refresh. Network activity caused by an intentionally due refresh is background-work cost, not an idle-network regression.

## Interaction-under-refresh check

Resident metrics alone are insufficient because the scheduler/runtime is specifically designed not to interfere with foreground work.

For a controlled release-build check:

1. open Board with an arXiv widget
2. trigger a manual refresh
3. while the request is running, drag and resize another widget repeatedly
4. exercise the global shortcut / Board -> Idle transition
5. record whether pointer interaction or state transitions visibly stall

This is initially a qualitative check. Add timing instrumentation only if real use suggests a regression; do not introduce a permanent benchmark framework pre-emptively.

## Conditions to record with every canonical baseline

```text
commit:
build: release
OS / version:
kernel:
desktop environment:
session: X11 / Wayland / other
display scaling:
CPU:
RAM:
settle seconds:
sample seconds:
sample interval:
auto refresh setting:
active supported source widgets:
network measurement tool:
notes:
```

On Windows, fields such as kernel/desktop environment/session can be recorded as `n/a` where they do not describe the platform meaningfully; record the Windows version/build instead.

Do not compare numbers collected under materially different build modes, active refresh state, process-tree definitions, or measurement definitions as if they were one regression series.

## macOS canonical runs

Use the same conceptual rules even though the Linux/Windows helpers do not apply directly:

- release build only
- 60 s settle, then 5 min sustained Idle sampling
- include attributable WebView/helper processes, not only the Rust parent
- record both average CPU and memory footprint, not one screenshot
- record OS/build/session conditions
- verify idle network separately
- ensure no source refresh is due/running during the idle sample

Use Activity Monitor or an equivalent tool. If macOS is later automated, preserve the same metric definitions rather than inventing an incompatible series.

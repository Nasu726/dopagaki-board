# Performance baseline

This file records reproducible performance observations for the permanently resident app. Do not optimize from intuition alone; update this document whenever a meaningful architectural change affects startup, idle behavior, memory, or responsiveness.

## Target budget

Initial targets are documented in `PERFORMANCE.md`. The most important product rule is simpler: when nothing useful is due, the app should do essentially nothing.

Current engineering budgets:

- idle CPU average: target `<= 0.1%`; sustained `>= 0.5%` requires investigation
- summed app-process RSS: target `<= 150 MiB`; stretch target `<= 100 MiB`
- network while truly idle: `0 B/s`
- cached startup to usable UI: target around `<= 500 ms`; persistent `> 1 s` requires investigation
- background work must not visibly stall drag, resize, scroll, shortcut handling, or clicks

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

## Network-idle verification

`scripts/measure_idle_linux.py` deliberately does **not** report per-process network bytes. `/proc/<pid>/net/dev` describes the process's network namespace rather than traffic attributable to that PID; treating it as per-process traffic would produce false measurements.

Verify app-attributable traffic separately with an OS tool that can attribute network activity to processes (for example `nethogs` if already installed) or a suitable system monitor. Record the tool and observation. Do not add a permanent runtime dependency merely to measure this.

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

Do not compare numbers collected under materially different build modes, active refresh state, or measurement definitions as if they were one regression series.

## Windows and macOS canonical runs

The same conceptual rules apply even when the Linux helper cannot be used:

- release build only
- 60 s settle, then 5 min sustained Idle sampling
- include attributable WebView/helper processes, not only the Rust parent
- record both average CPU and memory footprint, not one screenshot
- record OS/build/session conditions
- verify idle network separately
- ensure no source refresh is due/running during the idle sample

Use Task Manager / Resource Monitor or equivalent tooling on Windows and Activity Monitor or equivalent tooling on macOS. If these platforms are later automated, preserve the same metric definitions rather than inventing incompatible ones.

## Regression rule

If a new feature materially increases permanent idle cost, first try deletion, deferral, lazy loading, event-driven work, or dependency removal. A feature being useful is not by itself sufficient justification for making a resident app heavy.

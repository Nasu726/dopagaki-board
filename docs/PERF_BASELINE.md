# Performance baseline

This file records reproducible performance observations for the permanently resident app. Do not optimize from intuition alone; update this document whenever a meaningful architectural change affects startup, idle behavior, memory, or responsiveness.

## Target budget

Initial targets are documented in `PERFORMANCE.md`. The most important product rule is simpler: when nothing useful is due, the app should do essentially nothing.

For the current pre-adapter build, the key initial budgets are:

- idle CPU average: target `<= 0.1%`; sustained `>= 0.5%` requires investigation
- summed app-process RSS: target `<= 150 MiB`; stretch target `<= 100 MiB`
- network while truly idle: `0 B/s`
- cached startup to usable UI: target around `<= 500 ms`; persistent `> 1 s` requires investigation
- background work must not visibly stall drag, resize, scroll, shortcut handling, or clicks

These are engineering budgets, not claims that measurements already meet them.

## Current baseline

Status: **real desktop measurement pending**.

The current main branch has the Idle / Compact / Board shell, SQLite-backed Board layout, configurable Rust-owned global shortcut, and Rust-owned unseen badge state. External source adapters, refresh scheduling, and thumbnail preloading are not present yet. This is therefore the right point to capture a low-noise resident-cost baseline before background features arrive.

| Metric | Result | Conditions |
| --- | --- | --- |
| cached startup to usable UI | TBD | release build; no network dependency |
| idle CPU average | TBD | 5 min after 60 s settle; no interaction |
| idle CPU max/spikes | TBD | same run |
| summed process-tree RSS | TBD | same run; includes attributable WebKit children |
| process-tree PSS (Linux, if readable) | TBD | companion metric; shared-memory aware |
| network while idle | TBD | should be 0 B/s |
| Idle -> Compact latency | TBD | several repetitions, release build |

Do not fill these values from CI, dev mode, or an inferred estimate.

## Canonical Linux idle measurement

Use a **release build**, not `tauri dev`. Dev servers, debug builds, hot reload, and development logging are not representative resident costs.

```bash
npm install
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
- ensure no refresh/preload work is due (none exists in the current pre-adapter build)
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

For the baseline, verify app-attributable traffic separately with an OS tool that can attribute network activity to processes (for example `nethogs` if already installed) or a suitable system monitor. Record the tool and observation below. Do not add a permanent runtime dependency merely to measure this.

## Conditions to record with every baseline

Record enough context that later measurements can be compared meaningfully:

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
network measurement tool:
notes:
```

Useful Linux commands include `uname -a`, `echo "$XDG_SESSION_TYPE"`, `lscpu`, and `free -h`.

Do not compare numbers collected under materially different build modes or measurement definitions as if they were a regression series.

## Windows and macOS

The same conceptual rules apply even when the Linux helper cannot be used:

- release build only
- 60 s settle, then 5 min sustained Idle sampling
- include attributable WebView/helper processes, not only the Rust parent
- record both average CPU and memory footprint, not one screenshot
- record OS/build/session conditions
- verify idle network separately

Use Task Manager / Resource Monitor or equivalent tooling on Windows and Activity Monitor or equivalent tooling on macOS. If we later automate those platforms, preserve the same metric definitions rather than inventing incompatible ones.

## Regression rule

If a new feature materially increases permanent idle cost, first try deletion, deferral, lazy loading, event-driven work, or dependency removal. A feature being useful is not by itself sufficient justification for making a resident app heavy.

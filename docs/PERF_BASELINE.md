# Performance baseline

This file records reproducible performance observations for the permanently resident app. Do not optimize from intuition alone; update this document whenever a meaningful architectural change affects startup, idle behavior, memory, or responsiveness.

## Target budget

Initial targets are documented in `PERFORMANCE.md`. The most important product rule is simpler: when nothing useful is due, the app should do essentially nothing.

## Bootstrap baseline

Status: **measurement pending on a real desktop run**.

The bootstrap PR intentionally establishes the smallest measurable version before feed adapters, schedulers, thumbnail preloading, and the special Idle window exist.

Record at least:

| Metric | Result | Conditions |
| --- | --- | --- |
| cached startup to usable UI | TBD | no network dependency |
| idle CPU average | TBD | 5 min, no interaction |
| idle RSS / process footprint | TBD | after startup settles |
| Rust ↔ SQLite probe latency | TBD | local DB only |
| network while idle | TBD | should be 0 B/s |

## Measurement notes

### Windows

Use Task Manager / Resource Monitor for a first coarse pass. Record the total footprint of processes attributable to the app, not only one child process.

### macOS

Use Activity Monitor for CPU and memory. Record the app plus clearly attributable WebView processes when comparing versions.

### Linux

Use `ps`, `top`/`htop`, and `/usr/bin/time -v` as appropriate. For example, after identifying the process, sample CPU over a sustained idle window rather than trusting a single instant.

## Regression rule

If a new feature materially increases permanent idle cost, first try deletion, deferral, lazy loading, event-driven work, or dependency removal. A feature being useful is not by itself sufficient justification for making a resident app heavy.

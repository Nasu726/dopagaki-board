# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

Active PR: #12, `Free-placement Board with SQLite persistence`.
Branch: `feat/free-board-clean`.

Implemented on the branch:
- free placement, drag, resize, and delete
- click-empty-space widget creation
- source kinds: YouTube, arXiv, Wikipedia, NHK, Qiita, Zenn
- SQLite persistence
- schema v2: geometry, display mode, source config JSON, refresh config JSON
- v1 -> v2 migration preserving existing settings
- Rust-owned widget CRUD commands
- one SQLite write at drag/resize gesture end instead of per pointer move
- no grid framework and no frontend UI framework

PR #12 should close Issue #4 after a normal green CI run and merge.

## Next after PR #12

Issue #3 remains open for:
1. configurable global shortcut with persisted setting and explicit conflict handling
2. Rust-owned boolean unseen/update badge for Idle
3. Idle CPU/RSS measurement recorded in `docs/PERF_BASELINE.md`

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta tracking issue: #13.

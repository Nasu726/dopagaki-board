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

## CI incident on PR #12

A normal CI run reached Rust compilation and exposed `E0597` in `src-tauri/src/db/widgets.rs`. The direct `query_map(...).collect()` tail expression kept the mapped-row temporary alive long enough to conflict with the prepared statement lifetime. The fix is to bind the collected `Vec` to a local value and return that value after the iterator temporary drops. Fix commit: `c970d1a1a7d51f470f9051a1cfcdeeea25aa383e`.

The immediately following Actions run (`34749203272`) ended as `startup_failure` with zero jobs created. The workflow definition was still valid and the API refused rerun. Treat this specific result as an Actions startup/infrastructure failure, not as code verification. A later legitimate commit should trigger a fresh run; require a normal green run before merging #12.

The CI workflow checks frontend build, Rust formatting, Rust tests, and `cargo check`. A temporary branch-specific push trigger used during earlier GitHub API trouble has already been removed.

## Next after PR #12

Issue #3 remains open for:
1. configurable global shortcut with persisted setting and explicit conflict handling
2. Rust-owned boolean unseen/update badge for Idle
3. Idle CPU/RSS measurement recorded in `docs/PERF_BASELINE.md`

Do not silently register fallback shortcuts if the requested shortcut conflicts. Surface the failure and let the user choose another shortcut.

## Implementation knowledge

### Gesture persistence

Keep drag/resize presentation updates in the DOM during pointer movement, but persist geometry only once at gesture end. Avoid per-pointer-move SQLite writes.

### Ownership boundary

Durable product state and configuration belong in Rust/SQLite. The WebView should primarily own transient presentation and interaction state.

### Frontend weight

The current Board is small enough for Vanilla TypeScript. Do not add a UI framework, grid engine, or canvas dependency merely for drag/resize.

### Schema headroom

Schema v2 already includes `source_config_json` and `refresh_config_json`. Use these when source adapters and refresh configuration arrive unless a future requirement clearly justifies typed relational columns and another migration.

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta tracking issue: #13.

When reusable knowledge would otherwise exist only in chat, update the appropriate GitHub document in the same feature batch.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Inspect the open PR/Issues named above.
3. Verify current CI state before changing or merging an active branch.
4. Update this file when the true restart point changes.

# Active work checkpoint

Short-lived execution state. Durable product decisions belong in `DECISIONS.md`; technical invariants belong in the architecture/refresh docs; completed task history belongs in Issues/PRs.

Last updated: 2026-09-16

## Stable baseline on `main`

Current `main` includes:

- arXiv, Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS adapters
- cache-first startup and canonical source-instance deduplication
- global/source/widget automatic-refresh controls plus manual refresh
- responsive 12×8 Board geometry with 3×2 minimum widgets
- dedicated Board-level widget settings and explicit Select/Add modes
- native system-tray controls, taskbar-free resident behavior, and explicit Windows window-drag fallback
- ordinary YouTube `@handle` / channel-URL input without requiring a Data API key
- source-aware imagery: YouTube thumbnails, Wikipedia PageImages/local fallback, Zenn enclosure images, bounded Qiita OGP enrichment
- unseen-state tracking scoped to currently active Board sources
- shared HTTP failure classification with persisted per-source retry deadlines
- overlay-only Settings/Add-picker updates that do not rebuild the whole Board
- reproducible Linux and Windows resident-performance measurement helpers
- frontend build/lint/unit-test gates plus Linux/Windows/macOS release-build CI

The latest real-device fixes landed through #97, #98, and #99. The older draft PR #92 was superseded by #97 and is closed without merge.

## Current maintenance branch

`maintenance-cleanup-lightweight-refactor`

Goal: run the deliberate simplification step in the project performance loop before more feature work.

Current work:

1. remove one-off patch files/layers that have been absorbed into durable owners
2. reconcile roadmap/spec/architecture text with the post-#97/#99 implementation
3. review frontend and Rust module boundaries without splitting files merely for size
4. reduce avoidable permanent DOM observation/listener scope where safe
5. keep dependencies minimal; do not claim dependency/performance wins without actual removal/measurement
6. run the normal build/lint/test/release CI gates before merge

## Gate after this maintenance branch

Do not start broad feature expansion immediately after merge.

1. Run one consolidated Windows release-build interaction smoke for the still-open verification issues: #59, #60, #61, #62, #66, #79, #87, #88, #89, #90.
2. Close only checks that actually pass; file focused defects for failures rather than widening old umbrella issues.
3. Run the #63 post-batch resident measurement from `PERF_BASELINE.md`: Idle CPU/Working Set, attributable idle network, and qualitative interaction-under-refresh checks.
4. Fix any visible/measured regression.
5. Only then resume optional broad work such as #53.

## Known follow-up from structure/lightweight review

The Rust `app/`, `db/`, scheduler/runtime, and source-adapter boundaries are purposeful and should not be collapsed simply to reduce file count.

The frontend remains more centralized: `main.ts` still owns substantial Board/settings orchestration. Further extraction should be driven by a cohesive responsibility boundary and regression coverage, not a line-count target.

YouTube handle/URL setup works without Data API credentials, but #90 remains open because canonical one-time resolution / repeated channel-page work still deserves explicit verification or refinement before declaring the setup path complete.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices separate where practical, and do useful independent work rather than polling long CI runs continuously.

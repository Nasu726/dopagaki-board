# Active work checkpoint

Short-lived execution state. Durable product decisions belong in `DECISIONS.md`; technical invariants belong in the architecture/refresh docs; completed task history belongs in Issues/PRs.

Last updated: 2026-09-17

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
- #100 simplification pass: temporary CSS layers flattened, stale project docs/issues reconciled, broad resize-handle DOM observation narrowed, and legacy demo-cache cleanup moved from every startup to a one-time SQLite migration

The latest real-device fixes landed through #97, #98, and #99. The older draft PR #92 was superseded by #97 and is closed without merge. PR #100 is merged with all three OS CI lanes green.

## Current maintenance branch

`board-interaction-runtime-cleanup` / PR #101

Goal: finish the remaining narrow Board interaction/runtime cleanup without expanding the real-device validation surface.

Current work:

1. distinguish dormant YouTube setup state from a configured source that merely has zero cached items (#88)
2. render pointer-only resize semantics directly instead of mutating handles after render
3. remove the resize-handle `MutationObserver`
4. remove the document-wide YouTube empty-content click handler and keep the setup action inside Board state/orchestration
5. run the normal build/lint/test/release CI gates before merge

No dependency, scheduler, cache-identity, network cadence, or broad rendering change belongs in this slice.

## Gate after PR #101

Do not stack another broad code refactor before real-device validation.

1. Run one consolidated Windows release-build interaction smoke for the still-open verification issues: #59, #60, #61, #62, #66, #79, #87, #88, #89, #90.
2. Close only checks that actually pass; file focused defects for failures rather than widening old umbrella issues.
3. Run the #63 post-batch resident measurement from `PERF_BASELINE.md`: Idle CPU/Working Set, attributable idle network, and qualitative interaction-under-refresh checks.
4. Fix any visible/measured regression.
5. Only then resume optional broad work such as #53.

## Structure/lightweight review conclusion

The Rust `app/`, `db/`, scheduler/runtime, and source-adapter boundaries are purposeful and should not be collapsed simply to reduce file count.

The frontend remains more centralized: `main.ts` still owns substantial Board/global-settings orchestration. Further extraction should be driven by a cohesive responsibility boundary and regression coverage, not a line-count target. Do not start that extraction until the current Windows smoke/performance gate is complete.

YouTube handle/URL setup works without Data API credentials, but #90 remains open because canonical one-time resolution / repeated channel-page work still deserves explicit verification or refinement before declaring the setup path complete.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices separate where practical, and do useful independent work rather than polling long CI runs continuously.

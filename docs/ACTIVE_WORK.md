# Active work checkpoint

Short-lived execution state. Durable product decisions belong in `DECISIONS.md`; technical invariants belong in the architecture/refresh docs; completed task history belongs in Issues/PRs.

Last updated: 2026-09-15

## Stable baseline

Current `main` includes:

- arXiv, Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS adapters
- cache-first startup and canonical source-instance deduplication
- global/source/widget automatic-refresh controls plus manual refresh, including exact typed custom intervals
- responsive 12×8 Board geometry and size-aware feed presentation
- new-widget defaults aligned across TypeScript/Rust: arXiv/Wikipedia/Qiita/Zenn = 3 results, YouTube = 1
- dedicated Board-level widget settings with source-specific editor presentation extracted from `main.ts`
- explicit Select/Add Board modes; Select is the default and empty-space clicks are harmless outside Add
- restored native window dragging permission
- notification-area/system-tray controls and taskbar-free resident behavior
- shared HTTP failure classification with persisted per-source retry deadlines
- overlay-only Settings/Add-picker updates that do not rebuild or rehydrate the whole Board
- reproducible Linux and Windows resident-performance measurement helpers kept outside the runtime bundle
- frontend build/lint/unit-test gates plus Linux/Windows/macOS release-build CI

GUI/network behavior that cannot be established by CI remains subject to real-device smoke.

## Current gate before broad feature work

The post-source-expansion code/refactor/tooling batch is complete. Keep broad feature expansion behind this validation gate:

1. Run one consolidated Windows release-build interaction smoke covering #54/#59/#60/#61/#62/#66/#79. The execution order is recorded in #63.
2. Close only the focused verification issues whose checks pass; file focused defects for failures.
3. Run the #63 post-batch resident measurement from `docs/PERF_BASELINE.md`: Idle CPU/Working Set, attributable idle network, and qualitative interaction-under-refresh checks. Record only measured values and conditions.
4. Fix any visible/measured regression before starting broad expansion.
5. #53 — optional YouTube Data API enrichment can resume after this gate; RSS remains the no-key baseline.

## Windows smoke checklist owners

- #59 — Compact/Board window dragging without stealing widget interactions
- #60 — small/medium/large widget density, image/no-image width, scrolling, and visible 3/1 defaults
- #54 / #61 — dedicated settings surface, all source editors, YouTube dormant Cancel, exact refresh typing/slider/floors, Save/Cancel/Escape, narrow rehydrate
- #62 — Select default, harmless empty-space click, Add placement/Cancel/return-to-Select, widget actions inert in Add
- #66 — fully transparent Idle pixels, notification-area Open Compact/Open Board/Hide/Quit, shortcut/Idle transitions
- #79 — repeated Settings/Add-picker overlay cycles without duplicate actions or Board disturbance

Use #63 as the cross-cutting performance gate rather than creating another umbrella roadmap issue.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices in separate PRs where practical, and do useful independent work rather than polling long CI runs continuously.

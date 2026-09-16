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
- #101 final Board/runtime cleanup: dormant YouTube setup is configuration-driven, configured-but-empty state stays distinct, resize semantics are emitted directly, the resize `MutationObserver` and document-wide YouTube click listener are removed, shell runtime boot is explicit at `main.ts`, and the remaining exact-refresh patch stylesheet is folded into `settings.css`

The latest real-device fixes landed through #97, #98, and #99. The deliberate simplification passes #100 and #101 are merged; both completed Linux/Windows/macOS CI successfully. The older draft PR #92 was superseded by #97 and is closed without merge.

## Current gate: Windows validation and measurement

The code-side maintenance pass is complete. Do not stack another broad refactor before real-device validation.

Use one current-`main` release build for the consolidated Windows pass:

1. **Shell / Idle:** #59 and #66 — Idle transparency, tray actions, shortcut/orb transitions, Compact/Board window dragging, and no interference with controls/widget drag-resize.
2. **Board interaction:** #62 and #88 — Select/Add behavior, 3×2 move/resize, pointer-only resize handles, dormant YouTube setup click, configured-but-empty distinction.
3. **Responsive presentation:** #60 and #89 — representative widget sizes, scrolling, image/no-image layout, source imagery/fallback degradation.
4. **Settings / overlays:** #61, #79, #87 — source editors, exact refresh controls, modal stacking/focus/click behavior, repeated Settings/Add-picker cycles without Board-wide disturbance.
5. **YouTube setup:** verify the user-facing handle/channel-URL path in #90. Keep #90 open if stable identity still causes unnecessary repeated public channel-page resolution.
6. **Interaction under refresh:** manually refresh a source while dragging/resizing another widget and exercising a shell transition; record visible stalls if any.
7. **Resident measurement:** run the #63 canonical Windows baseline from `PERF_BASELINE.md` with no refresh due/running, and verify attributable idle network separately.
8. Close only focused verification issues whose checks actually pass; file focused defects for failures.
9. Fix any visible/measured regression before optional broad work such as #53.

## Structure/lightweight review conclusion

The Rust `app/`, `db/`, scheduler/runtime, source-config, and source-adapter boundaries are purposeful and should not be collapsed simply to reduce file count.

The frontend remains more centralized: `main.ts` still owns substantial Board/global-settings orchestration. Further extraction should be driven by a cohesive responsibility boundary and regression coverage, not a line-count target. Do not start that extraction until the current Windows smoke/performance gate is complete.

Current runtime dependencies map to live responsibilities. No dependency was removed merely to claim a lighter stack, and no CPU/RSS improvement is claimed from structural cleanup until #63 is measured.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices separate where practical. After this checkpoint, real-device evidence is more valuable than another speculative cleanup pass.

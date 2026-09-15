# Active work checkpoint

Short-lived execution state. Durable product decisions belong in `DECISIONS.md`; technical invariants belong in the architecture/refresh docs; completed task history belongs in Issues/PRs.

Last updated: 2026-09-15

## Stable baseline

Current `main` includes:

- arXiv, Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS adapters
- cache-first startup and canonical source-instance deduplication
- source/widget automatic-refresh settings plus manual refresh
- responsive 12×8 Board geometry and size-aware feed presentation
- new-widget defaults aligned across TypeScript/Rust: arXiv/Wikipedia/Qiita/Zenn = 3 results, YouTube = 1
- widget configuration shown on a dedicated Board-level editing surface rather than being constrained by widget size
- restored native window dragging permission
- notification-area/system-tray controls and taskbar-free resident behavior
- shared HTTP failure classification with persisted per-source retry deadlines

Linux, Windows, and macOS release-build CI was green on the final heads of the merged runtime/UI slices. GUI/network behavior that cannot be established by CI remains subject to real-device smoke.

## Current maintenance batch

Prioritize the post-source-expansion cleanup before broad feature work:

1. #61 — complete the settings UX with exact typed custom-refresh intervals synchronized with the slider and plain-language refresh status; then smoke the dedicated surface on Windows.
2. #54 — after the settings UX shape is stable, extract the remaining source-specific editor construction from `src/main.ts` without hiding Tauri/save/rehydrate side effects.
3. #57 / #63 — finish the durable-doc signal audit and review the batch for avoidable resident/background work before claiming performance changes.
4. #62 — add explicit Select/Add Board modes after the settings surface is stable.
5. #53 — optional YouTube Data API enrichment stays behind this maintenance batch; RSS remains the no-key baseline.

## Real-device gates still open

These Issues have implementation merged and remain open for Windows interaction/visual verification:

- #59 — Compact/Board native window dragging and interaction separation
- #60 — representative small/medium/large widget density, scrolling, and visible confirmation of the 3/1 defaults
- #66 — fully transparent Idle pixels plus notification-area Open/Hide/Quit and shell regressions

#61 also needs a Windows smoke after its remaining refresh-control work lands.

Record numeric CPU/RSS/network claims only when actually measured. CI green does not substitute for these GUI checks.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices in separate PRs where practical, and do useful independent work rather than polling long CI runs continuously.

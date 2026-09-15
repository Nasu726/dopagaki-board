# Active work checkpoint

Short-lived execution state. Durable product decisions belong in `DECISIONS.md`; technical invariants belong in the architecture/refresh docs; completed task history belongs in Issues/PRs.

Last updated: 2026-09-15

## Stable baseline

`main` is merged through PR #68 (`649d688`). The shipped baseline includes:

- arXiv, Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS adapters
- cache-first startup and canonical source-instance deduplication
- source/widget automatic-refresh settings plus manual refresh
- responsive 12×8 Board geometry and size-aware feed presentation
- restored native window dragging permission
- notification-area/system-tray controls and taskbar-free resident behavior
- shared HTTP failure classification with persisted per-source retry deadlines

Linux, Windows, and macOS release-build CI was green on the final heads of the merged #67 and #68 changes. GUI/network behavior that cannot be established by CI remains subject to real-device smoke.

## Current maintenance batch

Prioritize the post-source-expansion cleanup before broad feature work:

1. #54 / #61 — extract widget/source settings from `src/main.ts` and move configuration to a dedicated editing surface without adding a frontend framework.
2. #60 — while extracting the config boundary, unify new-widget defaults: arXiv/Wikipedia/Qiita/Zenn `maxResults = 3`, YouTube `maxResults = 1`.
3. #57 / #63 — keep durable docs signal-dense and review each batch for avoidable resident/background work before claiming performance changes.
4. #62 — add explicit Select/Add Board modes after the settings surface is stable.
5. #53 — optional YouTube Data API enrichment stays behind this maintenance batch; RSS remains the no-key baseline.

## Real-device gates still open

The implementation is already merged; these Issues remain open only for Windows interaction/visual verification:

- #59 — Compact/Board native window dragging and interaction separation
- #60 — representative small/medium/large widget density, scrolling, and the pending 3/1 defaults
- #66 — fully transparent Idle pixels plus notification-area Open/Hide/Quit and shell regressions

Record numeric CPU/RSS/network claims only when actually measured. CI green does not substitute for these GUI checks.

## Working rule

Inspect actual GitHub branch/PR/workflow state after any interruption before acting. Keep unrelated maintenance slices in separate PRs where practical, and do useful independent work rather than polling long CI runs continuously.

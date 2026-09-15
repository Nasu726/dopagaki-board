# Active work checkpoint

Short-lived execution state for the current branch. Durable decisions belong in `DECISIONS.md`; reusable implementation traps belong in `HANDOFF.md`; completed task history belongs in Issues/PRs.

Last updated: 2026-09-15

## Active branch

- branch: `real-source-adapters-clean`
- draft PR: #52 — `Ship real Wikipedia, Qiita, Zenn and YouTube source adapters`
- base: `main` through PR #51
- parent issue: #48
- follow-up YouTube API work: #53
- post-merge frontend maintainability refactor: #54

## Implemented in #52

The branch contains working backend + Board presentation for Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS in addition to existing arXiv. All five source kinds use the existing Rust scheduler/cache/source-key boundary.

Frontend configuration provides:

- arXiv: query + max results, >=24 h automatic floor
- Wikipedia: language + max results, >=6 h floor
- Qiita: optional query + max results, >=1 h floor
- Zenn: trend/user/topic + value where needed + max results, >=1 h floor
- YouTube RSS: channel ID + max results 1..15, >=1 h floor

Each source has manual refresh plus per-widget inherit/OFF/custom automatic refresh. Source edits go through Rust validation/canonicalization and rehydrate only the affected source/widget content.

## YouTube baseline behavior

- public selected-channel RSS; no Google credential required
- raw `UC...` ID and `/channel/UC...` URL accepted by the frontend; URL parsing is local
- thumbnails derived from stable video IDs
- adding YouTube opens configuration immediately
- cancelling the first configuration keeps the newly created widget so setup can be retried without recreating placement
- empty channel config is a dormant setup state: the adapter returns no rows before HTTP and does not create failure/backoff noise
- widgets sharing the same canonical config share scheduler/cache work

Optional Data API enrichment belongs to #53. Users supply their own key; initial work begins with `@handle` resolution/validation and other low-frequency high-value calls. RSS stays the fallback. OAuth/subscription-aware discovery comes later.

## Validation state

- pre-YouTube reconciled head `e945e84` passed Linux/Windows/macOS CI
- completed YouTube implementation/documentation head `ef90f70` passed Linux/Windows/macOS CI including Tauri release builds
- changes since that green implementation are documentation-only unless GitHub history says otherwise; final-head CI is still required before merge
- a real desktop smoke test of the newly exposed sources/YouTube setup is deferred to the user's next available desktop session

## Current maintenance batch

The documentation reconciliation/noise pass is complete on this branch without behavioral code changes. The next code-maintainability slice is #54 after #52 reaches a stable desktop-tested merge point.

Keep #52's code surface stable until the planned smoke test unless review finds a concrete defect.

## Next gate

At the next desktop session:

1. run the release build from the current #52 head
2. exercise add/config/manual-refresh/cache presentation for Wikipedia, Qiita, Zenn, and YouTube
3. specifically test YouTube add -> immediate editor -> Cancel -> retained widget -> reopen settings -> configure channel -> refresh/content open
4. verify Compact/Board/Idle transitions still behave normally with the new sources
5. note qualitative CPU/memory/network anomalies; record measurements only if actually observed/measured
6. if smoke + final-head Linux/Windows/macOS CI are satisfactory, reconcile PR #52 once, mark ready, and merge

After #52, close/update #48 and proceed to #53, #54, or a measured simplification task.

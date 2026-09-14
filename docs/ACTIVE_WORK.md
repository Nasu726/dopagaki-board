# Active work checkpoint

Short-lived execution state for the current branch. Durable decisions belong in `DECISIONS.md`; reusable implementation traps belong in `HANDOFF.md`; completed task history belongs in Issues/PRs.

Last updated: 2026-09-15

## Active branch

- branch: `real-source-adapters-clean`
- draft PR: #52 — `Ship real Wikipedia, Qiita, Zenn and YouTube source adapters`
- base: `main` through PR #51
- parent issue: #48
- follow-up YouTube API work: #53

## Implemented in #52

The branch contains working backend + Board presentation for Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS in addition to existing arXiv.

All five source kinds use the existing Rust scheduler/cache/source-key boundary. There is no placeholder source infrastructure and NHK remains out of scope.

Frontend configuration currently provides:

- arXiv: query + max results, >=24 h automatic floor
- Wikipedia: language + max results, >=6 h floor
- Qiita: optional query + max results, >=1 h floor
- Zenn: trend/user/topic + value where needed + max results, >=1 h floor
- YouTube RSS: channel ID + max results 1..15, >=1 h floor

Each exposed source has manual refresh plus per-widget inherit/OFF/custom automatic refresh. Source edits go through Rust validation/canonicalization and rehydrate only the affected source/widget content.

## YouTube baseline behavior

- public selected-channel RSS; no Google credential required
- raw `UC...` ID and `/channel/UC...` URL accepted by the frontend; URL parsing is local
- thumbnails derived from stable video IDs
- adding YouTube opens configuration immediately
- cancelling the first configuration keeps the newly created widget so setup can be retried without recreating placement
- empty channel config is a dormant setup state: the adapter returns no rows before HTTP and does not create failure/backoff noise
- widgets sharing the same canonical config share scheduler/cache work

Optional Data API enrichment is deliberately outside #52. Under #53, users supply their own key; begin with `@handle` resolution/validation and other low-frequency high-value calls. RSS stays the fallback. OAuth/subscription-aware discovery comes later.

## Validation state

- pre-YouTube reconciled head `e945e84` passed Linux/Windows/macOS CI
- completed YouTube implementation/documentation head `ef90f70` passed Linux/Windows/macOS CI including Tauri release builds
- later changes after that point are documentation-only unless GitHub history says otherwise; still require final-head CI before merge
- a real desktop smoke test of the newly exposed sources/YouTube setup is intentionally deferred to the user's next available desktop session

Do not claim that smoke test passed until it is actually performed.

## Current maintenance batch

While desktop testing is unavailable, documentation is being reconciled so durable specs no longer describe arXiv as the only live adapter or YouTube as backend-only. `README`, `PRODUCT_SPEC`, `UX_AND_DESIGN`, `ARCHITECTURE`, `REFRESH_POLICY`, `ROADMAP`, and agent guidance are being aligned with the actual #52 implementation.

No behavioral refactor should be merged merely to fill time before the smoke test. Keep #52's code surface stable unless review finds a concrete defect.

## Next gate

At the next desktop session:

1. run the release build from the current #52 head
2. exercise add/config/manual-refresh/cache presentation for Wikipedia, Qiita, Zenn, and YouTube
3. specifically test YouTube add -> immediate editor -> Cancel -> retained widget -> reopen settings -> configure channel -> refresh/content open
4. verify Compact/Board/Idle transitions still behave normally with the new sources
5. note qualitative CPU/memory/network anomalies; record measurements only if actually observed/measured
6. if smoke + final-head Linux/Windows/macOS CI are satisfactory, reconcile PR #52 once, mark ready, and merge

After #52, close/update #48 and proceed to #53 or a measured simplification task. Do not pull OAuth into the #52 merge gate.

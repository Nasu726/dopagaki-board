# Roadmap

Current checkpoint (2026-09-15): **functional MVP is in real-use expansion.** The Tauri shell, four-state loop, responsive 12x8 Board, SQLite cache/scheduler, source-aware refresh policy, and first real source adapters are implemented. Windows real-use measurement has already established an initial acceptable Idle resident-cost baseline; keep measuring as functionality expands rather than treating performance as a one-time phase.

PR #52 is the active real-source expansion. Wikipedia, Qiita, and Zenn frontend slices are implemented; the remaining source slice is selected-channel YouTube RSS. Optional YouTube Data API enrichment is tracked separately in #53.

## Phase 0 — durable specification

- [x] Create repository
- [x] Record initial product decisions
- [x] Split durable docs by concern

Figma comparison/mock work is intentionally deferred and is not required for the current product direction. Revisit it only if real-use feedback reveals a design problem that is easier to resolve visually before implementation.

## Phase 1 — smallest runnable shell

- [x] Bootstrap Tauri 2.
- [x] Establish Rust-owned application state/core boundary.
- [x] Add SQLite connection and minimal migration mechanism.
- [x] Resolve application data directory correctly per OS.
- [x] Add a minimal frontend -> Rust command proving the boundary.
- [x] Start with no external feed/network dependency.
- [x] Add reproducible baseline tooling and documentation.
- [x] Capture first real Windows release-build resident/Idle observation; see `docs/PERF_BASELINE.md`.
- [x] Start the first explicit deletion/simplification pass (#28).

Primary historical issue: #2. Performance measurement/refactor tracking: #6.

## Phase 2 — core state loop

- [x] Implement circular Idle orb.
- [x] Add boolean blue update badge.
- [x] Implement Compact with cached items.
- [x] Implement configurable global shortcut.
- [x] Implement Compact external launch -> automatic Idle collapse.
- [x] Ensure opening Compact never waits for network.
- [ ] Continue real-device transition/startup measurement as behavior evolves.

Primary historical issue: #3. Performance measurement: #6.

## Phase 3 — responsive Board

The original free-pixel Board was replaced after real Windows use showed that accidental overlap/alignment friction outweighed the apparent freedom.

- [x] Create Board canvas.
- [x] Add widgets from an empty-space click.
- [x] Replace free-pixel persistence with a responsive logical 12x8 grid.
- [x] Drag widgets between grid positions.
- [x] Resize from every edge/corner.
- [x] Reject overlap without implicitly pushing neighboring widgets.
- [x] Persist logical geometry at gesture end.
- [x] Convert legacy pixel layouts once when loading.
- [ ] Continue real-device interaction review across small, wide, and half-screen window sizes.

Primary historical issue: #4.

## Phase 4 — cache and scheduler

- [x] Formalize SQLite item/source/widget data.
- [x] Render cached content without waiting for network.
- [x] Add slider-backed refresh interval with OFF.
- [x] Implement soft-deadline/event-driven pending state.
- [x] Bound background concurrency.
- [x] Implement persisted backoff/retry state.
- [x] Keep Hidden/Idle UI work minimal while refresh continues.
- [x] Canonicalize source identity and deduplicate equivalent source/config work.
- [x] Use narrow cache-change UI updates rather than whole-Board rerenders.
- [x] Add source defaults and per-widget inherit/OFF/custom refresh policy.

Primary issue #5 is complete.

## Phase 5 — real adapters

Current rollout:

1. [x] arXiv — async Atom metadata adapter, source-specific 24 h automatic-refresh floor, serialized request gate.
   - [x] Editable query/result-count UI (#35 / PR #40).
2. [x] Wikipedia/Wikimedia — public random discovery + PageImages thumbnails in draft PR #52.
3. [x] Qiita — public items API + optional query in draft PR #52.
4. [x] Zenn — public trend/user/topic RSS in draft PR #52.
5. [ ] YouTube RSS — selected-channel public RSS, thumbnails, typed channel configuration, manual/source-aware refresh. Backend is implemented; frontend exposure is the remaining #52 slice.
6. [ ] YouTube Data API enrichment — optional, user-supplied API key, RSS fallback; tracked by #53.
7. [ ] YouTube OAuth/subscription-aware discovery — later update after the practical non-OAuth implementation is proven.

NHK was removed from scope by product decision.

Do not add adapters by cloning scheduler/cache infrastructure. Reuse the existing source boundary and add only source-specific policy/parsing.

### YouTube rollout constraints

- RSS is the baseline new-video transport and must remain usable with no Google credentials.
- Never embed a shared Data API key. API-enabled users provide their own key.
- Use Data API calls selectively for high-value operations such as `@handle`/channel resolution, channel validation, useful metadata enrichment, and bounded recommendation-candidate discovery.
- API failure or quota exhaustion falls back to RSS where applicable.
- OAuth is not required for the initial RSS or API-key phases. Later OAuth setup should be guided and require only a few user actions before enabling subscription-aware features.

## Phase 6 — media/preload

- visible thumbnails first
- near-visible low-priority preload
- off-screen preload only when justified by measurement
- interrupt/yield preload when foreground work begins
- avoid fetching optional metadata that current display mode does not use

Do not add aggressive preload just because more source metadata is available. Keep the measured lightweightness budget authoritative.

## Phase 7 — recommendation

Recommendation/ranking is application-owned. Do not assume a supported YouTube Data API endpoint reproduces the user's current YouTube Home recommendations.

Start with transparent heuristics, not ML:

- freshness
- already-shown penalty
- click history
- channel preference
- randomness

For YouTube, RSS/API/OAuth phases can progressively broaden the candidate pool, while this ranking layer remains separate. Cache and quota budgets bound how broadly candidates are collected.

Tune only after real usage data exists.

## Phase 8 — simplification and real use

This phase is recurring rather than strictly end-loaded.

1. measure
2. remove dependencies/DOM/state/background tasks
3. use the app daily
4. fix friction observed in real use
5. repeat reduction pass

Issue #28 completed the first explicit post-runtime deletion/refactor slice. Parent tracking remains #6.

## Phase 9 — native decision

Only after value is proven, compare Tauri against actual pain points:

- RSS/memory
- idle CPU
- startup
- window behavior
- OS integration

Consider native Windows/macOS/Linux UI only if measured benefit justifies maintaining platform-specific implementations.

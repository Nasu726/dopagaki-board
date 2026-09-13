# Roadmap

Current checkpoint (2026-09-14): **functional MVP first-complete checkpoint reached.** The runnable shell, state loop, free-form Board, cache/scheduler, first real arXiv adapter, first simplification pass, and editable arXiv query/result-count UI are implemented on `main`. The next product checkpoint is real desktop validation and measurement, not automatic feature expansion. A reproducible performance procedure exists, but the actual numeric Idle CPU/RSS baseline is still pending and must not be reconstructed from CI or estimates.

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
- [ ] Capture real release-build startup/RSS/Idle CPU numbers on a desktop session.
- [x] Start the first explicit deletion/simplification pass (#28).

Primary historical issue: #2. Performance measurement/refactor tracking: #6.

## Phase 2 — core state loop

- [x] Implement circular Idle orb.
- [x] Add boolean blue update badge.
- [x] Implement Compact with cached items.
- [x] Implement configurable global shortcut.
- [x] Implement Compact external launch -> automatic Idle collapse.
- [x] Ensure opening Compact never waits for network.
- [ ] Capture real Idle and transition timing measurements.

Primary historical issue: #3. Performance measurement: #6.

## Phase 3 — free-form Board

- [x] Create free-position Board canvas.
- [x] Add widgets.
- [x] Drag widgets.
- [x] Resize widgets.
- [x] Persist geometry.
- [x] Click empty space -> anchored add-widget picker.
- [x] Keep layout free-form rather than forced grid packing.
- [ ] Perform real-device interaction review across small, wide, and half-screen window sizes.

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

Primary issue #5 is complete.

## Phase 5 — real adapters

Suggested order:

1. [x] arXiv — async Atom metadata adapter, source-specific 24 h automatic-refresh floor, serialized request gate.
   - [x] Editable query/result-count UI (#35 / PR #40).
2. [ ] YouTube — groups/subscribed channels, thumbnails, recommendation heuristic, quota awareness.
3. [ ] Wikipedia/Wikimedia — daily featured/on-this-day/random discovery.
4. [ ] NHK.
5. [ ] Qiita.
6. [ ] Zenn.

Do not add adapters by cloning scheduler/cache infrastructure. Reuse the existing source boundary and add only source-specific policy/parsing.

## Phase 6 — media/preload

- visible thumbnails first
- near-visible low-priority preload
- off-screen preload only when justified by measurement
- interrupt/yield preload when foreground work begins
- avoid fetching optional metadata that current display mode does not use

Do not begin aggressive preload work before the real resident-cost baseline is captured.

## Phase 7 — recommendation

Start with transparent heuristics, not ML:

- freshness
- already-shown penalty
- click history
- channel preference
- randomness

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

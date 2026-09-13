# Roadmap

## Phase 0 — durable specification

- [x] Create repository
- [x] Record initial product decisions
- [x] Split durable docs by concern
- [ ] Build the first Figma comparison sheet from the approved visual direction

## Phase 1 — smallest runnable shell

1. Bootstrap Tauri 2.
2. Establish Rust-owned application state/core boundary.
3. Add SQLite connection and minimal migration mechanism.
4. Resolve application data directory correctly per OS.
5. Add one minimal frontend -> Rust command proving the boundary.
6. Start with no external feed/network dependency.
7. Record baseline startup/RSS/idle CPU.
8. Perform first deletion/simplification pass.

Primary issue: #2.

## Phase 2 — core state loop

1. Implement circular Idle orb.
2. Add boolean blue update badge.
3. Implement Compact with dummy cached items.
4. Implement global shortcut.
5. Implement Compact external launch -> automatic Idle collapse.
6. Ensure opening Compact never waits for network.
7. Measure Idle and transition cost.

Primary issue: #3.

## Phase 3 — free-form Board

1. Create free-position Board canvas.
2. Add dummy widgets.
3. Drag widgets.
4. Resize widgets.
5. Persist geometry.
6. Click empty space -> anchored add-widget picker.
7. Test small, wide, and half-screen Board windows.
8. Keep snapping optional/non-blocking.

Primary issue: #4.

## Phase 4 — cache and scheduler

1. Formalize SQLite item/source/widget data.
2. Render cached content immediately at startup.
3. Add slider-backed refresh interval with OFF.
4. Implement soft-deadline pending state.
5. Bound background concurrency.
6. Implement backoff/retry policy.
7. Keep Hidden/Idle UI work minimal while refresh continues.

Primary issue: #5.

## Phase 5 — real adapters

Suggested order:

1. arXiv — relatively simple text-centric source, good adapter proving ground.
2. YouTube — groups/subscribed channels, thumbnails, recommendation heuristic, quota awareness.
3. Wikipedia/Wikimedia — daily featured/on-this-day/random discovery.
4. NHK.
5. Qiita.
6. Zenn.

Do not implement all adapters before the state loop and scheduler feel correct.

## Phase 6 — media/preload

- visible thumbnails first
- near-visible low-priority preload
- off-screen preload only while idle
- interrupt/yield preload when foreground work begins
- avoid fetching optional metadata that current display mode does not use

## Phase 7 — recommendation

Start with transparent heuristics, not ML:

- freshness
- already-shown penalty
- click history
- channel preference
- randomness

Tune only after real usage data exists.

## Phase 8 — simplification and real use

After core feature completion:

1. measure
2. remove dependencies/DOM/state/background tasks
3. use the app daily
4. fix friction observed in real use
5. repeat reduction pass

## Phase 9 — native decision

Only after value is proven, compare Tauri against actual pain points:

- RSS/memory
- idle CPU
- startup
- window behavior
- OS integration

Consider native Windows/macOS/Linux UI only if expected benefit justifies maintaining platform-specific implementations.

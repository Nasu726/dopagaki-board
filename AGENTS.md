# AGENTS.md

These rules exist so long-running AI-assisted development preserves the product's intent instead of drifting toward a generic dashboard.

## Read first

Before substantial work, read:

- `README.md`
- `docs/HANDOFF.md`
- `docs/PRODUCT_SPEC.md`
- `docs/UX_AND_DESIGN.md`
- `docs/ARCHITECTURE.md`
- `docs/PERFORMANCE.md`
- `docs/ROADMAP.md`
- `docs/DECISIONS.md`

GitHub Issue #1 is the frozen initial project-memory checkpoint. `docs/HANDOFF.md` is the live restart point. Later confirmed decisions override the frozen initial snapshot.

## Product invariants

Do not violate these without recording a deliberate decision change:

- Content is visually more important than app decoration.
- Idle is a genuinely transparent tiny circular orb with no content rendering.
- Compact opens original content in one click and then collapses to Idle.
- Board uses a responsive logical 12×8 grid: arbitrary integer-size rectangles, no overlap, no implicit neighbor reflow.
- Clicking empty Board space is a primary add-widget interaction.
- Compact source priority follows Board spatial order by default: top-to-bottom, then left-to-right.
- Compact must only surface currently active Board widget sources; stale cache alone never makes a deleted source visible.
- Add UI exposes only adapters that actually work. Never substitute seeded fake placeholder content for an adapter.
- NHK is out of scope unless the product decision is explicitly changed.
- Startup is cache-first and never waits for network.
- Rust owns core application logic; the WebView is replaceable presentation.
- SQLite is the local persistent store.
- Background freshness never outranks foreground responsiveness.
- Lightweightness is a product feature.

## Implementation discipline

Prefer the simplest implementation that preserves the above behavior.

Do not add a dependency for functionality that is trivial to implement directly unless the dependency measurably improves correctness/maintenance enough to justify its permanent footprint.

Avoid premature abstraction. If a module exists only to forward calls and has no meaningful boundary yet, consider flattening it.

Use bounded concurrency. Avoid unbounded per-widget tasks. Widgets sharing one canonical source instance share refresh/cache work.

Use event-driven/background-deferred work rather than frequent polling where possible.

## Performance loop

For meaningful feature batches, follow:

`Implement -> Test -> Measure -> Refactor -> Delete -> Measure again`

Look specifically for:

- unnecessary dependencies
- unnecessary state/cache duplication
- unnecessary allocation/cloning
- excess DOM
- hidden rendering/layout work
- timers/poll loops
- redundant network requests
- unnecessary image decode/preload
- over-general abstractions

## Tests

- Unit-test scheduler/state/geometry logic where deterministic tests are practical.
- Test cache-first behavior with network disabled/unavailable when it matters to the change.
- Test state transitions independently of real external adapters.
- Keep tests parallel where safe; do not serialize unrelated tests without reason.
- Add regression tests for bugs that affect persistence, scheduling, source membership, or one-click navigation.
- Linux, Windows, and macOS release-build CI must all be green before merge.

## UI development

Design geometry before decoration.

Do not turn Compact or Board into a generic equal-card dashboard. Grid alignment is a direct-manipulation geometry constraint, not a requirement that widgets share one size.

Source-specific minimal rendering is intentional. Do not add metadata simply because it is available.

Use familiar window-control semantics where they map cleanly; otherwise provide an explicit tooltip/accessible label.

## Decision and handoff hygiene

If implementation forces a product/architecture decision that is currently open, update `docs/DECISIONS.md` in the same change.

If a confirmed decision must change, record what changed and why.

If work creates reusable debugging knowledge, a non-obvious implementation constraint, a CI incident, or a new exact restart point, update `docs/HANDOFF.md` in the same feature batch.

Task-specific status belongs in the relevant Issue/PR. Measured performance results belong in `docs/PERF_BASELINE.md`.

Do not rely on temporary chat context for decisions or knowledge that future work must know.

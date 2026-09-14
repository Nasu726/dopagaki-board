# AGENTS.md

These rules exist so long-running AI-assisted development preserves the product's intent instead of drifting toward a generic dashboard.

## Read first

Before substantial work, read `README.md`, `docs/DECISIONS.md`, `docs/PRODUCT_SPEC.md`, `docs/ARCHITECTURE.md`, and the relevant Issue/PR. If a feature branch is active, also read `docs/ACTIVE_WORK.md`; use `docs/HANDOFF.md` for durable implementation traps and restart knowledge. Consult `docs/UX_AND_DESIGN.md`, `docs/REFRESH_POLICY.md`, and performance docs when the task touches those concerns.

Document authority is intentionally split:

- settled product/architecture choices: `docs/DECISIONS.md`
- current behavior/specification: `docs/PRODUCT_SPEC.md`, `docs/UX_AND_DESIGN.md`, `docs/ARCHITECTURE.md`, `docs/REFRESH_POLICY.md`
- task completion/current branch state: GitHub Issues/PRs and `docs/ACTIVE_WORK.md`
- durable operational/debugging knowledge: `docs/HANDOFF.md`
- measured performance: `docs/PERF_BASELINE.md`

GitHub Issue #1 is a frozen initial planning snapshot. Do not revive an old statement from it or another historical document when a newer decision/specification supersedes it.

## Product invariants

Do not violate these without recording a deliberate decision change:

- Content is visually more important than app decoration.
- Idle is a genuinely transparent tiny circular orb with no content rendering.
- Compact opens original content in one click and then collapses to Idle.
- Board uses a responsive logical 12×8 grid: arbitrary integer-size rectangles, no overlap, no implicit neighbor reflow.
- Clicking empty Board space is a primary add-widget interaction.
- Compact source priority follows Board spatial order by default: top-to-bottom, then left-to-right.
- Compact surfaces only currently active Board widget sources; stale cache alone never makes a deleted source visible.
- Add UI exposes only adapters that actually work. Never substitute seeded/fake placeholder content for an adapter.
- NHK is out of scope unless the product decision is explicitly changed.
- Startup is cache-first and never waits for network.
- Rust owns core application logic; the WebView is replaceable presentation.
- SQLite is the local persistent store.
- Background freshness never outranks foreground responsiveness.
- Lightweightness is a product feature.

## Implementation discipline

Prefer the simplest implementation that preserves the above behavior. Do not add a dependency for functionality that is trivial to implement directly unless the dependency materially improves correctness or maintenance enough to justify its permanent footprint.

Avoid premature abstraction. If a module exists only to forward calls and has no meaningful boundary, flatten it. Conversely, split a file when independent concerns have become large enough that review/navigation suffer; do not use file size alone as a reason to invent a framework.

Use bounded concurrency. Avoid unbounded per-widget tasks. Widgets sharing one canonical source instance share refresh/cache work. Prefer event/deadline-driven work to frequent polling.

## Performance loop

For meaningful feature batches, follow `Implement -> Test -> Measure -> Refactor -> Delete -> Measure again`.

Look specifically for unnecessary dependencies, duplicated state/cache, allocation/cloning, excess DOM, hidden rendering/layout work, timers/poll loops, redundant network requests, unnecessary image decode/preload, and over-general abstractions.

## Tests

- Unit-test scheduler/state/geometry/config-normalization logic where deterministic tests are practical.
- Test cache-first behavior with network unavailable when it matters to the change.
- Test state transitions independently of real external adapters.
- Keep tests parallel where safe; do not serialize unrelated tests without reason.
- Add regression tests for bugs that affect persistence, scheduling, source membership, or one-click navigation.
- Linux, Windows, and macOS release-build CI must all be green before merge.
- CI is not a substitute for real GUI/network smoke testing when behavior depends on the desktop shell or a live source.

## UI development

Design geometry before decoration. Do not turn Compact or Board into a generic equal-card dashboard. Grid alignment is a direct-manipulation constraint, not a requirement that widgets share one size.

Source-specific minimal rendering is intentional. Do not add metadata simply because it is available. Use familiar window-control semantics where they map cleanly; otherwise provide an explicit tooltip/accessible label.

## Decision and handoff hygiene

If implementation forces a currently open product/architecture decision, update `docs/DECISIONS.md` in the same change. If a confirmed decision changes, record what changed and why.

Do not copy transient branch status into every durable specification document. Keep short-lived progress in the Issue/PR and `docs/ACTIVE_WORK.md`; keep reusable debugging knowledge or non-obvious invariants in `docs/HANDOFF.md`.

When a feature changes current behavior, update the smallest authoritative specification document that owns that behavior. Do not rely on temporary chat context for decisions or knowledge that future work must know.

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

## Product invariants

Changing an invariant requires an explicit product/architecture decision:

- Content is visually more important than app decoration.
- Idle is a genuinely transparent tiny circular orb with no content rendering.
- Compact opens original content in one click and then collapses to Idle.
- Board uses a responsive logical 12×8 grid: arbitrary integer-size rectangles, no overlap, no implicit neighbor reflow.
- Clicking empty Board space is a primary add-widget interaction.
- Compact source priority follows Board spatial order by default: top-to-bottom, then left-to-right.
- Compact surfaces only currently active Board widget sources; stale cache alone never makes a deleted source visible.
- Add UI contains only working adapters and uses real source content.
- Startup is cache-first and never waits for network.
- Rust owns core application logic; the WebView is replaceable presentation.
- SQLite is the local persistent store.
- Background freshness never outranks foreground responsiveness.
- Lightweightness is a product feature.

## Implementation discipline

Prefer the simplest implementation that preserves the above behavior. Add a dependency only when it materially improves correctness or maintenance enough to justify its permanent footprint.

Avoid premature abstraction. Flatten forwarding-only modules. Conversely, split a file when independent concerns have become large enough that review/navigation suffer; file size alone is not a reason to invent a framework.

Use bounded concurrency. Widgets sharing one canonical source instance share refresh/cache work. Prefer event/deadline-driven work to frequent polling.

## Performance loop

For meaningful feature batches, follow `Implement -> Test -> Measure -> Refactor -> Delete -> Measure again`.

Look specifically for unnecessary dependencies, duplicated state/cache, allocation/cloning, excess DOM, hidden rendering/layout work, timers/poll loops, redundant network requests, unnecessary image decode/preload, and over-general abstractions.

## Tests

- Unit-test scheduler/state/geometry/config-normalization logic where deterministic tests are practical.
- Test cache-first behavior with network unavailable when it matters to the change.
- Test state transitions independently of real external adapters.
- Keep tests parallel where safe; serialize only tests that actually share constrained state/resources.
- Add regression tests for bugs that affect persistence, scheduling, source membership, or one-click navigation.
- Linux, Windows, and macOS release-build CI must all be green before merge.
- Real GUI/network behavior requires desktop smoke testing when CI cannot exercise it.

## UI development

Design geometry before decoration. Compact and Board are not generic equal-card dashboards; grid alignment constrains direct manipulation, not widget size.

Source-specific minimal rendering is intentional. Add metadata only when it improves the click decision. Use familiar window-control semantics where they map cleanly; otherwise provide an explicit tooltip/accessible label.

## Decision and handoff hygiene

If implementation forces a currently open product/architecture decision, update `docs/DECISIONS.md` in the same change. If a confirmed decision changes, record what changed and why.

Keep short-lived progress in the Issue/PR and `docs/ACTIVE_WORK.md`; keep reusable debugging knowledge or non-obvious invariants in `docs/HANDOFF.md`. Update the smallest authoritative specification document that owns changed behavior.

Keep durable documentation signal-dense. Discarded product/source/tool options belong in Issues, PRs, or history rather than being preserved solely to say they are unsupported. Retain a negative constraint only when omitting it creates a realistic risk of product regression, correctness/security error, or repeated wasted work.

Repository documents, not temporary chat context, carry decisions and reusable implementation knowledge across sessions.

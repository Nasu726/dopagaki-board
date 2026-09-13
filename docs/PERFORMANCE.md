# Performance and simplification policy

Lightweightness is a first-class product feature because this application is intended to stay resident for long periods.

Core rule:

> When there is nothing useful to do, actually do nothing.

## Initial budgets

These are starting targets, not sacred limits. Tighten or revise only with measurements.

- Idle CPU average target: around **<= 0.1%** when nothing is due.
- Investigate sustained idle CPU around **>= 0.5%**.
- App-process idle RSS initial target: **<= 150 MiB**.
- Stretch idle RSS target: **<= 100 MiB**.
- Network: **0 B/s** when neither refresh nor preload is needed.
- Cached usable startup target: around **<= 500 ms** on a normal development machine.
- Background work must not visibly stall drag, resize, scroll, click, or Idle -> Compact.

## Explicit development loop

Do not only add features.

Repeat:

`Implement -> Test -> Measure -> Refactor -> Delete -> Measure again -> Next feature`

After meaningful feature batches, schedule a deliberate simplification pass.

## Reduction checklist

Look for and remove/reduce:

- dependencies used for trivial functionality
- duplicate state/cache layers
- unnecessary clones/allocations
- unnecessary event listeners
- unnecessary timers/poll loops
- excess DOM nodes
- hidden-state rendering/reflow
- redundant network calls
- over-general abstractions
- unused settings
- background services/tasks that can be event-driven
- image decoding/preload that provides no visible value

## Measurement set

Track at least:

- startup to cached usable UI
- Idle CPU over a sustained sampling window
- Idle RSS / process footprint
- Compact open latency
- Board drag/resize responsiveness while background refresh is simulated
- network behavior while truly idle

Keep measurements reproducible enough for before/after comparison.

## Regression policy

If a feature materially regresses a permanent-resource metric, do not simply accept it because the feature works.

Try, in order where sensible:

1. simplify/remove the implementation
2. defer work
3. lazy load
4. lower frequency
5. bound concurrency
6. remove dependency/abstraction
7. redesign the feature

A useful feature that makes a permanently resident app materially heavy is not automatically acceptable.

## Idle-specific rules

Idle is the most aggressively optimized state.

- no thumbnail decoding
- no content rendering
- no continuous animation
- no high-frequency timers
- no layout churn
- no polling just to update UI
- new content can be stored in Rust/SQLite and surfaced only as a boolean badge signal

## Preload rules

Preload is always lower priority than visible/interactive work.

Suggested order:

- P0 user interaction
- P1 visible content
- P2 manual refresh
- P3 due automatic refresh
- P4 near-visible preload
- P5 off-screen preload
- P6 maintenance

Low-priority work should be cancellable/yieldable.

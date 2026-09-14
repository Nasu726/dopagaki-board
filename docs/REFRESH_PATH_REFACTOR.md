# Historical implementation note: refresh-path query reduction

This records the structural optimization merged via PR #44 / Issue #43. It is **not** a pending refactor plan; current runtime behavior is documented in `ARCHITECTURE.md` and `REFRESH_POLICY.md`.

## Motivation

Two background refresh paths originally decoded more widget data than required:

- scheduler source synchronization decoded complete `WidgetLayout` rows before reducing them to source identities
- successful refresh completion listed broad widget data and rebuilt/normalized source keys just to identify widget ids for `cache-changed`

## Result

The DB/runtime path was narrowed so refresh scheduling and completion read only the source/config/widget-id data actually needed. Later refresh-policy work evolved the exact query functions, but the invariant remains: background refresh paths should not decode geometry/display state merely to schedule source work or fan out a cache event.

Canonical source normalization remains authoritative. Semantically equivalent source configs must still resolve to the same source identity.

No scheduler timing, concurrency, cache identity, UI event semantics, or network policy change was intended. The change was structural: less irrelevant SQLite row decoding/allocation/normalization.

Real CPU/RSS impact requires measurement; do not infer a numeric gain solely from this refactor.

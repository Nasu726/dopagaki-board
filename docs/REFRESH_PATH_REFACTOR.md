# Refresh-path query reduction

Post-MVP lightweightness pass for Issue #43 / parent Issue #6.

## Before

Two background refresh paths decoded more widget data than they needed:

- scheduler source synchronization called `widgets::list`, decoding every widget's geometry, refresh config, display mode, and source data before reducing rows back to source identities
- successful refresh completion called `widgets::list` again, then rebuilt and normalized a source key for every widget just to determine which widget ids should receive `cache-changed`

This was functionally correct but made background work scale with the full `WidgetLayout` representation.

## After

`db::widgets` exposes two narrow read paths:

- `list_distinct_source_configs`: only distinct `(source_kind, source_config_json)` pairs for scheduler synchronization
- `list_ids_and_configs_for_source_kind`: only `(id, source_config_json)` rows for the source kind that just refreshed

Runtime source normalization remains authoritative. In particular, refresh completion still normalizes the stored source configuration before comparing identities, so semantically equivalent legacy/non-sparse arXiv configs continue to match the same canonical source key.

No scheduler timing, concurrency, cache identity, UI event payload, or network behavior changes are intended. The improvement is structural: less SQLite row decoding, fewer allocations, and fewer irrelevant source-key normalizations on refresh-related background work.

Real resident CPU/RSS impact still requires desktop measurement; do not infer a numeric improvement from this refactor alone.

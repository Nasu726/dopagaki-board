# Refresh policy

Automatic refresh is resolved in three layers while fetch/cache identity remains source-instance scoped.

## Resolution order

For a widget, automatic refresh resolves as:

1. **Global fallback** — the Settings slider, including OFF.
2. **Source-kind default** — each live adapter may `inherit`, turn automatic refresh `off`, or choose an explicit interval.
3. **Per-widget override** — each widget may `inherit` its source default, turn automatic refresh `off`, or choose an explicit interval.
4. **Adapter hard policy** — the adapter clamps the result to its safe minimum/maximum. arXiv currently clamps every enabled automatic interval to at least 24 hours.

Manual per-widget refresh is independent of the automatic setting and remains available when automatic refresh is OFF, subject to adapter cooldown/backoff.

## Shared source instances

A network/cache source instance is identified by `(source_kind, canonical source_config_json)`, not by widget id. Multiple widgets with the same canonical source configuration therefore share one scheduler entry, one fetch and one cache.

When those widgets request different automatic intervals, the scheduler uses the **most eager enabled effective interval** among them. A widget whose automatic refresh is OFF does not disable another widget sharing the same source instance. If every widget for that source instance resolves to OFF, automatic scheduling is disabled while manual refresh remains possible.

Example:

```text
Global fallback: 6 h
arXiv source default: inherit

Widget A: inherit -> 6 h -> clamped by arXiv to 24 h
Widget B: custom 12 h -> clamped by arXiv to 24 h
Widget C: OFF

Shared arXiv source instance automatic interval: 24 h
```

If Widget B used a different arXiv query, it would be a different source instance and would receive its own scheduler/cache entry.

## Persistence

- Global fallback: SQLite `settings` key `refresh.auto_interval_seconds`.
- Source defaults: bounded `settings` keys `refresh.source_default.<source_kind>`.
- Per-widget override: existing `widgets.refresh_config_json`.
- Scheduler success/failure/backoff history: `source_refresh_state`, keyed by canonical source instance.

`refresh_config_json` uses sparse bounded JSON:

```json
{}
```

means inherit,

```json
{"mode":"off"}
```

means automatic refresh disabled for that widget, and

```json
{"mode":"interval","autoIntervalSeconds":7200}
```

means an explicit two-hour request before adapter clamping.

Configured intervals are currently bounded to 5 minutes through 24 hours. Adding a new adapter must define any harder source-specific minimum in the adapter policy rather than duplicating scheduler logic.

## Runtime constraints

Changing refresh policy wakes the event/deadline-driven coordinator; it must not introduce a polling loop. The scheduler mutex is never held across SQLite or HTTP I/O. Geometry-only changes do not wake refresh scheduling.

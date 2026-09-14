# Refresh policy

Automatic refresh is resolved in layers while network/cache identity remains source-instance scoped.

## Resolution order

For a widget:

1. **Global fallback** — Settings slider, including OFF.
2. **Source-kind default** — inherit global, OFF, or explicit interval.
3. **Per-widget override** — inherit source default, OFF, or explicit interval.
4. **Adapter hard policy** — clamp enabled automatic refresh to the source-safe minimum.

Current hard automatic-refresh floors:

- arXiv: 24 h
- Wikipedia: 6 h
- Qiita: 1 h
- Zenn: 1 h
- YouTube RSS: 1 h

Configured intervals are bounded to 5 minutes through 24 hours before adapter clamping. Manual per-widget refresh remains available when automatic refresh is OFF, subject to scheduler backoff and any adapter-specific request gate.

## Shared source instances

A network/cache source instance is `(source_kind, canonical source_config_json)`, not widget id. Multiple widgets with the same canonical source config share one scheduler entry, one fetch, and one cache identity.

If those widgets request different automatic intervals, use the **most eager enabled effective interval**. A widget set to OFF does not disable another widget sharing the same source instance. If every widget for the source instance resolves to OFF, automatic scheduling is disabled while manual refresh remains possible.

Example:

```text
Global fallback: 6 h
arXiv source default: inherit
Widget A: inherit -> 6 h -> clamped to 24 h
Widget B: custom 12 h -> clamped to 24 h
Widget C: OFF
Shared source interval: 24 h
```

A different source config (for example a different arXiv query or YouTube channel ID) is a different source instance.

## Source-specific notes

- arXiv additionally serializes request starts and spaces them by at least 3 seconds.
- YouTube with an empty channel config is allowed as a setup state. Its adapter returns no rows before performing HTTP, so the retained unconfigured widget does not generate YouTube network traffic.
- New adapters must define hard source policy in the adapter/source policy layer, not by duplicating scheduler logic.

## Persistence

- Global fallback: SQLite `settings` key `refresh.auto_interval_seconds`.
- Source defaults: bounded `settings` keys `refresh.source_default.<source_kind>`.
- Per-widget override: `widgets.refresh_config_json`.
- Scheduler success/failure/backoff history: `source_refresh_state`, keyed by canonical source instance.

`refresh_config_json` is sparse bounded JSON: `{}` means inherit, `{"mode":"off"}` disables automatic refresh for that widget, and `{"mode":"interval","autoIntervalSeconds":7200}` requests two hours before adapter clamping.

## Runtime constraints

Changing refresh policy wakes the event/deadline-driven coordinator; it must not create a polling loop. The scheduler mutex is never held across SQLite or HTTP I/O. Geometry-only changes do not wake refresh scheduling. Multiple widgets never create independent pollers merely because they share a source.

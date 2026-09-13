# Architecture

## MVP stack

- Tauri 2
- Rust application core
- SQLite local persistence/cache
- WebView frontend as a replaceable MVP presentation layer

A native UI rewrite is not a goal by itself. Consider native Windows/macOS/Linux implementations only after product value is proven and measurements show a meaningful benefit.

## Responsibility boundary

The frontend should focus on presentation and interaction. Major application logic should live in Rust so the UI layer can be replaced later without rewriting the core.

Rust should own or mediate:

- source adapters
- HTTP / RSS / API fetching
- SQLite access
- cache policy
- deduplication
- refresh scheduling
- recommendation/ranking
- quota/rate-limit/backoff logic
- thumbnail/preload coordination
- external link launching
- application state needed by Idle/Compact/Board

## Suggested module direction

Start small and flatten modules if they become empty wrappers.

```text
src-tauri/src/
  app/
    mod.rs
    state.rs
  db/
    mod.rs
    migrations.rs
    cache.rs
  sources/
    mod.rs
  scheduler.rs
  recommendation/
    mod.rs
  commands/
    mod.rs
    cache_refresh.rs
  lib.rs
```

Do not create abstractions merely because the diagram looks clean.

## Cache-first startup

Required ordering:

```text
application start
  -> open SQLite/local cache
  -> render cached data
  -> UI becomes usable
  -> start async refresh
  -> merge successful results into cache
  -> update only affected visible UI
```

Network completion is never on the startup critical path.

Schema v3 introduced `feed_items` and `source_refresh_state`. Schema v4 changes cached-item identity from a globally unique `id` to `(source_kind, source_config_json, id)`, because the same external item can legitimately belong to multiple source/query configurations. The initial implementation seeds a small persistent demo cache exactly once so the cache-first path can be exercised before real adapters exist. Demo data must not be reinserted on every launch after a user removes or replaces it.

## SQLite

Use SQLite for modest local state and cached content.

Minimum data domains:

- app settings
- window/layout state
- widgets
- source configuration/groups
- cached content items
- shown/seen/clicked interaction state as needed
- refresh state

Do not over-design schema/migrations before real adapters exist.

`feed_items.payload_json` exists as an escape hatch for source-specific metadata while common fields stay queryable. Do not immediately normalize every future adapter field into columns.

Cached rows are source-instance scoped. A normalized external item id may therefore appear in several rows when multiple source configurations select the same item. Compact/global ranking must deduplicate identical external item ids so overlapping queries do not surface the same content repeatedly. Seen-state updates intentionally apply to every row with the same item id, so seeing an item through one query also marks its copies seen elsewhere.

## Scheduler model

Use soft deadlines, not exact periodic polling.

The scheduler core is intentionally independent from Tauri, SQLite, and HTTP. Its job is to make deterministic decisions about:

- source/config deduplication
- automatic due times
- manual priority upgrades
- bounded concurrency
- retry blocking/backoff

A source instance is identified by `(source_kind, canonical source_config_json)`, not by widget id. Multiple widgets depending on the same source instance must share one refresh job and fan the cached result out afterward.

Per source maintain state equivalent to:

- `next_due_at`
- `refresh_due` / queued request
- `refresh_running`
- `last_attempt`
- `last_success`
- retry/backoff metadata

When a deadline passes, mark the refresh pending. A coordinator runs pending work when foreground pressure and background concurrency allow it.

Priority order:

`User interaction > Visible content > Manual refresh > Due auto refresh > Near-visible preload > Off-screen preload > maintenance`

Start with at most two concurrent background refresh jobs. Never allow unbounded fan-out across widgets. Manual refresh may upgrade an already queued automatic request instead of creating a duplicate.

Failures use backoff rather than tight retry. A blocked source also blocks manual refresh until the hard retry boundary; later adapter policy can distinguish soft automatic backoff from hard API `Retry-After` if needed.

## Async behavior

HTTP/RSS/API waits should use async I/O. Do not dedicate an OS thread merely to wait on network I/O.

CPU-heavy work, if introduced later, may use worker threads where justified.

The pure scheduler core does not imply an OS polling thread. The runtime coordinator should eventually sleep until the next relevant deadline or wake signal rather than poll frequently.

## Adapter contract direction

Adapters may expose capabilities/policy such as:

- minimum refresh interval
- manual refresh cooldown
- budget/quota hints
- retry-after
- backoff state
- whether conditional HTTP is supported

Use `ETag`, `If-Modified-Since`, and `304 Not Modified` where available.

## Refresh interval

- Default target: 1 hour.
- User control: slider.
- OFF supported.
- Manual refresh remains available when OFF.
- Normal maximum around 24 hours.
- Source minimums may clamp the effective interval.

Persist the global automatic interval in `settings` under `refresh.auto_interval_seconds`; `off` means disabled. Absence means the default one hour. Current accepted numeric range is 5 minutes through 24 hours.

## Thumbnail/media loading

- visible media: highest media priority
- near-visible: low-priority preload
- far off-screen: preload only while idle
- any preload must yield when foreground work appears
- Idle renders/decodes no content media

## State transitions

Four actual states:

- Hidden
- Idle
- Compact
- Board

Size presets belong to layout/display logic, not the state machine.

Compact external launch collapses to Idle. Board external launch keeps Board open.

## Shell status vs. view state

Do not expand `ViewState` with unrelated runtime flags. Window/navigation state and shell status have different lifecycles.

Rust-owned shell status currently contains:

- boolean unseen/update indicator
- configured global shortcut
- active shortcut registration error, if the configured binding could not be registered

The frontend reads this status and renders it; it does not become the source of truth. Future feed/scheduler code should change the unseen boolean through the Rust-owned state path rather than inventing a second frontend badge state.

Global shortcut configuration is persisted in the existing SQLite `settings` table. A shortcut replacement must be non-destructive: register the requested new binding before removing the known-working old binding, persist only after the runtime swap succeeds, and do not silently try fallback shortcuts.

## Board persistence

Persist at least:

- widget id
- source/type
- source/group config
- x/y position
- width/height
- display preset/mode
- refresh configuration
- z/order only if it becomes necessary

Prefer logical coordinates so DPI scaling does not corrupt layouts.

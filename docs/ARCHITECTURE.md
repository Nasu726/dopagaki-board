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
  sources/
    mod.rs
  scheduler/
    mod.rs
  recommendation/
    mod.rs
  commands/
    mod.rs
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

## Scheduler model

Use soft deadlines, not exact periodic polling.

Per widget/source maintain state equivalent to:

- `next_due_at`
- `refresh_due`
- `refresh_running`
- `last_attempt`
- `last_success`
- retry/backoff metadata

When a deadline passes, mark the refresh pending. A coordinator runs pending work when foreground pressure and background concurrency allow it.

Priority order:

`User interaction > Visible content > Manual refresh > Due auto refresh > Near-visible preload > Off-screen preload > maintenance`

Start with 1–2 concurrent background network tasks. Never allow unbounded fan-out across widgets.

## Async behavior

HTTP/RSS/API waits should use async I/O. Do not dedicate an OS thread merely to wait on network I/O.

CPU-heavy work, if introduced later, may use worker threads where justified.

## Adapter contract direction

Adapters may expose capabilities/policy such as:

- minimum refresh interval
- manual refresh cooldown
- quota/budget hints
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

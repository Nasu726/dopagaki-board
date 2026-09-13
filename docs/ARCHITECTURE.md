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

## Current module direction

Keep modules small and flatten them if they become empty wrappers.

```text
src-tauri/src/
  app/
    mod.rs
    state.rs
  db/
    mod.rs
    migrations.rs
    cache.rs
    refresh_state.rs
  sources/
    mod.rs
    arxiv.rs
  runtime.rs
  scheduler.rs
  source_config.rs
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
  -> start async refresh runtime
  -> merge successful results into cache
  -> update only affected visible UI
```

Network completion is never on the startup critical path. `runtime::start` may construct clients and spawn tasks during setup, but it must not wait for a network request before the application becomes usable.

Schema v3 introduced `feed_items` and `source_refresh_state`. Schema v4 changes cached-item identity from a globally unique `id` to `(source_kind, source_config_json, id)`, because the same external item can legitimately belong to multiple source/query configurations. The demo cache is seeded exactly once so offline/cache-first UI can be exercised before every adapter exists.

## SQLite and cache identity

Use SQLite for modest local state and cached content.

Minimum data domains:

- app settings
- window/layout state
- widgets
- source configuration/groups
- cached content items
- shown/seen/clicked interaction state as needed
- refresh state

`feed_items.payload_json` is an escape hatch for source-specific metadata while common fields remain queryable. Do not immediately normalize every future adapter field into columns.

Cached rows are source-instance scoped. A normalized external item id may therefore appear in several rows when multiple source configurations select the same item. Preserve these semantics:

- row identity: `(source_kind, canonical source_config_json, external item id)`
- Compact/global ranking deduplicates identical external item ids
- seen state is global by external item id, so seeing one copy marks its cached copies seen elsewhere
- refreshing an existing row preserves its current seen state
- inserting a new source-scoped duplicate inherits an already-seen state for that external id

## Canonical source configuration

`source_config.rs` is the single canonicalization boundary for source config JSON.

- input must be a bounded JSON object
- object keys are recursively sorted
- array order is preserved
- output is compact JSON
- `SourceKey::new` canonicalizes before scheduler-key construction
- source-specific cache reads canonicalize before querying SQLite
- adapter cache writes use the canonical key supplied by the runtime

Do not compare raw user-entered JSON strings as source identity.

## Scheduler model

Use soft deadlines, not exact periodic polling.

The scheduler core remains deliberately independent from Tauri, SQLite, HTTP, and wall-clock calls. It decides:

- source/config deduplication
- automatic due times
- manual-priority upgrades
- bounded concurrency
- retry blocking/backoff
- next meaningful wakeup deadline

A source instance is identified by `(source_kind, canonical source_config_json)`, not widget id. Multiple widgets depending on the same source instance share one refresh job and fan cached results out afterward.

Per source, scheduler state is equivalent to:

- `next_due_at`
- queued request / priority
- `running`
- failure count
- `blocked_until`

Persisted `last_attempt`, `last_success`, failure count, and `blocked_until` live in SQLite. The runtime restores the decision state after startup so failures and successful refresh deadlines survive process restarts.

Priority order remains:

`User interaction > Visible content > Manual refresh > Due auto refresh > Near-visible preload > Off-screen preload > maintenance`

Start with at most two concurrent background refresh jobs. Manual refresh may upgrade an already queued automatic request instead of creating a duplicate. Failures use exponential backoff rather than tight retry; a blocked source also blocks manual execution until the hard retry boundary.

## Runtime coordinator

`runtime.rs` is the integration layer between pure scheduling decisions, SQLite, adapters, and UI events.

It is event/deadline driven:

1. snapshot supported widget source instances and persisted refresh state from SQLite
2. briefly lock the scheduler to synchronize source state, mark due work, and pop ready jobs
3. release the scheduler lock
4. perform SQLite/HTTP work asynchronously
5. briefly reacquire the scheduler lock to record success/failure
6. sleep until either `Notify` wakes it or the next scheduler deadline arrives

There is no high-frequency polling loop.

**Locking invariant:** never hold the scheduler mutex across SQLite or HTTP I/O. This avoids scheduler/DB lock inversion and prevents foreground commands from waiting behind network latency.

Widget add/delete and refresh-setting changes wake the coordinator. Geometry-only changes do not. Completion also wakes it so newly available concurrency can be consumed immediately.

## Adapter contract direction

Adapters may expose policy such as:

- minimum automatic refresh interval
- manual cooldown / hard request gate
- budget/quota hints
- retry-after
- whether conditional HTTP is actually supported

Use conditional HTTP only where the endpoint documents/supports it. Do not invent validators.

### arXiv adapter

The first real adapter is arXiv, implemented as async HTTP + Atom parsing.

Current policy:

- automatic arXiv refresh is clamped to at least 24 hours
- manual refresh remains available when automatic refresh is OFF
- all legacy-API requests share one serialized gate
- request starts are spaced by at least 3 seconds
- results are sorted by submitted date descending
- the adapter stores stable arXiv ids without version suffixes so later versions of the same paper remain one logical item
- title/author/category/summary metadata is normalized into the common cache plus `payload_json`
- no ETag/Last-Modified behavior is fabricated

The request gate is separate from scheduler backoff: the scheduler prevents tight retries after failures, while the adapter gate enforces arXiv-specific request serialization/rate spacing.

## Refresh interval

- Default global target: 1 hour.
- User control: slider.
- OFF supported.
- Manual refresh remains available when OFF.
- Normal global maximum: 24 hours.
- Source-specific minimums clamp the effective interval; arXiv currently clamps to 24 hours.

Persist the global automatic interval in `settings` under `refresh.auto_interval_seconds`; `off` means disabled. Absence means the default one hour. Current accepted numeric range is 5 minutes through 24 hours.

## Cache-change UI events

Successful runtime writes emit a narrow `cache-changed` event containing the source kind, canonical config, and affected widget ids.

Presentation rules:

- Hidden/Idle: do not render feed DOM or decode media
- Compact: reload the small top-cache surface without forcing a whole application render
- Board: rehydrate only affected widget content nodes
- never rebuild the whole Board because a background refresh completed; active drag/resize/settings interactions must survive

The Rust-owned `ShellStatus.has_unseen` remains the only badge source of truth.

## Thumbnail/media loading

- visible media: highest media priority
- near-visible: low-priority preload
- far off-screen: preload only while idle if later justified
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

Rust-owned shell status contains:

- boolean unseen/update indicator
- configured global shortcut
- active shortcut registration error

Global shortcut configuration is persisted in SQLite. Replacement must be non-destructive: register the requested new binding before removing the known-working old binding, persist only after the runtime swap succeeds, and do not silently try fallback shortcuts.

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

Board drag/resize updates the DOM during pointer movement and persists geometry at gesture end. Keep feed hydration separate from geometry persistence and update only the widget content node.

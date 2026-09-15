# Architecture

## Stack and boundary

Current implementation:

- Tauri 2 desktop shell
- Rust application core
- SQLite local persistence/cache
- Vanilla TypeScript/WebView presentation and direct-manipulation UI

A native rewrite is not a goal by itself. Consider platform-native UIs only if measured resident cost, shell behavior, or OS integration becomes a concrete limitation.

The frontend owns rendering, accessibility, widget-local forms, and pointer interaction. Rust owns or mediates source adapters, HTTP/RSS/API access, SQLite, canonical source identity, cache semantics, scheduling/backoff, recommendation/ranking, external launch, and persistent application/shell state.

## Internal boundaries

Keep meaningful boundaries, but do not create forwarding-only abstractions.

The Rust core separates deterministic scheduling/policy from runtime integration, persistence, source-specific adapter behavior, canonical source configuration, and Tauri command/shell concerns. Those boundaries matter because scheduler decisions must remain testable without HTTP/SQLite/Tauri, while adapter validation and runtime side effects remain explicit.

The frontend is intentionally framework-free. Keep application state and Tauri orchestration visible, while extracting cohesive presentation concerns when they gain a clear independent boundary. Do not split files solely to satisfy a size target.

## Cache-first startup

Required ordering:

```text
application start
  -> open SQLite/cache
  -> render cached state
  -> UI becomes usable
  -> start async refresh coordinator
  -> merge successful network results into cache
  -> update only affected visible UI
```

Network completion is never on the startup critical path. Hidden/Idle perform no feed DOM/media work.

## SQLite and cache identity

Cached row identity is `(source_kind, canonical source_config_json, external item id)`. The same external item may legitimately appear under multiple source configs.

Preserve these semantics:

- source-specific cache rows may duplicate an external item across configs
- Compact/global ranking deduplicates identical external item ids
- seen state is global by external item id
- refreshing an existing row preserves seen state
- a newly inserted source-scoped duplicate inherits existing seen state for the same external id

`feed_items.payload_json` is the source-specific metadata escape hatch. Do not normalize every future adapter field into permanent columns without a query/use-case reason.

## Canonical source configuration

`source_config.rs` is the generic JSON canonicalization boundary: bounded object input, recursively sorted object keys, preserved array order, compact output. Adapter-specific validation/default normalization belongs in each adapter.

A source instance is `(source_kind, canonical source_config_json)`, not widget id. All scheduler/cache lookups must use that representation. Equivalent sparse/default configs should collapse to one identity where the adapter defines equivalence.

Source edits flow through Rust commands; the frontend never writes source config directly to SQLite.

## Scheduler and runtime

`scheduler.rs` remains deterministic decision logic independent of Tauri, SQLite, HTTP, and wall-clock calls. It owns source deduplication, due times, manual-priority upgrades, bounded concurrency, retry blocking/backoff, and the next meaningful wakeup deadline.

`runtime.rs` integrates scheduler, DB, adapters, and UI events. The coordinator is event/deadline driven:

1. snapshot active source instances, resolved intervals, and persisted refresh state
2. briefly synchronize/pop scheduler decisions
3. release scheduler lock
4. perform async network and DB work
5. record success/failure briefly
6. sleep until `Notify` or the next deadline

**Locking invariant:** never hold the scheduler mutex across SQLite or HTTP I/O.

Background concurrency is bounded. Duplicate requests collapse by source identity; widgets sharing one source do not create independent pollers. Geometry-only changes do not wake refresh scheduling. Refresh/config changes do.

Exact interval resolution and current adapter floors are documented in `REFRESH_POLICY.md`.

## Source adapter contract

Adapters own source-specific validation, endpoint construction, parsing, stable external ids, and hard policy such as minimum automatic interval/request gates. The runtime provides shared public HTTP infrastructure for the current public adapters.

Current source paths:

- arXiv: Atom, submitted-date ordering, stable ids without version suffixes, serialized/spaced legacy API requests
- Wikipedia: MediaWiki random discovery + PageImages
- Qiita: public items API with optional query
- Zenn: public trend/user/topic RSS
- YouTube: public selected-channel Atom/RSS with stable video-id thumbnails; empty channel config is a dormant setup state and performs no YouTube HTTP request

Do not fabricate ETag/Last-Modified support or endpoint capabilities that a source does not document.

## YouTube API evolution

RSS remains the no-key baseline. Optional Data API work must stay behind the existing source/runtime/cache boundaries rather than creating a parallel polling subsystem. Users supply their own API key; key absence, API failure, or quota exhaustion should preserve RSS functionality where applicable.

Initial API usage should be low-frequency and high-value (`@handle` resolution, validation, visible metadata enrichment, bounded candidate discovery). OAuth/subscription-aware discovery is a later layer. Recommendation/ranking remains app-owned and is not modeled as a YouTube Home-feed API.

Credential storage, API-derived cache freshness/retention, quota accounting, and OAuth scopes require explicit decisions before those phases ship.

## UI update boundary

Successful cache writes emit a narrow `cache-changed` event with source kind, canonical config, and affected widget ids.

- Hidden/Idle: no feed rendering/media decode
- Compact: reload only the small cached surface
- Board: rehydrate only affected widget content nodes
- never rebuild the whole Board because a background refresh completed

Cache hydration must not reset drag/resize/config interactions. Board feed rendering must work with or without images.

## Board persistence

Persist widget source/config, logical 12×8-grid rectangle, display mode/preset if used, and refresh configuration. Drag/resize mutates presentation during the gesture and persists geometry once at gesture end; do not write SQLite on every pointer move.

Compact source priority is derived from active Board spatial order. Deleting the final widget for a source/config immediately removes that source from Compact eligibility even if cache rows remain.

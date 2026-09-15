# Decision log

This file records concise project decisions that should remain stable across sessions.

## Confirmed

### Product role

The application is a discovery/launcher surface, not a replacement reader/player for every source.

### MVP stack

Use Tauri 2 for the practical desktop implementation. Consider native UIs later only if measured resident cost or OS integration becomes a real problem.

### Core ownership

Rust is the application core. The WebView is primarily a presentation and direct-manipulation layer.

### Persistence

Use SQLite for local persistent state/cache.

### Startup

Use cache-first startup. Never wait for network before showing usable cached UI.

### Background fetching

Use async I/O and event/deadline-driven scheduling. Background network waiting does not occupy a dedicated OS thread and scheduling does not use high-frequency polling.

### Refresh

Keep a global default automatic interval with OFF and manual per-widget refresh. Source policy may impose a harder minimum. Per-source defaults and per-widget overrides use the same shared source-instance scheduler rather than creating one network task per widget.

Use soft deadlines: being lightweight is more important than firing at an exact timestamp.

### States and window controls

Use four actual states:

- Hidden
- Idle
- Compact
- Board

Window size presets are not separate application states. Where the custom chrome maps to familiar window operations, use conventional minimize / restore / maximize-like affordances and explicit tooltips rather than private icon semantics.

### Idle

Idle is a tiny circular orb / おはじき with optional blue boolean update dot and no content rendering. The area outside the circle is genuinely transparent.

The resident window stays off the Windows taskbar, including while Compact/Board is visible. A global shortcut is the primary recovery path.

### External navigation

Content opens in one click with no intermediate detail screen.

From Compact, external launch automatically collapses the app back to Idle. From Board, keep Board open.

### Board layout

Board is a **responsive virtual grid**, currently 12 columns × 8 rows. The grid is a geometry model and does not need visible grid lines.

- a widget is a rectangle whose opposite corners lie on grid intersections
- persisted x/y/width/height are logical integer grid units
- widget pixel geometry scales with the Board window
- widgets can use different integer grid sizes
- dragging snaps the whole widget to grid coordinates
- every edge and corner is a resize target
- widget rectangles must not overlap
- during drag/resize, a colliding candidate is rejected and the widget stays at the last valid geometry
- clicking empty Board space creates a widget at/near that location, using the nearest free rectangle when necessary
- legacy pixel layouts are converted once when loaded and persisted in grid units

Grid alignment keeps direct manipulation predictable while preserving user-authored spatial layout.

### Compact priority

Compact contains only sources represented by current Board widgets. Deleting the final widget for a source/config removes that source from Compact immediately even if cache rows remain.

Default source priority follows Board position: top-to-bottom, then left-to-right, with widget id only as a stable tie-breaker. The Board itself therefore acts as the default priority editor.

### Visual direction

Use a light/white, restrained, rounded, content-first interface with minimal chrome.

### Source-specific display and availability

Presentation is source-specific. arXiv is title-centric; image-centric sources use their real thumbnails/OGP when available. The add picker exposes only implemented adapters.

### YouTube integration strategy

Use **public selected-channel RSS as the baseline transport**, then add YouTube Data API capabilities incrementally.

Current/near-term behavior:

- selected-channel new-video monitoring uses public RSS and remains usable without a Google API key
- YouTube widgets are configured around a channel ID and bounded result count
- adding a YouTube widget immediately opens its source configuration
- cancelling that first configuration keeps the newly created widget so setup can be retried without recreating placement
- an unconfigured YouTube widget remains dormant rather than being treated as a failed network refresh/backoff condition
- the UI provides lightweight channel-ID guidance; Data API support adds handle/URL resolution
- automatic RSS refresh uses the existing source floor and scheduler/cache boundaries

Data API rollout:

- API use is optional and additive; RSS remains the fallback when no API key is configured, quota is exhausted, or the API is unavailable
- each user supplies their own YouTube Data API key; the desktop application does not ship a shared project key
- first API uses are high-value/low-frequency operations such as resolving `@handle` to a channel ID, validating channels, enriching visible/cached video metadata, and selectively broadening recommendation candidates
- API enrichment fetches data only when it is useful to current product behavior
- recommendation/ranking remains application-owned; candidate sets come from available public/API sources and the app applies its transparent heuristic layer
- authenticated/private-account features are a later phase; OAuth setup should reduce Google authorization to a few guided clicks and enable features such as subscription-aware discovery
- credential storage, quota accounting, cache/refresh rules for API-derived data, and OAuth scopes require explicit design before those phases ship

### Shortcut and settings

Provide a configurable global shortcut. Initial/default binding: `CommandOrControl + Shift + Space`.

Global shortcut and refresh policy belong under one conventional gear/settings surface.

### Lightweightness

Optimization/deletion is part of the recurring development loop. Preserve the measured resident behavior as functionality expands.

## Open questions

- exact 1/2/3-item Compact visual geometry after more daily use
- exact local storage mechanism for user-supplied API credentials before YouTube Data API support ships
- exact recommendation candidate-generation mix once YouTube Data API support is available
- cached-data retention/eviction policy
- off-screen thumbnail preload depth
- OS power-saver integration
- exact native-rewrite thresholds

When one is resolved, move it into the confirmed decisions or the appropriate authoritative spec.

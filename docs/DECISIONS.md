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

The resident window stays off the Windows taskbar, including while Compact/Board is visible. A global shortcut is the primary recovery path; native system-tray controls are the fallback resident control surface.

### External navigation

Content opens in one click with no intermediate detail screen.

From Compact, external launch automatically collapses the app back to Idle. From Board, keep Board open.

### Board layout

Use a responsive **12×8 logical integer grid** so persisted widget geometry scales with the Board window while preserving user-authored spatial layout. Widgets snap to grid coordinates, use a current minimum of **3×2 cells**, never overlap, and do not implicitly push/reflow neighbors. Detailed interaction rules belong in the product/UX specification.

Use explicit Select/Add modes. Select is the default; empty-space clicks are harmless there. Add is the only mode where empty Board space chooses a placement target.

### Compact priority and unseen scope

Compact contains only sources represented by current Board widgets. Deleting the final widget for a source/config removes that source from Compact immediately even if cache rows remain.

Default source priority follows Board position: top-to-bottom, then left-to-right, with widget id only as a stable tie-breaker. The Board itself therefore acts as the default priority editor.

Idle unseen state is likewise scoped to currently active semantic Board sources; orphaned cache must not keep the update dot active.

### Visual direction

Use a light/white, restrained, rounded, content-first interface with minimal chrome.

### Source-specific display and availability

Presentation is source-specific. arXiv is title-centric; image-centric sources use real source imagery when available and a lightweight fallback where justified. The add picker exposes only implemented adapters.

### YouTube integration strategy

Use **public selected-channel RSS as the no-key baseline**. Ordinary public channel identifiers (`@handle`, handle URLs, supported channel URLs, and raw `UC...` ids) must remain usable without configuring the YouTube Data API.

Human-facing channel references may be resolved from the public channel page when RSS needs the internal channel id. Keep this bounded and avoid repeated resolution work where a stable canonical result can be retained.

Optional YouTube Data API support is additive, uses a user-supplied key rather than a shared application key, and must preserve RSS fallback where applicable. Reserve API calls for capabilities that actually need the API, such as explicit validation, useful visible metadata enrichment, or bounded candidate discovery with quota accounting. OAuth/private-account features come later and require explicit credential/scope/retention decisions before shipping.

Recommendation/ranking remains application-owned rather than modeling YouTube's Home feed as an available API.

### Shortcut and settings

Provide a configurable global shortcut. Initial/default binding: `CommandOrControl + Shift + Space`.

Global shortcut and refresh policy belong under one conventional gear/settings surface. Widget source/refresh configuration uses the dedicated Board-level widget editor rather than being constrained by widget size.

### Lightweightness

Optimization/deletion is part of the recurring development loop. Preserve measured resident behavior as functionality expands. Structural cleanup is not itself evidence of CPU/RSS improvement; runtime claims require measurement.

## Open questions

- exact 1/2/3-item Compact visual geometry after more daily use
- exact local storage mechanism for user-supplied API credentials before YouTube Data API support ships
- exact recommendation candidate-generation mix once API-assisted discovery is available
- cached-data retention/eviction policy
- off-screen thumbnail preload depth
- OS power-saver integration
- exact native-rewrite thresholds

When one is resolved, move it into the confirmed decisions or the appropriate authoritative spec.

# Decision log

This file records concise project decisions so later sessions/agents do not silently reopen settled choices.

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

Use async I/O and event/deadline-driven scheduling. Do not occupy an OS thread merely waiting for network I/O and do not introduce high-frequency polling.

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

Idle is a tiny circular orb / おはじき with optional blue boolean update dot and no content rendering. The area outside the circle is genuinely transparent; the app should not look like a square window containing a circular picture.

The resident window should stay off the Windows taskbar, including while Compact/Board is visible. A global shortcut is the primary recovery path.

### External navigation

Content opens in one click with no intermediate detail screen.

From Compact, external launch automatically collapses the app back to Idle. From Board, keep Board open.

### Board layout — revised after Windows MVP test

The earlier free-pixel placement decision is superseded by the real-use result from 2026-09-14.

Board is a **responsive virtual grid**, currently 12 columns × 8 rows. The grid is a geometry model and does not need visible grid lines.

- a widget is a rectangle whose opposite corners lie on grid intersections
- persisted x/y/width/height are logical integer grid units, not physical pixels
- widget pixel geometry scales with the Board window
- widgets can use different integer grid sizes; this is not an equal-card dashboard
- dragging snaps the whole widget to grid coordinates
- every edge and corner is a resize target
- widget rectangles must not overlap
- during drag/resize, a colliding candidate is rejected and the widget stays at the last valid geometry; neighbors are never pushed/reflowed implicitly
- clicking empty Board space still creates a widget at/near that location, using the nearest free rectangle when necessary
- legacy pixel layouts are converted once when loaded and persisted in grid units

The motivation is direct-manipulation predictability: free pixel positioning produced accidental overlap and made alignment harder rather than freer.

### Compact priority

Compact contains only sources represented by current Board widgets. Deleting the final widget for a source/config removes that source from Compact immediately even if cache rows remain.

Default source priority follows Board position: top-to-bottom, then left-to-right, with widget id only as a stable tie-breaker. This makes the Board itself the default priority editor without another mandatory settings layer.

### Visual direction

Use a light/white, restrained, rounded, content-first interface with minimal chrome. Figma comparison work is not a prerequisite; real desktop feedback is authoritative for the current phase.

### Source-specific display and availability

Do not force a universal card format. arXiv is title-centric; image-centric sources should use their real thumbnails/OGP when adapters exist.

Never expose seeded fake placeholder content as if a source worked. The add picker shows only adapters that are actually implemented. Future adapters can remain documented until they are real.

NHK is removed from the product/source plan by user decision after real-use review. Do not reintroduce it unless that decision is explicitly changed.

### Shortcut and settings

Provide a configurable global shortcut. Initial/default binding: `CommandOrControl + Shift + Space`.

Global shortcut and refresh policy belong under one conventional gear/settings surface rather than unrelated top-level icons.

### Lightweightness

Optimization/deletion is part of the recurring development loop, not a final cleanup phase. The first real Windows measurement met the initial resident budget; preserve that behavior while fixing usability.

## Open questions

These are deliberately not frozen:

- exact 1/2/3-item Compact visual geometry after more daily use
- exact YouTube authentication/quota strategy before exposing that adapter
- cached-data retention/eviction policy
- off-screen thumbnail preload depth
- OS power-saver integration
- exact native-rewrite thresholds

When one is resolved, append the decision here rather than silently relying on chat context.

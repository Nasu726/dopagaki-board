# Decision log

This file records concise project decisions so later sessions/agents do not silently reopen settled choices.

## Confirmed

### Product role

The application is a discovery/launcher surface, not a replacement reader/player for every source.

### MVP stack

Use Tauri 2 for the MVP. Consider native UIs later only after product value is proven and measurements justify the maintenance cost.

### Core ownership

Rust is the application core. The WebView is primarily a presentation layer.

### Persistence

Use SQLite for local persistent state/cache.

### Startup

Use cache-first startup. Never wait for network before showing usable cached UI.

### Background fetching

Use async I/O. Do not occupy an OS thread merely waiting for HTTP/RSS/API I/O.

### Refresh

Default target is 1 hour, user-configurable with a slider. Include OFF. Keep manual per-widget refresh.

Use soft deadlines: being lightweight is more important than firing at an exact timestamp.

### States

Use four actual states:

- Hidden
- Idle
- Compact
- Board

Window size presets are not separate application states.

### Idle

Idle is a tiny circular orb / おはじき with optional blue boolean update dot and no content rendering.

### External navigation

Content opens in one click with no intermediate detail screen.

From Compact, external launch automatically collapses the app back to Idle. From Board, keep Board open.

### Board layout

Board uses free placement and free sizing. Fixed grid packing is not the model. Optional snapping may assist alignment.

Clicking empty Board space must allow creating a widget at/near that point.

### Visual direction

Use the second generated concept mock as the baseline: light/white, restrained, rounded, content-first, minimal chrome.

### Source-specific display

Do not force a universal card format. Selected YouTube channels may default to thumbnail-only; Qiita/Zenn may be OGP-only where sufficient; arXiv is title-centric.

### Shortcut

Provide a configurable global shortcut. Initial candidate: `CommandOrControl + Shift + Space`.

### Lightweightness

Optimization/deletion is part of the recurring development loop, not a final cleanup phase.

## Open questions

These are deliberately not frozen:

- exact Idle orb diameter/hit geometry
- final Idle visual identity/icon treatment
- exact Compact dimensions
- exact 1/2/3-item Compact geometry
- exact Board snapping strength/behavior
- exact YouTube recommendation weights
- cached-data retention/eviction policy
- off-screen thumbnail preload depth
- OS power-saver integration
- exact native-rewrite thresholds

When one is resolved, append the decision here rather than silently relying on chat context.

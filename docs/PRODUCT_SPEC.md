# Product specification

## Purpose

A lightweight desktop discovery board that keeps attractive information sources nearby without demanding attention. The product discovers content and launches the original site/app in one click; it is not intended to become the primary place where all content is consumed.

The user always retains control. Do not use coercive copy, notification spam, heavy popups, or task-management-style guilt.

## Initial sources

- YouTube
- arXiv
- Wikipedia / Wikimedia feeds
- NHK News
- Qiita
- Zenn

New sources must be addable through a clear adapter boundary.

## Application states

There are four actual states. Window-size presets are not states.

### Hidden

- No visible app surface.
- Automatic refresh may continue according to settings.
- Global shortcut restores Compact.

### Idle

- Normal long-lived state.
- Tiny circular orb / おはじき UI, not a conventional rectangular mini-window.
- No title, source label, thumbnail, count, card, or feed rendering.
- Optional small blue boolean update dot in the upper-right.
- Clicking opens Compact.

### Compact

- Very small content surface.
- Shows roughly 1–3 high-priority items.
- Content consumes almost all available safe area.
- One click opens the original URL/app immediately.
- After launching external content, Compact automatically collapses to Idle.

### Board

- Full discovery surface.
- Widgets are freely positioned and freely sized.
- Optional snapping may assist alignment but must not enforce a grid.
- Clicking empty Board space opens an add-widget flow anchored near that position.
- Board remains open after launching external content.
- Window can range from widget-like size to roughly half a desktop screen.

## Source-specific minimum presentation

Do not force every source into a generic card.

- **YouTube / selected subscribed channels:** thumbnail-only is a valid/default minimal mode.
- **YouTube / recommendations:** thumbnail-first, optional small metadata.
- **Qiita / Zenn:** OGP/thumbnail-first; text fallback if unavailable.
- **arXiv:** title-centric.
- **NHK:** image + headline.
- **Wikipedia:** image + title / daily context.

For YouTube display density, prefer simple presets such as `minimal / standard / detailed` instead of many independent toggles. If a field requires extra API work and the active display mode does not use it, do not fetch it.

## Wikipedia

Candidate feeds include:

- daily featured content
- On this day
- random article discovery
- related daily feeds / most-read when useful

Daily content should not be needlessly refetched hourly after the day's value is cached.

## YouTube recommendation behavior

Do not attempt to reproduce YouTube Home personalization in the MVP.

Build recommendations from selected/subscribed channel candidates using a simple heuristic such as:

- freshness
- already-shown penalty
- click history
- channel preference
- randomness

Randomness is intentional so refresh does not merely return the same newest item repeatedly.

## Refresh settings

- Default automatic refresh target: 1 hour.
- Use a slider for flexible intervals.
- Include OFF.
- Manual refresh remains available while auto-refresh is OFF.
- Normal upper end: about 24 hours.
- Source-specific minimum intervals may clamp the effective value.

## Manual refresh

- Refresh is primarily per-widget.
- “Refresh everything” must not be the primary interaction.
- Respect source quotas, cooldowns, retry-after, and backoff.

## Persistence

Persist locally:

- app settings
- window state
- Board layout
- widgets
- source/group configuration
- cached content items
- shown/seen/clicked state as needed
- refresh state

Cloud is not required.

## Non-goals

- coercive productivity features
- notification spam
- cloud-required architecture
- high-frequency polling
- reproducing YouTube Web
- consuming every article/video inside this app
- adding large feature sets before the core loop is proven

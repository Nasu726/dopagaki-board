# Product specification

## Purpose

A lightweight desktop discovery board that keeps attractive information sources nearby without demanding attention. The product discovers content and launches the original site/app in one click; it is not intended to become the primary place where all content is consumed.

The user always retains control. Do not use coercive copy, notification spam, heavy popups, or task-management-style guilt.

## Sources

Live source choices must correspond to real adapters. Never expose fake seeded content as a substitute for an adapter.

Current live adapter:

- arXiv

Planned/eligible future adapters:

- YouTube
- Wikipedia / Wikimedia feeds
- Qiita
- Zenn

NHK is explicitly removed from scope after real-use review.

## Application states

There are four actual states. Window-size presets are not states.

### Hidden

- No visible app surface.
- Automatic refresh may continue according to settings.
- Global shortcut restores Compact.

### Idle

- Normal long-lived state.
- Tiny circular translucent orb / おはじき UI, not a conventional rectangular mini-window.
- Area outside the orb is truly transparent.
- No title, source label, thumbnail, count, card, or feed rendering.
- Optional small blue boolean update dot in the upper-right.
- Clicking restores Compact.
- The resident app stays off the Windows taskbar.

### Compact

- Very small content surface.
- Shows roughly 1–3 high-priority items.
- Only currently active Board widget sources are eligible; stale cache alone is not.
- Default source priority follows Board position: top-to-bottom, then left-to-right.
- Content consumes almost all available safe area.
- One click opens the original URL/app immediately.
- After launching external content, Compact automatically collapses to Idle.

### Board

- Full discovery surface.
- Geometry uses a responsive 12×8 virtual grid; grid lines may remain invisible.
- A widget rectangle is defined by grid intersections and may use any sensible integer width/height.
- Widgets never overlap.
- Dragging snaps to grid coordinates. Colliding candidates are rejected rather than pushing neighbors.
- Every widget edge/corner is a resize target.
- Clicking unused Board space opens an add-widget flow anchored near that position.
- Board remains open after launching external content.
- Window can range from widget-like size to roughly half a desktop screen; logical layout scales with window size.

## Source-specific minimum presentation

Do not force every source into a generic card.

- **arXiv:** title-centric; author metadata is useful, images are nonessential.
- **YouTube / selected subscribed channels:** thumbnail-only can be a valid/default minimal mode once the adapter exists.
- **YouTube / recommendations:** thumbnail-first, optional small metadata.
- **Qiita / Zenn:** OGP/thumbnail-first; text fallback if unavailable.
- **Wikipedia:** image + title / daily context.

For future YouTube display density, prefer simple presets such as `minimal / standard / detailed` instead of many independent toggles. If a field requires extra API work and the active display mode does not use it, do not fetch it.

## Refresh settings

- Keep a global fallback automatic refresh interval.
- Include OFF.
- Allow source-kind defaults because useful cadence differs by source.
- Allow each widget to inherit, disable automatic refresh, or specify an override.
- Widgets sharing one canonical source instance still share one refresh/cache job; use the most eager enabled effective interval rather than duplicating network work.
- Manual refresh remains available while automatic refresh is OFF, subject to hard source cooldown/backoff.
- Normal user-facing range: about 5 minutes through 24 hours; source-specific minimum intervals may clamp the effective value.

## Manual refresh

- Refresh is primarily per-widget.
- “Refresh everything” must not be the primary interaction.
- Give immediate UI feedback that the request was queued/accepted.
- Respect source quotas, cooldowns, retry-after, and backoff.

## Settings

Use one conventional gear/settings entry for application-level configuration, including global shortcut and refresh defaults. Do not scatter unrelated top-level settings icons across the Board toolbar.

## Persistence

Persist locally:

- app settings
- window state where useful
- Board logical-grid layout
- widgets
- source/group configuration
- per-widget refresh configuration
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
- placeholder widgets that pretend unimplemented adapters work
- automatic dense packing/reflow that rearranges the user's Board

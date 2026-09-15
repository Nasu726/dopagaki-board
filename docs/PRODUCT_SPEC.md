# Product specification

## Purpose

A lightweight desktop discovery board that keeps attractive information sources nearby without demanding attention. The product discovers content and launches the original site/app in one click; it is not intended to become the primary place where all content is consumed.

The user retains control. Avoid coercive copy, notification spam, heavy popups, and task-management-style guilt.

## Live sources

Current source kinds are:

- **arXiv** — title/author-oriented paper discovery with editable query and result count.
- **Wikipedia** — random article discovery with PageImages thumbnails when available and configurable language.
- **Qiita** — public recent/query-based items with author/source metadata.
- **Zenn** — public trend/user/topic RSS feeds; text-first when the feed provides no image.
- **YouTube** — selected-channel public RSS with thumbnails and channel configuration.

The add picker exposes these working adapters and uses real source data.

YouTube RSS is the credential-free baseline. Optional Data API enrichment will use a user-supplied API key for high-value operations such as `@handle` resolution, validation, metadata enrichment, and bounded candidate discovery. OAuth/subscription-aware discovery is a later update. RSS remains usable without API credentials.

## Application states

There are four actual states. Window-size presets are not states.

### Hidden

- No visible app surface.
- Automatic refresh may continue according to settings.
- Global shortcut restores Compact.

### Idle

- Normal long-lived state.
- Tiny circular translucent orb / おはじき.
- Area outside the orb is genuinely transparent.
- No title, source label, thumbnail, count, card, or feed rendering.
- Optional small blue boolean update dot.
- Clicking restores Compact.
- The resident app stays off the Windows taskbar.

### Compact

- Very small content surface showing roughly 1–3 high-priority cached items.
- Only sources represented by current Board widgets are eligible.
- Default source priority follows Board position: top-to-bottom, then left-to-right.
- One click opens the original URL/app immediately.
- External launch collapses Compact to Idle.

### Board

- Full discovery surface on a responsive 12×8 virtual grid; grid lines may remain invisible.
- Widgets are arbitrary sensible integer rectangles, never overlap, and never push/reflow neighbors implicitly.
- Dragging snaps to grid coordinates; every edge/corner can resize.
- Clicking unused Board space opens an anchored add-source picker and places the widget in the nearest valid rectangle.
- Board remains open after launching external content.

## Source setup and presentation

Presentation is source-specific:

- arXiv is title-centric; author metadata is useful and thumbnails are not required.
- Wikipedia is image + title when an image exists, with a text fallback.
- Qiita is title/author oriented with available source imagery; text remains usable if an image is absent.
- Zenn is currently text-first because its RSS path does not guarantee images.
- YouTube is thumbnail-first with channel/author context.

A newly added YouTube widget opens source configuration immediately because useful RSS content requires a channel. Cancelling the first editor keeps the empty widget so the user can retry without recreating it. An unconfigured YouTube widget is dormant and performs no YouTube HTTP request.

For future display-density options, prefer a few meaningful presets over many independent toggles. Optional metadata/API work follows the active display mode.

## Recommendation

Recommendation/ranking is application-owned. RSS/API/OAuth broaden candidate collection; the app ranks candidates with transparent heuristics such as freshness, shown/click history, channel preference, and controlled randomness.

## Refresh settings

- Keep a global fallback automatic refresh interval, including OFF.
- Allow source-kind defaults and per-widget inherit/OFF/custom overrides.
- Widgets sharing one canonical source instance share one scheduler/cache job; use the most eager enabled effective interval.
- Manual refresh remains available while automatic refresh is OFF, subject to adapter cooldown/backoff.
- User-facing intervals are bounded to roughly 5 minutes through 24 hours; adapter-specific hard minimums clamp the effective value.

Exact resolution semantics and current source floors belong in `REFRESH_POLICY.md`.

## Settings and persistence

Use one conventional gear/settings surface for application-level configuration. Persist locally: app settings, useful window state, Board grid layout, widgets, canonical source configuration, per-widget refresh configuration, cached items, seen/click state as needed, and refresh/backoff state. Cloud is not required.

# Product specification

## Purpose

A lightweight desktop discovery board that keeps attractive information sources nearby without demanding attention. The product discovers content and launches the original site/app in one click; it is not intended to become the primary place where all content is consumed.

The user retains control. Avoid coercive copy, notification spam, heavy popups, and task-management-style guilt.

## Live sources

Current source kinds are:

- **arXiv** — title/author-oriented paper discovery with editable query and result count.
- **Wikipedia** — random article discovery with PageImages thumbnails when available and a lightweight local fallback otherwise; configurable language.
- **Qiita** — public recent/query-based items with author/source metadata and bounded best-effort article imagery.
- **Zenn** — public trend/user/topic RSS feeds with enclosure artwork when available.
- **YouTube** — selected-channel public RSS with thumbnails and ordinary channel/handle/URL configuration.

The add picker exposes these working adapters and uses real source data.

YouTube RSS is the credential-free baseline. Users may enter `@handle`, a normal supported YouTube channel URL, `/channel/UC...`, or a raw `UC...` id without configuring a Data API key. Human-facing references are resolved through the public channel surface when RSS needs the internal channel id.

Optional Data API enrichment is a later additive feature and will use a user-supplied API key only for capabilities that actually need it, such as explicit validation, useful metadata enrichment, or bounded candidate discovery. OAuth/subscription-aware discovery is later still. RSS remains usable without API credentials.

## Application states

There are four actual states. Window-size presets are not states.

### Hidden

- No visible app surface.
- Automatic refresh may continue according to settings.
- Global shortcut or resident tray controls restore the app.

### Idle

- Normal long-lived state.
- Tiny circular translucent orb / おはじき.
- Area outside the orb is genuinely transparent.
- No title, source label, thumbnail, count, card, or feed rendering.
- Optional small blue boolean update dot scoped to unseen items from currently active Board sources.
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
- Widgets are sensible integer rectangles with a current minimum of 3×2 cells, never overlap, and never push/reflow neighbors implicitly.
- Dragging snaps to grid coordinates; every edge/corner can resize in one-cell increments above the minimum.
- Board has explicit Select/Add modes. Select is the default and empty-space clicks do nothing. Add lets an empty-space click choose the target cell and open the add-source picker.
- Board remains open after launching external content.

## Source setup and presentation

Presentation is source-specific:

- arXiv is title-centric; author metadata is useful and thumbnails are not required.
- Wikipedia is image + title when PageImages supplies an image, with a local visual fallback otherwise.
- Qiita is title/author oriented; article imagery is best-effort and bounded so refresh does not become an unbounded page crawler.
- Zenn uses RSS enclosure artwork when present and remains text-usable without it.
- YouTube is thumbnail-first with channel/author context.

A newly added YouTube widget opens source configuration immediately because useful RSS content requires a channel. Cancelling the first editor keeps the empty widget so the user can retry without recreating placement. An unconfigured YouTube widget is dormant and performs no YouTube HTTP request.

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

Use one conventional gear/settings surface for application-level configuration. Widget-specific source/refresh settings use a dedicated Board-level editor so configuration does not depend on widget size.

Persist locally: app settings, useful window state, Board grid layout, widgets, canonical source configuration, per-widget refresh configuration, cached items, seen/click state as needed, and refresh/backoff state. Cloud is not required.

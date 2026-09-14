# UX and design baseline

## Core visual direction

Use light/white restrained surfaces, soft rounded geometry, minimal chrome, subtle separation only where spatially useful, and real content imagery as the main source of color. Avoid decorative gradients competing with content, excessive glassmorphism, card-within-card layouts, repeated oversized headers, heavy shadows, permanent controls that could be contextual, and decorative animation in Idle.

The governing rules are `Content > app decoration` and, where usability is preserved, `Less UI > more UI`. Real desktop feedback is the current design authority; Figma work is optional when a future visual ambiguity genuinely benefits from it.

## Idle

- Circular translucent orb / おはじき, not a square window painted with a circle.
- Pixels outside the circle are transparent.
- No content information or continuous animation.
- Optional small boolean blue update dot.
- Keep the resident app off the Windows taskbar.

## Compact

Compact surfaces a few temptations immediately.

- Roughly 1–3 items from sources represented by current Board widgets.
- Default source priority follows Board geometry: smaller `y`, then smaller `x`.
- The content itself is the click target; no intermediate detail modal.
- External launch collapses to Idle.
- Keep app-level headers and controls minimal.
- Thumbnail-centric sources may devote most of a Compact item to imagery; text-first sources remain legible without images.

## Board geometry

The Board is spatial but uses arbitrary **grid rectangles**, not arbitrary pixels.

- Responsive virtual grid: 12 columns × 8 rows; grid lines may remain invisible.
- Widget boundaries lie on grid lines and widgets may have different integer sizes.
- Widgets cannot overlap.
- Dragging snaps to grid positions.
- A colliding drag/resize candidate is rejected; keep the last valid rectangle and never push neighbors implicitly.
- Resize from every edge and corner.
- Widget contents scroll/reflow according to available area.
- Click empty space to add near the chosen cell; use the nearest free default rectangle if necessary.
- Logical layout scales with Board window size.

## Custom window chrome

The undecorated Tauri window must still behave like a familiar desktop window. The toolbar region is draggable; Compact offers collapse-to-Idle and open-Board controls; Board offers collapse-to-Idle and restore-to-Compact controls. Use familiar glyph semantics plus explicit `title`/accessible labels. Application settings belong behind one gear entry.

## Board add/config flow

1. Click empty Board space.
2. Choose a **working** source from the anchored picker.
3. The widget is created in the nearest valid free rectangle.
4. Sources with useful defaults can work immediately; sources requiring essential setup may open their widget-local editor immediately.
5. Later configuration remains available from the widget settings control.

YouTube currently uses the setup-required variant: adding it opens the channel editor. Cancelling does **not** delete the widget; the empty/dormant widget remains so the user can retry without repeating placement.

Do not expose planned-but-unimplemented sources as placeholders.

## Source presentation

### arXiv

Title-centric. A small widget may scroll; a larger widget should use the extra content area. Author metadata is useful; fake thumbnails are not.

### Wikipedia

Image + title when PageImages provides an image, with a full-width text fallback when it does not.

### Qiita

Title/author-oriented public items. Available source imagery may be used, but rendering must remain correct without it.

### Zenn

Text-first for the current public RSS implementation because images are not guaranteed by the selected feed path.

### YouTube selected channels

Thumbnail-first. The current RSS slice shows selected-channel uploads with derived YouTube thumbnails and channel/author context. A raw `UC...` ID or `/channel/UC...` URL can configure it without API credentials.

### YouTube recommendations / richer discovery

Future Data API/OAuth work may broaden candidate collection, but ranking remains app-owned. Add metadata only where it materially helps the click decision; do not turn the widget into YouTube Web.

## Refresh interaction

Every live widget has manual refresh. A click visibly acknowledges queueing. Per-widget automatic refresh can inherit a source/global default, be disabled, or override it; source hard floors/backoff remain authoritative. The settings surface owns global/source defaults, while widget-local settings own exceptions.

## Global shortcut behavior

Default: `CommandOrControl + Shift + Space`.

Expected transitions: Idle -> Compact, Compact -> Idle, Board -> Idle, Hidden -> Compact. The shortcut is configurable because global conflicts cannot be eliminated across systems/apps.

## Deletion pass

After an interaction becomes usable, remove elements until further removal harms discoverability or control. Do not preserve MVP scaffolding merely because it exists.

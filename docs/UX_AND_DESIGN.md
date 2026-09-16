# UX and design baseline

## Core visual direction

Use light/white restrained surfaces, soft rounded geometry, minimal chrome, subtle separation only where spatially useful, and real content imagery as the main source of color. Avoid decorative gradients competing with content, excessive glassmorphism, card-within-card layouts, repeated oversized headers, heavy shadows, permanent controls that could be contextual, and decorative animation in Idle.

The governing rules are `Content > app decoration` and, where usability is preserved, `Less UI > more UI`.

## Idle

- Circular translucent orb / おはじき.
- Pixels outside the circle are transparent.
- No content information or continuous animation.
- Optional small boolean blue update dot, scoped to unseen content from currently active Board sources.
- Keep the resident app off the Windows taskbar.

## Compact

Compact surfaces a few temptations immediately.

- Roughly 1–3 items from sources represented by current Board widgets.
- Default source priority follows Board geometry: smaller `y`, then smaller `x`.
- The content itself is the click target; no intermediate detail modal.
- External launch collapses to Idle.
- Keep app-level headers and controls minimal.
- Thumbnail-centric sources may devote most of a Compact item to imagery; text-first sources remain legible without images.

## Board geometry and modes

The Board uses responsive **12×8 logical grid rectangles**.

- Widget boundaries lie on integer grid lines and widgets may have different sizes.
- Current minimum widget size is **3 columns × 2 rows**.
- Widgets cannot overlap.
- Dragging snaps to grid positions.
- A colliding drag/resize candidate is rejected; keep the last valid rectangle and never push neighbors implicitly.
- Resize from every edge and corner in one-cell increments above the minimum.
- Widget contents scroll/reflow according to available area.
- Logical layout scales with Board window size.

Board has two explicit interaction modes:

- **Select** — default. Widget content/actions, move, resize, configuration, refresh, and delete work normally. Empty-space clicks do nothing.
- **Add** — empty-space click chooses a placement cell and opens the anchored source picker. Existing widget actions are inert. Add success or Cancel returns to Select.

## Custom window chrome

The undecorated Tauri window behaves like a familiar desktop window. Compact and Board share a visible draggable toolbar region. Compact offers collapse-to-Idle and open-Board controls; Board offers collapse-to-Idle and restore-to-Compact controls. Use familiar glyph semantics plus explicit `title`/accessible labels. Application settings belong behind one gear entry.

The declarative Tauri drag region remains present, with one explicit native drag fallback because Windows real-device testing found the declarative path unreliable on its own. Widget controls must never trigger whole-window dragging.

## Board add/config flow

1. Switch from Select to Add.
2. Click unused Board space to choose the placement cell.
3. Choose a working source from the anchored picker.
4. The widget is created in the nearest valid free rectangle and Board returns to Select.
5. Sources with useful defaults work immediately; sources requiring essential setup may open the dedicated Board-level widget editor immediately.
6. Later configuration remains available from the widget settings control.

YouTube uses the setup-required variant: adding it opens the channel editor. Cancelling keeps the empty/dormant widget so the user can retry without repeating placement.

## Source presentation

### arXiv

Title-centric. A small widget may scroll; a larger widget should use the extra content area. Author metadata is useful.

### Wikipedia

Image + title when PageImages provides an image. A lightweight local visual keeps no-image rows balanced; text remains usable if imagery fails.

### Qiita

Title/author-oriented public items. Current article OGP enrichment is best-effort and bounded to avoid turning refresh into an unbounded page crawl. Rendering remains correct without imagery.

### Zenn

Use RSS enclosure artwork when present, with a text fallback when the feed provides no image.

### YouTube selected channels

Thumbnail-first. Selected-channel RSS is the no-key baseline. Ordinary `@handle`, supported channel URLs, `/channel/UC...`, and raw `UC...` ids are accepted without Data API configuration. Human-facing references may be resolved through the public channel page before RSS fetch.

### YouTube recommendations / richer discovery

Future Data API/OAuth work may broaden candidate collection. Add API work or metadata only where it materially helps discovery/click decisions and keep quota/background work bounded.

## Refresh interaction

Every live widget has manual refresh. A click visibly acknowledges queueing. Per-widget automatic refresh can inherit a source/global default, be disabled, or override it; source hard floors/backoff remain authoritative. The settings surface owns global/source defaults, while the dedicated widget editor owns widget exceptions.

## Global shortcut behavior

Default: `CommandOrControl + Shift + Space`.

Expected transitions: Idle -> Compact, Compact -> Idle, Board -> Idle, Hidden -> Compact. The shortcut is configurable because global conflicts cannot be eliminated across systems/apps. Native tray controls provide an additional resident recovery/control path.

## Deletion pass

After an interaction becomes usable, remove elements and implementation residue until further removal harms discoverability, correctness, accessibility, or maintainability. Fold one-off patch layers into their durable owner once behavior stabilizes, and remove MVP scaffolding that no longer serves a current interaction.

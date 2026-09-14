# UX and design baseline

## Core visual direction

Use:

- light / white restrained surfaces
- soft rounded geometry
- modern but quiet visual language
- minimal app chrome
- subtle elevation/separation only when spatially useful
- content imagery as the main source of visual color
- fixed safe areas with small padding and large content surfaces

Avoid:

- decorative gradients competing with content
- excessive glassmorphism
- card-within-card layouts
- repeated oversized source headers
- heavy shadows
- permanent controls that could appear contextually
- decorative animation, especially in Idle

The governing rules are `Content > app decoration` and, where usability is preserved, `Less UI > more UI`.

Real desktop feedback is the current design authority. Figma work is optional and should be used only if a future visual ambiguity benefits from it.

## Idle

- Circular translucent orb / おはじき.
- Not a rectangular mini-window and not a circular picture painted onto an opaque square.
- Window pixels outside the circle are transparent.
- No content information.
- Optional small blue update dot at upper-right.
- Badge is boolean by default, not an unread count.
- No continuous animation.
- Keep the resident application off the Windows taskbar.

## Compact

Compact exists to surface a few temptations immediately.

- Roughly 1–3 items.
- Only sources represented by current Board widgets are eligible.
- Default priority follows Board geometry: smaller `y` first, then smaller `x`.
- The content itself is the click target.
- No intermediate detail modal.
- After launching external content, collapse immediately to Idle.
- Keep app-level headers and controls to the absolute minimum.

For thumbnail-centric future sources, almost the whole Compact item may be imagery. arXiv remains title-centric.

## Board geometry

The free-pixel MVP was revised after the first Windows usability test. The Board is spatial, but spatial freedom is expressed through **arbitrary grid rectangles**, not arbitrary pixels.

- Responsive virtual grid: 12 columns × 8 rows.
- Grid lines may remain visually hidden.
- Widget boundaries always lie on grid lines.
- Widgets may have different integer widths/heights; this is not a same-size card dashboard.
- Widgets cannot overlap.
- Dragging snaps to grid positions.
- If a drag/resize candidate would collide, keep the last valid rectangle. Do not push or auto-reflow neighbors.
- Resize from every edge and corner.
- Widget contents reflow/scroll according to the resulting available area.
- Click empty space to create at/near the chosen cell; choose the nearest free rectangle if the default size does not fit there.
- The logical layout scales when the Board window changes size.

This preserves user-authored spatial relationships while eliminating accidental overlap and hard-to-align free pixels.

## Custom window chrome

The undecorated Tauri window must still behave like a familiar desktop window.

- Title/quiet toolbar region is draggable.
- Compact offers minimize-to-Idle and maximize-to-Board controls.
- Board offers minimize-to-Idle and restore-to-Compact controls.
- Use familiar glyph semantics and explicit `title`/accessible labels.
- Application settings are behind one gear button rather than several unrelated toolbar icons.

## Board add flow

Preferred interaction:

1. click empty Board area
2. small anchored picker appears
3. choose a **working** source type
4. provide only source-specific minimum setup
5. widget appears in the nearest valid free grid rectangle

Do not expose planned-but-unimplemented source types as placeholder widgets.

## Source presentation

### arXiv

Title-centric. Show enough cached results to match the source configuration; a small widget may scroll, while a larger widget should reflow into more usable space. Author metadata is useful; fake thumbnails are not.

### YouTube selected/subscribed channel (future)

Thumbnail-first. A minimal mode may be thumbnail only, but only after a real adapter/auth strategy exists.

### YouTube recommendation (future)

Thumbnail-first. Add metadata only where it materially helps decide whether to click.

### Qiita / Zenn (future)

OGP/thumbnail may serve as the entire card when it already contains recognizable title/author information. Provide text fallback if image fetch fails.

### Wikipedia (future)

Image + title / daily context.

NHK is not part of the source plan.

## Refresh interaction

- Every live widget has manual refresh.
- A click should visibly acknowledge queueing instead of looking inert.
- Per-widget automatic interval can inherit a source/global default, be disabled, or override it.
- Application settings define global/source defaults; widget-local settings define exceptions.
- Source hard rate limits remain authoritative even when UI asks for a shorter interval.

## Global shortcut behavior

Default: `CommandOrControl + Shift + Space`.

Expected transitions:

- Idle -> Compact
- Compact -> Idle
- Board -> Idle
- Hidden -> Compact

Shortcut must be user-configurable because global conflicts cannot be eliminated across all systems/apps. Shortcut configuration belongs in the shared gear/settings surface.

## Deletion pass

After an interaction becomes usable, remove elements until further removal harms discoverability or control. Do not preserve MVP scaffolding merely because it already exists.

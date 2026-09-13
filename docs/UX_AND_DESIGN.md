# UX and design baseline

## Core visual direction

The approved visual baseline is the second concept mock from the initial design discussion.

Use:

- light / white restrained surfaces
- soft rounded geometry
- modern but quiet visual language
- minimal app chrome
- subtle elevation/separation only when spatially useful
- content imagery as the main source of visual color
- fixed safe areas with small padding and large content surfaces

Avoid:

- decorative gradients competing with thumbnails
- excessive glassmorphism
- card-within-card layouts
- repeated oversized source headers
- heavy shadows
- permanent controls that could appear contextually
- decorative animation, especially in Idle

The governing rule is:

`Content > app decoration`

and, when usability is preserved:

`Less UI > more UI`

## Geometry-first design process

When refining in Figma or implementation, work in this order:

1. Idle orb diameter and practical hit area
2. Compact outer geometry
3. safe area / padding
4. one-item layout
5. two-item layout
6. three-item layout
7. Board canvas behavior
8. widget resize/selection/add affordances
9. typography
10. radius/shadow/opacity
11. animation only if still useful

Do not start by polishing color or iconography before geometry is stable.

## Idle

- Circular orb / おはじき.
- Not a rectangular mini-window.
- No content information.
- Optional small blue update dot at upper-right.
- Badge is boolean by default, not an unread count.
- No continuous animation.

Exact diameter is intentionally open until tested at realistic desktop scale.

## Compact

Compact exists to surface a few temptations immediately.

- Roughly 1–3 items.
- The content itself is the click target.
- No intermediate detail modal.
- After launching external content, collapse immediately to Idle.
- Keep app-level headers and controls to the absolute minimum.

For thumbnail-centric sources, it is acceptable for almost the whole Compact window to be imagery.

## Board

The Board is a spatial canvas, not a dashboard template.

Requirements:

- arbitrary widget position
- arbitrary widget size within sensible limits
- optional light snapping only as assistance
- no forced packing or mandatory rows/columns
- click empty space to add a widget at/near that location
- minimal persistent toolbar/chrome
- show resize/selection controls contextually on hover/focus/selection where possible

The user should feel that they place information where they want it, not that the application rearranges them into a layout.

## Board add flow

Preferred lightweight interaction:

1. click empty Board area
2. small anchored source/widget picker appears
3. choose source/type
4. provide only source-specific minimum setup
5. widget appears at/near clicked point

Do not force navigation to a separate management page.

## Source presentation

### YouTube selected/subscribed channel

Default minimal presentation may be thumbnail only. The user already selected the source and may not need title or duration.

### YouTube recommendation

Thumbnail-first. Add metadata only where it materially helps decide whether to click.

### Qiita / Zenn

OGP/thumbnail may serve as the entire card when it already contains recognizable title/author information. Provide text fallback if image fetch fails.

### arXiv

Title-centric. Images are secondary/nonessential.

### NHK

Image + headline is a reasonable default.

### Wikipedia

Image + title / daily context.

## Global shortcut behavior

Initial candidate: `CommandOrControl + Shift + Space`.

Expected transitions:

- Idle -> Compact
- Compact -> Idle
- Board -> Idle
- Hidden -> Compact

Shortcut must be user-configurable because global conflicts cannot be eliminated across all systems/apps.

## Design comparison sheet

The first Figma design sheet should compare at realistic desktop scale:

1. Idle orb, no update
2. Idle orb, update dot
3. Compact, 1 item
4. Compact, 2 items
5. Compact, 3 items
6. Board, small window
7. Board, wide window
8. Board, half-screen
9. Board, empty-space add interaction

After the first visually attractive version, perform a deletion pass: remove elements until further removal harms discoverability or usability.

# Active work checkpoint

This file is the short-horizon execution log for the currently active development stream. It exists so work can be resumed after a ChatGPT/client interruption without reconstructing state from chat history. Keep `docs/HANDOFF.md` for durable project knowledge; keep this file current while a multi-PR implementation stream is active.

Last updated: 2026-09-15

## Working protocol

The ChatGPT client can mistake a long uninterrupted tool sequence for a hang. Work in short, bounded batches and return a user-visible checkpoint between them.

Recommended batch size:

- one small implementation/fix objective at a time
- usually 1–3 commits before a checkpoint
- do not sit in a long polling loop waiting for all CI; inspect at logical checkpoints
- before ending a batch, record what changed, what was verified, what failed, and the exact next action here
- after any interruption, inspect GitHub state first; do not trust an old local/chat assumption about branch, PR, or CI state

## User review / product constraints already established

Preserve these product decisions while continuing development:

- Board geometry is a logical 12 x 8 grid, not arbitrary pixel persistence.
- Widgets may be placed in user-selected cells and resized from all edges/corners.
- Widgets must not overlap; placement/resize should remain collision-aware.
- Geometry persistence happens at gesture end, not on every pointer move.
- Compact content is sourced from the active Board/cache state rather than an independent fake/demo feed.
- Expose only source kinds backed by a real adapter. Do not add placeholder source panels.
- NHK was intentionally removed from scope.
- Idle should remain a transparent, taskbar-free lightweight surface.
- Settings are consolidated rather than scattered across unrelated controls.
- Refresh policy is source-aware and may also be overridden per widget. Manual refresh remains available when automatic refresh is OFF.
- A shared source instance is `(source_kind, canonical source_config_json)`; widgets sharing one source/config share cache and scheduler work.
- Background cache updates should rehydrate only affected widget content and must not rebuild the whole Board.
- Do not fabricate CPU/RSS/startup numbers. Use `docs/PERF_BASELINE.md` for measured observations.
- Figma is not part of the current implementation path unless visual direction becomes ambiguous again.

## Completed immediately before this active branch

PR #50 (`windows-usability-pass`) was merged to `main` at merge commit `965698055ed875be88a7a77c5428d04567e4a849`.

PR #51 (`refresh-policy-ui`) was then merged to `main` at merge commit `87a0e74ddfceab4619fad19b20e7145587c87ea7`.

Together they established the confirmed 12x8 responsive Board, Windows shell/usability pass, first real Windows performance observation, source-aware backend refresh policy, per-source Settings controls, and per-widget arXiv refresh policy UI. Linux, Windows, and macOS CI were green before those merges.

## Current active PR

PR #52: `Ship real Wikipedia, Qiita, Zenn and YouTube source adapters`

- base: `main`
- head branch: `real-source-adapters-clean`
- PR is intentionally still a draft
- related issue: #48

The branch has backend adapters for four real public sources behind the existing scheduler/cache/source-key boundary:

### Wikipedia

- public MediaWiki API
- random-article discovery
- PageImages thumbnail support where available
- config: `language` + bounded `maxResults`

### Qiita

- public items API
- optional query configuration
- bounded `maxResults`
- payload retains useful source metadata such as likes count

### Zenn

- public RSS feeds
- trend/user/topic source selection
- bounded result count

### YouTube

- selected-channel public RSS
- channel ID configuration
- thumbnail-first cached rows

### Runtime integration

- one reusable public `reqwest` client is shared by the public adapters
- runtime dispatch routes source work to arXiv/Wikipedia/Qiita/Zenn/YouTube
- source-specific automatic-refresh floors live in the source policy layer
- no placeholder source is intentionally exposed
- NHK remains absent

## Latest short checkpoint: Wikipedia, Qiita, and Zenn frontend slices complete

The first substantive #52 CI regression was a stale unit test, not production behavior. Commit `1dd692beaf1f55342bee6269cfe3154907a4cf18` updates `source_validation_only_accepts_live_adapters` so all five real backend adapters are accepted while `nhk` and unknown kinds remain rejected.

### Wikipedia

Commit `cc049e673614353f8f7849d93acf35cec1ab9de7` exposes Wikipedia end-to-end:

- add picker exposure
- typed `language` + `maxResults` editor
- source edits through `update_widget_source_config`
- inherit/OFF/custom refresh controls + manual refresh
- backend >= 6 h automatic refresh floor surfaced in UI
- narrow source/widget rehydration after save

Commit `e57331ee437cd7220a8bf53483d951bd1c848de1` fixes the Board row layout for sources that may have no thumbnail. Board rows are flex-based so an optional image occupies fixed space while text consumes the remaining/full width.

### Qiita

Commit `eba91dc219b9444ce7d3e159b551b4eebb4fe1b2` exposes Qiita:

- add picker exposure
- typed `query` + `maxResults` editor
- empty query means recent public items; helper example `tag:Python`
- query bounded by the adapter contract and `maxResults` 1..25
- inherit/OFF/custom refresh controls + manual refresh
- backend >= 1 h automatic refresh floor surfaced in UI
- arXiv/Qiita share a query-source editor path instead of duplicating the whole form

### Zenn

Commit `cb747115e29a93d5dcd17369c0c6edfe9f84eb92` exposes Zenn:

- add picker exposure
- typed feed selector: `trend`, `user`, or `topic`
- trend needs no value; user/topic expose a value field
- user/topic value is bounded to 80 chars in UI while Rust remains authoritative for the safe-slug rule
- `maxResults` 1..25
- inherit/OFF/custom refresh controls + manual refresh
- backend >= 1 h automatic refresh floor surfaced in UI
- duplicated per-widget refresh-form construction was extracted into one helper shared by arXiv/Qiita/Wikipedia/Zenn

On `cb747115...`, macOS already passed the frontend production build before this documentation checkpoint and was running Rust tests. Linux/Windows/macOS workflows were all active. Later documentation commits create newer heads, so inspect the current PR head rather than treating that intermediate run as final merge evidence.

## Deliberate YouTube stop point

Do **not** expose YouTube in the add picker yet.

The backend currently implements selected-channel public RSS (`https://www.youtube.com/feeds/videos.xml?channel_id=...`) with:

- `channelId` configuration
- `maxResults` 1..15
- thumbnail-first rows via `i.ytimg.com`
- automatic refresh floor 1 h
- no YouTube Data API key and therefore no Data API quota consumption

However, `docs/DECISIONS.md` still lists `exact YouTube authentication/quota strategy before exposing that adapter` as an open question, and Issue #48 requires an explicit quota/auth design before YouTube exposure. Treat this as a genuine product-decision gate, not as permission to silently expose the existing RSS implementation.

The decision to settle with the user is whether the public-RSS design itself is the final authentication/quota strategy (no auth, no Data API quota, explicit channel ID supplied by the user) or whether a different authenticated/subscription-based design is required.

## What is deliberately NOT complete in PR #52 yet

Do not merge #52 yet. Remaining work is:

1. settle the YouTube authentication/quota strategy and update `docs/DECISIONS.md`
2. only if public RSS or another concrete strategy is approved, expose YouTube with a typed frontend config/manual-refresh slice
3. Linux, Windows, and macOS release-build CI green on the final merge candidate
4. real desktop smoke test of the new source UIs/network presentation when a desktop session is available
5. final durable documentation/PR-body reconciliation before merge

Wikipedia, Qiita, and Zenn are no longer in the remaining implementation list.

## Next short batch

1. Inspect CI attached to the current PR #52 head. Fix any substantive regression before expanding scope.
2. Ask/resolve the YouTube policy gate: whether selected-channel public RSS with no auth/API quota is the intended final strategy.
3. If approved, record the decision in `docs/DECISIONS.md`, then implement **YouTube only** with `channelId` + `maxResults` and the existing refresh/manual/narrow-rehydration boundaries.
4. Re-run Linux/Windows/macOS CI, perform available desktop smoke testing, reconcile docs/PR body, and only then consider PR #52 ready for review/merge.

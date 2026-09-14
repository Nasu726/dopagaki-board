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
- YouTube Data API follow-up: #53

The branch has backend adapters for four additional real public sources behind the existing scheduler/cache/source-key boundary:

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
- empty/unconfigured channel config is a dormant source rather than a refresh failure

### Runtime integration

- one reusable public `reqwest` client is shared by the public adapters
- runtime dispatch routes source work to arXiv/Wikipedia/Qiita/Zenn/YouTube
- source-specific automatic-refresh floors live in the source policy layer
- no placeholder source is intentionally exposed
- NHK remains absent

## Frontend slices

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

### YouTube RSS

The product gate was resolved in `docs/DECISIONS.md` at commit `0dbfa6794eece7b7abeea0d927a2795482fdc069`.

Commit `2391af482cfbab8ae443f860d1c1d33ccf0abe07` makes an empty YouTube `channelId` a dormant source that returns no rows instead of recording a failed refresh/backoff. This supports the add-first/configure-immediately UX cleanly.

Commit `1cec7217a714daff22d457f5323952eb82fd98f2` exposes YouTube RSS in the Board:

- YouTube appears in the add picker
- a newly added YouTube widget opens its config editor immediately
- typed `channelId` + `maxResults` editor, with `maxResults` 1..15
- accepts a raw `UC...` channel ID or extracts the ID from a `/channel/UC...` URL with no additional network request
- concise help explains that RSS itself needs no API key and `@handle` resolution belongs to optional Data API work under #53
- inherit/OFF/custom refresh controls + manual refresh
- backend >= 1 h automatic refresh floor surfaced in UI
- save continues through the Rust-authoritative source config command and narrow widget rehydration path

The reconciled pre-YouTube head `e945e84dd762a41a6d09ebac217025a228893363` passed Linux, Windows, and macOS CI. CI for `1cec7217...` started on all three OSes; inspect the actual current PR head before merge because later documentation commits may create newer runs.

## YouTube API/OAuth rollout decision

Use this rollout:

1. **RSS baseline now:** selected-channel public RSS, `channelId`, thumbnail-first rows, `maxResults` 1..15, >= 1 h automatic-refresh floor. No API key is required for this path.
2. **Data API incrementally after the practical RSS slice:** users supply their own API key; never embed a shared key. Use API calls selectively for high-value work such as `@handle` -> channel resolution, channel validation, visible/cached metadata enrichment, and bounded recommendation candidate discovery. RSS remains the fallback.
3. **OAuth later:** after the practical non-OAuth version is complete, add a guided few-click OAuth setup and authenticated features such as subscription-aware discovery.

Recommendation/ranking remains application-owned. Do not assume YouTube Data API exposes the user's current Home recommendation feed; candidate collection and the existing transparent heuristic layer are separate concerns.

Issue #53 tracks the optional Data API/API-key/OAuth progression.

## What is deliberately NOT complete in PR #52 yet

Do not merge #52 yet. Remaining work is:

1. Linux, Windows, and macOS release-build CI green on the final merge candidate
2. real desktop smoke test of the new source UIs/network presentation when a desktop session is available
3. reconcile `docs/HANDOFF.md` and PR #52 body to the final YouTube implementation/CI result
4. then move PR #52 out of draft and merge only when the above evidence is satisfactory

Wikipedia, Qiita, Zenn, and the RSS-only YouTube frontend slice are no longer in the implementation list. Data API enrichment and OAuth belong to #53, not the #52 merge gate.

## Next short batch

1. Inspect CI for the current code head and fix any substantive failure.
2. Reconcile `docs/HANDOFF.md` with the completed YouTube RSS frontend behavior and the #53 follow-up plan.
3. Update PR #52 body with the final implementation and CI evidence.
4. Perform the available desktop smoke test; if a real desktop session is unavailable in the current environment, leave that limitation explicit rather than inventing a result.

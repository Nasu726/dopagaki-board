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
- trend/user/topic style source selection
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

## Latest short checkpoint: Wikipedia frontend complete, final CI pending

The first substantive #52 CI regression was a stale unit test, not production behavior. Commit `1dd692beaf1f55342bee6269cfe3154907a4cf18` updates `source_validation_only_accepts_live_adapters` so all five real adapters are accepted while `nhk` and unknown kinds remain rejected.

Commit `cc049e673614353f8f7849d93acf35cec1ab9de7` implements the first bounded frontend source slice:

- add picker now exposes `arxiv` and `wikipedia`
- Wikipedia gets a dedicated widget editor for `language` and `maxResults`
- source edits go through `update_widget_source_config`; Rust validation/canonicalization remains authoritative
- Wikipedia gets inherit/OFF/custom per-widget automatic-refresh controls
- UI explains the backend >= 6 h automatic refresh floor
- manual refresh is available even when automatic refresh is OFF
- successful edits update only the affected widget and rehydrate only its source/config identity
- arXiv was refactored to share the save plumbing without changing its typed UI

Validation on that commit reached:

- Linux frontend build: success
- Linux rustfmt: success
- Linux locked dependency check: success
- Linux Rust tests: success
- Linux Rust check: success
- Linux Tauri release build had started when the next presentation fix was committed
- Windows frontend build: success; Rust tests had started
- macOS frontend build: success; Rust tests had started

A presentation review then found a real image/no-image issue in the pre-existing Board row CSS: the fixed two-column grid could leave title content in the narrow first column when no thumbnail existed. Commit `e57331ee437cd7220a8bf53483d951bd1c848de1` switches Board rows to flex layout so an optional 46px image occupies fixed space and text consumes the full remaining width; rows without images use the full row.

`docs/HANDOFF.md` was then updated in commit `17b5d75681b3e09da4329e824a6ced05bde881b0`. This `ACTIVE_WORK.md` commit creates the newest head again. Therefore **only CI attached to the current PR #52 head counts as final validation**. Do not poll obsolete run IDs or treat intermediate green steps as merge evidence.

## What is deliberately NOT complete in PR #52 yet

Do not merge #52 yet. Remaining work is:

1. Linux, Windows, and macOS release-build CI green on the current final head
2. Qiita frontend add/config/manual-refresh slice
3. Zenn frontend add/config/manual-refresh slice
4. YouTube frontend add/config/manual-refresh slice
5. real desktop smoke test of the new source UIs/network presentation when a desktop session is available
6. final durable documentation/PR-body reconciliation before merge

Wikipedia itself is no longer in the remaining implementation list. Qiita, Zenn, and YouTube intentionally remain hidden from the add picker until their typed configuration UIs exist.

## Next short batch

1. Inspect CI attached to the current PR #52 head. If a substantive failure exists, fix only that failure first.
2. If the current head is green through frontend/Rust validation and progressing normally through release builds, begin **Qiita only**:
   - add Qiita to the add picker
   - expose `query` + `maxResults` from the actual adapter contract
   - keep Rust-side normalization/validation authoritative
   - expose manual refresh and the existing per-widget refresh policy UI
   - preserve narrow widget-only rehydration after save
3. Re-run the normal three-platform CI and checkpoint this file before starting Zenn.
4. Do not implement Qiita, Zenn, and YouTube configuration UIs in one uninterrupted batch.

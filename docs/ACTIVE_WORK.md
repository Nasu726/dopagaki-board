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

The branch currently adds the backend adapter slice for four real public sources, behind the existing scheduler/cache/source-key boundary:

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

## Latest short checkpoint: first substantive CI failure repaired

The formatter failure from the first #52 attempt was repaired earlier by commit `fdf90be73eeaa868ee0510ff3f657cca7fdf4fc3`.

The next PR head (`8471f60281d368987f84ca86b7e062f3a922a437`) reached Rust tests on all platforms. Linux showed one substantive failure after 63 tests passed:

`commands::tests::source_validation_only_accepts_live_adapters`

The test still asserted that `youtube` must be rejected even though YouTube is now a real backend adapter. This was stale test data, not a production validation defect.

Commit `1dd692beaf1f55342bee6269cfe3154907a4cf18` repairs the regression test:

- accepts `arxiv`, `wikipedia`, `qiita`, `zenn`, and `youtube`
- still rejects `nhk`
- also rejects an unknown source kind

A fresh Linux/Windows/macOS CI cycle started successfully after that fix. While it was running, `docs/HANDOFF.md` was reconciled with current `main`, PR #52, and the already-recorded Windows performance observation in commit `31f97f08d82406d35a2fd5af883bdd51df28a635`.

This document update creates a newer head again, so do **not** keep polling the old run IDs. Inspect the CI attached to the current PR #52 head after this commit.

## What is deliberately NOT complete in PR #52 yet

Do not merge #52 just because the backend compiles. Before merge it still needs:

1. frontend add-picker exposure for the newly real adapters
2. real source-specific widget configuration surfaces; no generic JSON editor
3. source-aware config validation through the existing Rust command boundary
4. manual refresh controls for each exposed real adapter
5. Board presentation check for image/no-image rows
6. durable decisions/docs where semantics changed
7. Linux, Windows, and macOS CI green on the final merge candidate

The current frontend still has `ADDABLE_SOURCE_KINDS = ["arxiv"]`, and the contextual source editor currently handles only arXiv. That remains intentional until each new adapter's real fields are exposed cleanly.

## Next short batch

1. Inspect CI on the **current** PR #52 head. If another substantive failure exists, fix only that failure first.
2. If backend CI is green through Rust tests/build, implement the Wikipedia frontend slice only:
   - add Wikipedia to the add picker
   - expose widget-local `language` and `maxResults`
   - use `update_widget_source_config` so Rust's Wikipedia adapter remains authoritative for validation
   - expose manual refresh for Wikipedia
   - preserve narrow widget-only rehydration after save
   - verify rows remain usable with and without thumbnails
3. Run frontend build/type validation and the normal three-platform CI before moving to Qiita.
4. Checkpoint this file again before starting the next source. Do not implement all four frontend configuration UIs in one uninterrupted batch.

# Active work checkpoint

This file is the short-horizon execution log for the currently active development stream. It exists so work can be resumed after a ChatGPT/client interruption without reconstructing state from chat history. Keep `docs/HANDOFF.md` for durable project knowledge; keep this file current while a multi-PR implementation stream is active.

Last updated: 2026-09-14

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
- Do not fabricate CPU/RSS/startup numbers. Real desktop performance measurements remain a separate validation step.
- Figma is not part of the current implementation path unless visual direction becomes ambiguous again.

## Completed immediately before this active branch

PR #50 (`windows-usability-pass`) was merged to `main` at merge commit `965698055ed875be88a7a77c5428d04567e4a849`.

That pass established the practical Windows-oriented shell/Board behavior and the backend portion of source-aware refresh policy. Its CI had an earlier Linux rustfmt failure during development, but the merge candidate was brought green before merge.

PR #51 (`refresh-policy-ui`) was then completed and merged to `main` at merge commit `87a0e74ddfceab4619fad19b20e7145587c87ea7`.

PR #51 completed Issue #47's user-facing refresh controls:

- global Settings exposes per-source refresh defaults: inherit global / OFF / custom interval
- arXiv widget settings expose inherit source default / OFF / custom interval
- Rust remains authoritative for persisted policy and adapter hard minimums
- arXiv automatic refresh remains clamped to >= 24 h even if the UI selects a shorter custom interval
- manual refresh still works while automatic refresh is OFF
- the frontend edits policy only; source-instance scheduling semantics remain backend-owned
- Linux, Windows, and macOS CI were all green before merge

## Current active PR

PR #52: `Ship real Wikipedia, Qiita, Zenn and YouTube source adapters`

- base: `main`
- head branch: `real-source-adapters-clean`
- current recorded head before the next fix: `089c8844b27a73d667003ac8c4e0ce92ccad6821`
- PR is intentionally still a draft
- related issue: #48

The branch currently adds the backend adapter slice for four real public sources, behind the existing scheduler/cache/source-key boundary:

### Wikipedia

- uses the public Wikipedia API
- random-article discovery
- PageImages thumbnail support where available
- cache rows use the existing source-scoped cache representation

### Qiita

- uses the public items API
- optional query configuration
- bounded `maxResults`
- payload keeps source metadata such as likes count for future presentation needs

### Zenn

- RSS-backed feeds
- supports trend/user/topic style source selection
- bounded result count

### YouTube

- selected-channel RSS feed
- channel ID configuration
- thumbnail-first cached rows

### Runtime integration

- one reusable public `reqwest` client is shared by these public adapters
- runtime dispatch now routes refresh work by source kind to arXiv/Wikipedia/Qiita/Zenn/YouTube adapters
- source-specific automatic-refresh floors are defined in the source policy layer
- no placeholder source is intentionally exposed
- NHK remains absent

## Current CI state / failure

The first CI run for PR #52 reached frontend production build successfully. Linux and macOS then failed at Rust formatting; this is a formatting-only failure, not yet a compile/test verdict for the new adapters because later Rust steps were skipped after `cargo fmt --check` failed.

Linux run: `34842948897`.

Exact rustfmt changes reported by CI:

- `src-tauri/src/runtime.rs`
  - format the Qiita and Zenn match arms as multiline blocks
  - remove an extra trailing blank line at EOF
- `src-tauri/src/sources/mod.rs`
  - remove an extra trailing blank line at EOF
- `src-tauri/src/sources/qiita.rs`
  - wrap the long `maxResults` error `format!` expression
  - remove an extra trailing blank line at EOF
- `src-tauri/src/sources/wikipedia.rs`
  - remove an extra trailing blank line at EOF
- `src-tauri/src/sources/youtube.rs`
  - rustfmt the long `channel_id.chars().all(...)` conditions
  - remove an extra trailing blank line at EOF
- `src-tauri/src/sources/zenn.rs`
  - wrap the long `maxResults` error `format!` expression
  - wrap the long external URL assertion
  - remove an extra trailing blank line at EOF

Windows was still running when the formatting failure was inspected; because Linux/macOS already prove the branch needs a new commit, do not wait on that stale head before fixing formatting.

## What is deliberately NOT complete in PR #52 yet

Do not merge #52 after merely fixing rustfmt. The PR body correctly states it is still WIP. Before merge, it still needs:

1. frontend add-picker exposure for the newly real adapters
2. real source-specific widget configuration surfaces (no fake generic JSON editor)
3. source-aware config validation wired through the existing Rust command boundary
4. Board presentation checked for image/no-image rows for these source kinds
5. durable documentation in `docs/HANDOFF.md` / decisions where appropriate
6. Linux, Windows, and macOS CI green on the final merge candidate

The current frontend still has `ADDABLE_SOURCE_KINDS = ["arxiv"]`, and the contextual source editor currently handles only arXiv. That is intentional until each new adapter's real fields are exposed cleanly.

## Next short batch

Apply only the rustfmt changes listed above, push them to `real-source-adapters-clean`, and confirm a new CI run starts. Do not wait through a long CI cycle in the same uninterrupted batch. After that checkpoint, the following batch should implement frontend configuration/add-picker exposure source by source, starting with the simplest adapter rather than changing all four at once.

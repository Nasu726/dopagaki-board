# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-15

## Current checkpoint

Merged to `main` through PR #51. Important milestones include:

- PR #12: free-placement Board
- PR #16: configurable global shortcut + Rust-owned Idle badge
- PR #17: Linux Idle performance baseline tooling
- PR #18: independent Linux / Windows / macOS CI
- PR #19: cache-first SQLite data layer + deterministic scheduler core
- PR #22: cache-driven Compact/Board presentation + automatic-refresh slider
- PR #24: schema-v4 source-scoped cache identity + canonical source configuration
- PR #26: event/deadline-driven refresh runtime + first real arXiv adapter
- PR #27: current `src-tauri/Cargo.lock` + `--locked` Rust CI on Linux/Windows/macOS
- PR #34: first post-runtime deletion/simplification pass
- PR #38: committed frontend lockfile + `npm ci` across Linux/Windows/macOS CI
- PR #40: editable validated arXiv widget source settings + contextual Board editor
- PR #50: confirmed responsive 12x8 Board grid, overlap prevention, eight-direction resizing, source ordering, Windows shell/usability pass, and first real Windows performance observation
- PR #51: source-aware refresh defaults and per-widget refresh policy UI

The product is past the first functional MVP checkpoint. Idle / Compact / Board, cache-first presentation, event-driven refresh, real arXiv fetching, manual/automatic refresh, contextual source editing, responsive integer-grid placement, and source-aware refresh controls are on `main`.

### Active branch / PR

There is one active product branch:

- branch: `real-source-adapters-clean`
- draft PR: #52, `Ship real Wikipedia, Qiita, Zenn and YouTube source adapters`
- parent issue: #48

PR #52 currently has real backend adapters for:

- Wikipedia: public MediaWiki API, random article generator, PageImages thumbnails
- Qiita: public items API with optional query
- Zenn: public RSS for trend / user / topic feeds
- YouTube: selected-channel public RSS with thumbnail-first cache rows

The branch also centralizes a reusable public HTTP client and source-specific automatic-refresh floors. There are no placeholder sources and NHK remains explicitly out of scope.

The frontend has **not** yet exposed the new adapters. `ADDABLE_SOURCE_KINDS` still contains only `arxiv`, and the contextual source editor is still arXiv-specific. This is intentional until each adapter has a real typed configuration surface. The next frontend slice should start with Wikipedia only (`language` + `maxResults`), validate through the existing Rust command, and then proceed source-by-source.

A previous PR #52 head failed all three OS CI jobs for one stale test: `commands::tests::source_validation_only_accepts_live_adapters` still expected YouTube to be unsupported. Commit `1dd692b` updates that regression test to accept the five live backend adapters and reject `nhk` / unknown kinds. Re-run Linux/Windows/macOS CI is pending on the active branch; inspect current GitHub state rather than assuming this note is still current.

Maintenance note: old stacked PR #39 was superseded by clean PR #41. Accidental duplicate Issues #29-#33 were created during tool setup and immediately closed as not planned.

The repository is public. Standard GitHub-hosted Actions are no longer constrained by the former private-repository monthly minute quota, but CI latency and reproducibility still matter.

## Public repository / ruleset note

The repository visibility changed from private to public on 2026-09-14 after the account approached its private GitHub Actions minute quota.

A ruleset named `main protection` was added by the user. Earlier inspection indicated a broad `~ALL` branch target rather than main-only targeting; if that remains true, deletion/non-fast-forward restrictions may also affect feature branches. Treat actual GitHub ruleset state as authoritative.

## CI working rule

Windows/macOS cold CI can take tens of minutes. Do not spend an active development session continuously polling a slow run.

- let workflows run while independent review/documentation work continues
- check CI at logical checkpoints and before merge
- investigate failures; never weaken platform checks to shorten the wait
- require Linux, Windows, and macOS release-build CI green for merge candidates
- Rust dependency resolution is reproducible through committed `src-tauri/Cargo.lock` and `--locked` test/check commands
- frontend dependency resolution is reproducible through committed `package-lock.json` and `npm ci`

An earlier session spent roughly twenty minutes waiting for CI, the stream disconnected, and a restarted instruction stream overlapped when the original later resumed. Inspect actual PR/branch/workflow state before continuing after an interruption.

## Branch hygiene

Prefer `main + one active product or maintenance branch`, with a second branch only for genuinely independent work.

- after a PR is merged or superseded, delete its branch when tooling/rulesets permit
- do not reuse obsolete branches for unrelated work
- branch new work from current `main`
- if an overlapping stream creates duplicate work, inspect actual merged/open PR state before continuing
- if a branch inherited already-merged unsquashed history, rebuild cleanly rather than leaving a noisy PR

## Cross-platform CI knowledge

The workflows are separate rather than one matrix:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, locked Rust dependency metadata, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check.

### Windows icon incident

`tauri-build` requires `src-tauri/icons/icon.ico` when generating Windows resources, including during Cargo tests because the build script runs there.

Repository policy:

- canonical visual source: `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico.b64` stores the equivalent Windows ICO as text
- `scripts/decode_windows_icon.ps1` materializes `src-tauri/icons/icon.ico`
- Windows CI runs that helper before any Cargo command
- generated `src-tauri/icons/icon.ico` is ignored by Git

Fresh Windows checkout before direct Cargo commands:

```powershell
pwsh -File scripts/decode_windows_icon.ps1
```

CI compile/link/configuration validation is not a substitute for real GUI interaction or installer/signing tests.

## Cache and source identity

Schema v4 makes `feed_items` identity `(source_kind, source_config_json, id)`.

Keep these semantics:

- source-specific rows may repeat the same external item id across different configs
- Compact/global top results deduplicate identical external ids
- seen state is intentionally global by external id
- refreshing an existing cache row preserves its seen state
- a newly inserted duplicate source row inherits already-seen state if that external id was seen elsewhere

`src-tauri/src/source_config.rs` is the canonical generic source-config boundary:

- JSON object only, bounded to 16 KiB
- recursively sort object keys
- preserve array order
- compact serialization
- scheduler keys and source-specific cache reads canonicalize before use

Do not introduce a second source-key representation.

## Widget source configuration

Issue #35 established the source-editing boundary. Preserve these rules:

- widget source configuration is updated through an explicit Rust/Tauri command, never by direct frontend DB writes
- generic JSON shape canonicalization remains in `source_config.rs`; adapter semantics belong in the adapter
- adapter defaults normalize sparsely, so semantically default configs collapse to the same source identity where the adapter defines that behavior
- invalid edits must leave the last persisted valid config untouched
- saving a config wakes the existing event/deadline runtime; it does not create another polling loop
- Board configuration UI is contextual and widget-local; opening or saving it must not rebuild the whole Board
- after a successful edit, update the in-memory widget config and rehydrate only that widget from the new source identity; later `cache-changed` events continue the normal narrow update path

The current shipped editor exposes arXiv `query` and `maxResults` (1..25). On PR #52, add real typed editors source-by-source; do not fall back to a generic JSON editor.

## Current source adapter policy

`src-tauri/src/sources/` is authoritative for source-specific config validation, network behavior, parsing, and hard refresh floors.

Current backend source kinds on PR #52:

- `arxiv`: default query `cat:cs.AI`, default bounded result count, automatic floor 24 h
- `wikipedia`: default language `ja`, default 12 results, `maxResults` 1..25, language code 2..16 lowercase ASCII letters/hyphen, automatic floor 6 h
- `qiita`: optional query + bounded result count, automatic floor 1 h
- `zenn`: typed feed selection for public RSS, automatic floor 1 h
- `youtube`: selected-channel RSS, automatic floor 1 h

Do not duplicate adapter validation rules in the generic config canonicalizer. Frontend controls may provide friendly constraints, but the Rust adapter boundary remains authoritative.

## Scheduler + runtime invariants

`src-tauri/src/scheduler.rs` remains pure deterministic decision logic. It must not acquire Tauri, SQLite, HTTP, timer, or wall-clock dependencies.

A source instance is `(source_kind, canonical source_config_json)`, not widget id.

Current scheduler invariants:

- default global auto interval: 1 hour
- global numeric range: 5 min .. 24 h; `off` disables automatic refresh
- manual refresh remains possible with auto OFF
- max concurrent background jobs: 2
- duplicate requests collapse
- manual request upgrades queued automatic priority
- failures back off exponentially from 60 s, capped at 6 h
- blocked work cannot execute before `blocked_until`
- persisted success/failure state is restored after restart
- scheduler exposes its next meaningful wakeup deadline
- source-specific hard floors clamp automatic scheduling but do not replace scheduler backoff / request gates

Automatic-refresh setting decoding/persistence/validation is centralized in `src-tauri/src/refresh_settings.rs`. Do not reintroduce separate copies in command and runtime code.

`src-tauri/src/runtime.rs` owns integration. Central locking invariant:

**Never hold the scheduler mutex across SQLite or HTTP I/O.**

Coordinator iteration:

1. snapshot widgets/settings/persisted refresh state under the DB lock
2. release DB lock
3. briefly synchronize/pop decisions under scheduler lock
4. release scheduler lock
5. run async network work and DB writes
6. briefly record scheduler success/failure
7. sleep until a `Notify` wake or the next deadline

Widget add/delete and refresh-setting changes wake the runtime. Geometry-only changes do not. Job completion also wakes it so freed concurrency can be consumed.

## arXiv adapter policy

The first real adapter lives in `src-tauri/src/sources/arxiv.rs`.

Preserve these source-specific constraints:

- legacy API response: Atom
- `sortBy=submittedDate`, descending
- one request at a time
- at least 3 seconds between request starts
- automatic refresh clamp: 24 h
- manual refresh can still be requested while automatic refresh is OFF, but respects scheduler backoff and the arXiv request gate
- no invented ETag/Last-Modified support

Stable arXiv cache ids strip version suffixes so `...v2` is the same logical paper as the earlier version.

## Cache/UI boundary

Startup remains cache-first. `runtime::start` constructs clients/spawns the coordinator after SQLite/cache initialization but does not await network completion.

- Compact reads only top cached items when visible
- Board reads only source/config pairs represented by widgets
- `cache-changed` carries source kind, canonical config, and affected widget ids
- Compact silently reloads its small feed after a cache change
- Board rehydrates only affected widget content nodes
- Idle/Hidden perform no feed DOM/layout/media work
- shell unseen badge remains Rust-owned
- never rebuild the whole Board merely because background freshness changed

Manual refresh should be available for each frontend-exposed real adapter. The button only enqueues work; scheduler/backoff/source policy owns actual execution.

## Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting commands and registering the re-exported path caused generated command marker symbols to be unresolved in PR #19. Keep paths such as `commands::cache_refresh::get_refresh_settings`.

## Shortcut / shell status invariants

Default shortcut: `CmdOrCtrl+Shift+Space`.

- persisted key: `shell.global_shortcut`
- publish/manage `AppState` before OS shortcut registration
- serialize changes with `AppState.shortcut_change`
- replacement order: register new -> unregister old -> persist new
- conflict/parse failure leaves old shortcut intact
- persistence failure attempts runtime rollback
- no silent fallback shortcuts
- shortcut ownership remains Rust-side

`ShellStatus` is separate from `ViewState` and owns `has_unseen`, configured shortcut, and shortcut registration error.

## Board implementation knowledge

Board geometry is a responsive logical 12x8 integer grid. Widgets are integer rectangles, cannot overlap, and do not push/reflow neighbors. Empty Board space is the primary add action.

Board drag/resize mutates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Compact source priority follows active Board widgets in spatial order: top-to-bottom, then left-to-right. Deleted/stale source cache must not surface merely because it remains in SQLite.

Cache hydration must not replace widget containers or reset pointer gestures; update only each widget's content node. Manual-refresh and source-config controls are excluded from the drag-handle pointer path.

## Rust temporary-lifetime pitfall

Two prior `E0597` incidents came from tail expressions retaining a temporary longer than expected:

- PR #12: `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

For this family of error, first make destruction order explicit with a local binding or terminating semicolon before redesigning ownership.

## Performance baseline status

`docs/PERF_BASELINE.md` contains the canonical procedure and measured observations.

A first real Windows release-build observation was captured on 2026-09-14:

- Idle memory: about 109 MB, stable during observation
- Task Manager CPU: displayed as 0%
- disk: displayed as 0 MB/s
- network: displayed as 0 Mbps
- separate Board observation with five widgets: app process about 5.3 MB and WebView2 Manager about 120.0 MB; these are a separate process-tree observation and must not be added to the 109 MB Idle figure as if they were one sample
- state transitions and Board drag/resize were responsive in that manual run

This is a practical observation, not a lab-grade benchmark. It is nevertheless within the current <=150 MiB Idle memory budget and replaces the old `TBD` claim in this handoff. Do not fabricate a missing historical pre-adapter baseline.

Canonical Linux measurement remains:

```bash
npm ci
npm run tauri build
./src-tauri/target/release/dopagaki-board &
APP_PID=$!
python3 scripts/measure_idle_linux.py --pid "$APP_PID" --settle 60 --duration 300 --interval 1 --csv /tmp/dopagaki-idle.csv
```

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- active short-batch checkpoint while a feature branch is live: `docs/ACTIVE_WORK.md`
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta issue: #13.

When reusable knowledge would otherwise exist only in chat, update the appropriate repository document in the same feature batch.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, `docs/ACTIVE_WORK.md` when present, and `docs/DECISIONS.md`.
2. Treat GitHub state as authoritative after an interrupted or overlapping stream. `main` is through PR #51; PR #52 on `real-source-adapters-clean` is the active product work until GitHub says otherwise.
3. Inspect PR #52 head and all three CI workflows before changing code. Do not assume the stale-test failure described above is still current.
4. Keep the new backend adapters hidden from the add picker until their own real configuration UI exists. Do not ship generic JSON controls or fake placeholders.
5. Next planned frontend slice: Wikipedia only. Expose it in the add picker, add a widget-local `language` + `maxResults` editor using the existing Rust validation command, expose manual refresh, and verify image/no-image Board rendering without whole-Board rebuilds.
6. After Wikipedia is validated, repeat the same bounded source-by-source process for Qiita, Zenn, and YouTube rather than exposing all four at once.
7. Reconcile `docs/ACTIVE_WORK.md` at each checkpoint, update durable docs/decisions where semantics changed, and require Linux/Windows/macOS release-build CI green before merging PR #52.

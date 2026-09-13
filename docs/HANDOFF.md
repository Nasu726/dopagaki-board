# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-14

## Current checkpoint

Merged to `main`:

- PR #12: free-placement Board
- PR #16: configurable global shortcut + Rust-owned Idle badge
- PR #17: Linux Idle performance baseline tooling
- PR #18: independent Linux / Windows / macOS CI
- PR #19: cache-first SQLite data layer + deterministic scheduler core
- PR #22: cache-driven Compact/Board presentation + automatic-refresh slider
- PR #24: schema-v4 source-scoped cache identity + canonical source configuration

PR #23 was a duplicate frontend implementation created during an overlapping development stream and was closed after #22 had already merged. Do not revive it.

Active product branch: `feat-runtime-arxiv`.
Active product PR: #26.
Current work: Issue #21, event/deadline-driven runtime coordinator + first real arXiv adapter.

PR #26 currently implements:

1. background coordination via `tokio::sync::Notify` plus scheduler deadlines, with no high-frequency polling loop
2. strict scheduler-lock separation from SQLite and HTTP I/O
3. restored/persisted `last_attempt`, `last_success`, failure count, and `blocked_until`
4. first async arXiv Atom adapter using `reqwest` + `quick-xml`
5. one serialized arXiv request gate with at least 3 seconds between request starts
6. arXiv automatic-refresh clamp of 24 hours, while manual refresh remains possible with auto OFF
7. source-scoped cache upserts using schema-v4 identity `(source_kind, canonical source_config_json, id)`
8. global seen-state propagation when the same external item appears under another source config
9. narrow `cache-changed` events: Compact reloads only its small feed surface; Board rehydrates only affected widgets; Hidden/Idle do no feed DOM/media work
10. a manual refresh control for arXiv Board widgets
11. deterministic scheduler, cache, refresh-state, and Atom-normalization tests

PR #26 was deliberately cleaned after PR #24 merged: its branch now has a clean parent at current `main`, rather than carrying the unsquashed #24 history. Keep it that way.

Independent maintenance PR #25 (`ci-lockfile-bootstrap`) contains `src-tauri/Cargo.lock` and changes the three OS workflows to use `--locked`. **Do not merge #25 before the dependency-changing runtime slice is settled unless its lockfile is regenerated for PR #26's new dependencies (`reqwest`, `quick-xml`, `tokio`).** After #26 merges, refresh/rebase #25 and regenerate the lockfile before merging it.

Issue #3 is closed in GitHub, but `docs/PERF_BASELINE.md` still correctly records the real desktop Idle CPU/RSS baseline as pending. Do not claim a measured baseline until actual release-build numbers are recorded there. Issue #6 owns the broader performance-budget/refactor discipline.

## CI working rule

Windows/macOS cold CI can take tens of minutes. Do not spend an active development session continuously polling a slow run.

- let workflows run while independent review/documentation work continues
- check CI at logical checkpoints and before merge
- investigate failures; never weaken platform checks to shorten the wait
- require Linux, Windows, and macOS release-build CI green for merge candidates

This rule exists because an earlier session spent roughly twenty minutes waiting for CI, the stream disconnected, and a restarted instruction stream overlapped when the original stream later resumed. Repository state, not stale chat/handoff text, is authoritative after such an interruption.

## Branch hygiene

Prefer `main + one active product branch`, with another branch only for genuinely independent maintenance.

- after a feature PR is merged or superseded, delete its branch when tooling permits
- do not reuse obsolete branches for unrelated work
- branch product work from current `main`
- if an overlapping stream creates duplicate work, inspect actual merged/open PR state before continuing
- if a feature branch inherited already-merged unsquashed history, rebuild/clean its ancestry before review rather than leaving a noisy PR

Known obsolete/superseded branches include older bootstrap/Board/Idle/cache-UI branches. Do not base new work on them.

## Cross-platform CI knowledge

The workflows are separate rather than one matrix:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check.

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

`src-tauri/src/source_config.rs` is the canonical source-config boundary:

- JSON object only, bounded to 16 KiB
- recursively sort object keys
- preserve array order
- compact serialization
- scheduler keys and source-specific cache reads canonicalize before use

Do not introduce a second source-key representation.

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
- scheduler can expose its next meaningful wakeup deadline

`src-tauri/src/runtime.rs` owns integration. The central locking invariant is:

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

Preserve these source-specific constraints recorded on Issue #21:

- legacy API response: Atom
- `sortBy=submittedDate`, descending
- one connection at a time
- at least 3 seconds between request starts
- automatic refresh clamp: 24 h
- manual refresh can still be requested while automatic refresh is OFF, but respects scheduler backoff and the arXiv request gate
- no invented ETag/Last-Modified support

Current default config `{}` means arXiv query `cat:cs.AI` with a bounded result count. Stable arXiv cache ids strip version suffixes so `...v2` is the same logical paper as the earlier version.

## Cache/UI boundary

Startup remains cache-first. `runtime::start` constructs clients/spawns the coordinator after SQLite/cache initialization but does not await network completion.

PR #22 established the narrow cache presentation boundary; PR #26 extends it with runtime events:

- Compact reads only the top cached items when visible
- Board reads only source/config pairs represented by widgets
- `cache-changed` carries source kind, canonical config, and affected widget ids
- Compact silently reloads its small feed after a cache change
- Board rehydrates only affected widget content nodes
- Idle/Hidden perform no feed DOM/layout/media work
- shell unseen badge remains Rust-owned
- never respond to background freshness by rebuilding the whole Board

Manual refresh is currently exposed only where an actual adapter exists (arXiv). The button enqueues work; the scheduler/request gate owns deduplication and cooldown behavior.

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

Board drag/resize mutates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Cache hydration must not replace widget containers or reset pointer gestures; update only each widget's content node. The manual-refresh button is excluded from the drag-handle pointer path.

## Rust temporary-lifetime pitfall

Two prior `E0597` incidents came from tail expressions retaining a temporary longer than expected:

- PR #12: `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

For this family of error, first make destruction order explicit with a local binding or terminating semicolon before redesigning ownership.

## Idle baseline procedure

Use a release build, not `tauri dev` or CI numbers.

```bash
npm install
npm run tauri build
./src-tauri/target/release/dopagaki-board &
APP_PID=$!
python3 scripts/measure_idle_linux.py --pid "$APP_PID" --settle 60 --duration 300 --interval 1 --csv /tmp/dopagaki-idle.csv
```

Keep the app in Idle with no interaction during settle/sample. `docs/PERF_BASELINE.md` defines metric semantics and conditions. The real desktop baseline is still pending.

## CI reproducibility / Issue #15

PR #25 is the lockfile/reproducibility slice, but its generated lockfile predates PR #26's new Rust dependencies.

After the runtime dependency set is final:

1. regenerate `src-tauri/Cargo.lock`
2. make PR #25 current with latest `main`
3. verify `cargo metadata --locked`
4. run test/check with `--locked` on all three OSes
5. keep build-cache experimentation separate and measured

Do not merge a stale lockfile just because its earlier CI run was green.

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta issue: #13.

When reusable knowledge would otherwise exist only in chat, update the appropriate repository document in the same feature batch.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Inspect active PR #26, maintenance PR #25, and Issues #5, #6, #15, #21.
3. Treat GitHub state as authoritative if chat/handoff appears inconsistent because of an interrupted or overlapping stream.
4. For PR #26, require frontend build, Rust tests/check, and Tauri release build green on Linux/Windows/macOS; fix failures rather than weakening checks.
5. Verify the first real arXiv flow still obeys cache-first startup, 24 h auto clamp, serialized >=3 s requests, source-key dedup, persisted backoff, and narrow UI updates.
6. Merge #26 only when green, then update/regen PR #25's lockfile against the new dependency set.
7. After runtime + lockfile work, perform the deliberate performance/refactor pass tracked by Issue #6 and run the real release-build Idle baseline when a desktop session is available.

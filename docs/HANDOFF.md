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
- PR #26: event/deadline-driven refresh runtime + first real arXiv adapter
- PR #27: current `src-tauri/Cargo.lock` + `--locked` Rust CI on Linux/Windows/macOS

Issue #5 (cache/scheduler) and Issue #15 (lockfile/reproducibility) are complete. Issue #21 closed with PR #26. The next product-development axis is performance/simplification (#6) before adding another adapter indiscriminately.

Current branch: `perf-simplification-pass-1`.
Current issue: #28, first deliberate post-runtime simplification pass.

Issue #28 currently removes stale bootstrap/debug command surface and centralizes automatic-refresh setting persistence/validation in `refresh_settings.rs`. It also corrects stale roadmap/performance documentation. This is intentionally a deletion/refactor slice, not a new feature.

Accidental duplicate Issues #29–#33 were created during tool setup and immediately closed as not planned. #28 is the canonical simplification issue.

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
- Rust dependency resolution is now reproducible through committed `src-tauri/Cargo.lock` and `--locked` test/check commands

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
- scheduler exposes its next meaningful wakeup deadline

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

Current default config `{}` means arXiv query `cat:cs.AI` with a bounded result count. Stable arXiv cache ids strip version suffixes so `...v2` is the same logical paper as the earlier version.

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

Manual refresh is currently exposed only where an actual adapter exists (arXiv). The button enqueues work; scheduler/backoff/request-gate policy owns actual execution.

## Simplification pass #28

The first deliberate post-runtime reduction pass targets code that accumulated during bootstrap/runtime bring-up rather than adding another feature.

Current changes:

- delete unused `bootstrap_probe` command and its `BootstrapProbe` transport type
- delete the unused manual `set_unseen` command; unseen state now comes from cache/runtime ownership only
- remove those commands from Tauri registration
- centralize auto-refresh setting read/write/validation in `refresh_settings.rs`
- delete duplicate interval constants/parsing/tests from command/runtime modules
- correct roadmap and performance-baseline documents that still described a pre-adapter state

The intent is to reduce command surface and policy duplication without changing UI behavior or scheduler/runtime boundaries.

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

## Performance baseline status

`docs/PERF_BASELINE.md` contains the canonical procedure. The release-build/process-tree tooling landed before the arXiv adapter, but the actual numeric pre-adapter baseline was not captured. Do not fabricate it retroactively.

The first real numeric baseline should be captured from the current release build with no refresh/preload work due. For the cleanest run, use no supported source widget or auto-refresh OFF and ensure no manual/background request is running.

Canonical Linux command:

```bash
npm install
npm run tauri build
./src-tauri/target/release/dopagaki-board &
APP_PID=$!
python3 scripts/measure_idle_linux.py --pid "$APP_PID" --settle 60 --duration 300 --interval 1 --csv /tmp/dopagaki-idle.csv
```

Real CPU/RSS/network values remain TBD until a desktop session is available.

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
2. Inspect Issue #28 and parent performance Issue #6.
3. Treat GitHub state as authoritative after an interrupted or overlapping stream.
4. For the simplification PR, require rustfmt, locked Rust tests/check, frontend build, and Tauri release build to pass on Linux/Windows/macOS.
5. Merge the simplification slice only if behavior stays unchanged and the command/policy duplication is genuinely reduced.
6. Capture the real release-build Idle baseline when a desktop session is available.
7. After that checkpoint, choose the next adapter deliberately (likely YouTube or Wikipedia) using the existing scheduler/runtime/cache boundary rather than inventing another framework.

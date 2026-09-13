# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

Merged to `main`:

- PR #12: free-placement Board
- PR #16: configurable global shortcut + Rust-owned Idle badge
- PR #17: Linux Idle performance baseline tooling
- PR #18: independent Linux / Windows / macOS CI, each reaching a Tauri release build

Issue #3 is intentionally still open. Its code-side acceptance criteria are complete; the remaining item is a **real desktop Idle CPU/RSS baseline** recorded in `docs/PERF_BASELINE.md`.

Active branch: `feat/cache-scheduler`.
Active PR: #19.
Current work: backend/data-layer slice of Issue #5.

PR #19 intentionally stops before frontend wiring and real HTTP adapters. It establishes:

1. SQLite v3 cache + refresh-state schema
2. one-time persistent demo cache so startup has useful data with networking unavailable
3. refresh interval persistence (`OFF` or 5 min .. 24 h, default 1 h)
4. a pure Rust scheduler core with deterministic tests for due times, deduplication, manual-priority upgrade, concurrency limit, and exponential backoff
5. Tauri commands for cache reads/seen state and refresh settings
6. architecture/handoff documentation

After #19 is green and merged, create a **new clean branch** for frontend cache-driven Compact/Board rendering and the refresh slider. After that, implement the event-driven runtime coordinator + first real source adapter. Do not hide HTTP/runtime work inside #19.

Issue #6 tracks the broader performance-budget/refactor discipline. Issue #15 tracks Cargo lockfile/cache/reproducibility work separately.

## Branch hygiene

Keep the repository close to `main + one active feature branch` whenever practical.

- after a feature PR is merged or superseded, delete its branch
- do not keep stacked/temporary branches once their clean replacement exists
- do not reuse an old feature branch for unrelated work
- before creating a new branch, prefer branching from current `main`

As of 2026-09-13, several old branches still exist because the connected GitHub tool currently exposes branch listing/update but not branch-ref deletion. They are obsolete and may be deleted safely once a deletion-capable path is available:

- `ci/cross-platform`
- `feat/bootstrap-tauri`
- `feat/free-board`
- `feat/free-board-clean`
- `feat/idle-compact`
- `feat/idle-compact-shell`
- `feat/shortcut-badge`
- `perf/idle-baseline-tools`

Do not base new work on those branches.

## Cross-platform CI knowledge

The workflows are deliberately separate rather than one matrix job:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check.

PR #18 finished green on all three platforms, including the Tauri release build.

### Windows icon incident

The first Windows run failed because `tauri-build` requires `src-tauri/icons/icon.ico` when generating Windows executable resources. Linux/macOS did not expose the requirement.

Repository policy:

- canonical visual source remains `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico.b64` stores the equivalent Windows ICO in text form because the repository connector cannot reliably write binary blobs
- `scripts/decode_windows_icon.ps1` materializes `src-tauri/icons/icon.ico`
- Windows CI runs the helper before any Cargo command; even `cargo test` executes `tauri-build`
- generated `src-tauri/icons/icon.ico` is ignored by Git

For a fresh Windows checkout:

```powershell
pwsh -File scripts/decode_windows_icon.ps1
```

before direct Cargo commands.

CI compile/link/configuration validation is not a substitute for real GUI interaction tests or signing/installer tests.

## Cache/scheduler implementation knowledge

### Schema v3

`feed_items` stores common cache fields plus `payload_json` for source-specific metadata. `source_refresh_state` reserves persisted HTTP validator/backoff state (`last_attempt`, `last_success`, failure count, blocked-until, ETag, Last-Modified).

Existing settings and Board layout survive v1/v2 -> v3 migration. Keep migration tests when the schema changes.

The demo cache is seeded only once, guarded by `cache.demo_seeded_v1`. Do not reseed on every launch because deleted/replaced demo data must not reappear forever.

### Scheduler core

`src-tauri/src/scheduler.rs` is deliberately pure Rust: no Tauri, SQLite, HTTP, timers, or wall-clock calls inside decision logic.

A source instance is keyed by `(source_kind, source_config_json)`, not widget id. Equivalent widget dependencies must deduplicate into one pending refresh.

Current invariants:

- default automatic interval: 1 hour
- persisted setting key: `refresh.auto_interval_seconds`
- persisted value `off` means automatic refresh disabled
- allowed automatic interval: 5 minutes .. 24 hours
- manual refresh remains possible with auto OFF
- background concurrency starts at 2
- manual request upgrades an already queued auto request instead of duplicating it
- failures use exponential backoff, starting at 60 s and capped at 6 h
- blocked sources are not started before their blocked-until boundary

The runtime coordinator is not implemented in this first slice. When it is added, use event/deadline wakeups rather than frequent polling. Actual HTTP waits should use async I/O, not a permanently occupied OS thread.

### Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting those functions from `commands/mod.rs` and passing the re-exported path to `generate_handler!` caused the generated command marker symbols to be unresolved in PR #19. Use paths such as `commands::cache_refresh::get_refresh_settings` instead.

### Cache-first startup

`lib.rs` opens/migrates SQLite and ensures the one-time cache seed before the frontend is usable. No network request is part of startup. Frontend wiring still needs to replace the current hard-coded Compact prototype with `list_cached_items` data.

When cache refresh later changes unseen state, preserve `ShellStatus` as the Rust-owned source of truth. Do not invent a second frontend unread/badge state.

## Idle baseline procedure

Use a release build. Do not use `tauri dev` or CI numbers as the resident-product baseline.

Canonical Linux run:

```bash
npm install
npm run tauri build
./src-tauri/target/release/dopagaki-board &
APP_PID=$!
python3 scripts/measure_idle_linux.py --pid "$APP_PID" --settle 60 --duration 300 --interval 1 --csv /tmp/dopagaki-idle.csv
```

Keep the app in Idle with no interaction during settle/sample. `docs/PERF_BASELINE.md` contains the full metric definitions and condition template.

The Linux helper recursively samples the root process plus descendants so WebKit subprocesses are included. It reports conservative summed RSS and, where readable, process-tree PSS. It deliberately does not fake per-process network bytes from `/proc/<pid>/net/dev`, because that file is network-namespace scoped rather than PID-attributed.

## Shortcut implementation and invariants

The default is `CmdOrCtrl+Shift+Space`. The underlying `global-hotkey` parser accepts `CmdOrCtrl` as a cross-platform alias.

- persisted setting key: `shell.global_shortcut`
- publish/manage `AppState` before OS shortcut registration so the plugin callback cannot observe missing managed state
- serialize runtime shortcut changes with `AppState.shortcut_change`
- replace bindings non-destructively: register new -> unregister old -> persist new
- ordinary parse/conflict failure leaves the old working shortcut intact
- persistence failure attempts to remove the new binding and restore the old runtime binding
- retrying the same configured shortcut can clear a prior registration error without rewriting SQLite
- never silently register fallback shortcuts
- shortcut registration/persistence remains Rust-owned; do not add the JavaScript global-shortcut plugin

## Shell status / unseen badge

`ShellStatus` is orthogonal to `ViewState` and currently contains `has_unseen`, configured global shortcut, and active registration error. The frontend reflects it but is not the source of truth.

Do not re-render the whole Board on future high-frequency shell/cache events; doing so can destroy an active drag/resize/settings interaction. Update only the relevant shell/content element when scheduler events become frequent.

## Rust temporary-lifetime pitfall

Two PRs exposed the same family of `E0597` surprises:

- PR #12: tail `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

When a guard/iterator/borrow-producing tail expression triggers a surprising lifetime error, first make destruction order explicit with a local binding or terminating semicolon. Do not redesign ownership unless necessary.

## Board implementation knowledge

Board drag/resize updates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Schema v2/v3 keeps `source_config_json` and `refresh_config_json`; use these unless a concrete adapter requirement justifies typed relational columns.

## CI follow-up

Issue #15 tracks missing `Cargo.lock` and repeated Rust dependency resolution/build cost. Three independent OS workflows make cold-build cost more visible, but correctness was established without cache first so the current runs are useful before-values.

First commit the executable lockfile and use `--locked`; evaluate build caching separately so dependency reproducibility and cache benefit are not conflated.

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta tracking issue: #13.

When reusable knowledge would otherwise exist only in chat, update the appropriate GitHub document in the same feature batch.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Inspect PR #19 plus Issues #3, #5, #6, and #15.
3. If #19 is open, require Linux/Windows/macOS CI green and merge it as the backend/data-layer slice.
4. Start frontend cache rendering + refresh slider from fresh `main` in a new branch.
5. Then implement the event-driven coordinator and first real adapter rather than expanding the pure scheduler abstraction speculatively.
6. Run the real release-build Idle baseline when a desktop session is available and record it in `docs/PERF_BASELINE.md`; close Issue #3 only then.

# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

Merged to `main`:

- PR #12: free-placement Board
- PR #16: configurable global shortcut + Rust-owned Idle badge
- PR #17: Linux Idle performance baseline tooling
- PR #18: independent Linux / Windows / macOS CI, each reaching a Tauri release build
- PR #19: cache-first data layer + deterministic scheduler core

Active branch: `feat-cache-ui`.
Active PR: #23.
Current work: frontend/cache slice of Issue #5.

PR #23 is intentionally limited to presentation and existing local-cache commands. It:

1. replaces hard-coded Compact prototype cards with SQLite-backed cached items
2. renders the matching cached item inside each Board widget using exact `(source_kind, source_config_json)` matching
3. preserves one-click external navigation from Compact and Board
4. marks actually surfaced cached items seen through the existing Rust-owned `ShellStatus` path
5. avoids whole-Board re-rendering for badge-only shell-status changes
6. adds the persisted automatic-refresh slider (`OFF` or 5 min .. 24 h, default 1 h), writing when the slider value is committed rather than on every pointer movement
7. keeps startup/network behavior cache-first; no HTTP adapter or runtime coordinator is hidden in this PR

After #23 is green and merged, create a **new clean branch** for the event/deadline-driven runtime coordinator plus the first real source adapter. arXiv remains the preferred first adapter because it is text-centric and a useful proving ground for the adapter/cache/scheduler boundary.

Issue #3 is currently closed, but `docs/PERF_BASELINE.md` still records the real desktop CPU/RSS baseline as **pending**. Do not claim a measured Idle baseline until actual release-build numbers have been recorded there.

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
- `feat/cache-scheduler`

Do not base new work on those branches.

## Cross-platform CI knowledge

The workflows are deliberately separate rather than one matrix job:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check.

PR #18 finished green on all three platforms, including the Tauri release build. Feature PRs should continue to require all three workflows before merge.

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

The runtime coordinator is not implemented yet. When it is added, use event/deadline wakeups rather than frequent polling. Actual HTTP waits should use async I/O, not a permanently occupied OS thread.

Do not hold the scheduler mutex across SQLite or HTTP work. Snapshot/pop scheduler decisions, release the scheduler lock, perform DB/network I/O, then reacquire only to commit the scheduling outcome.

### Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting those functions from `commands/mod.rs` and passing the re-exported path to `generate_handler!` caused the generated command marker symbols to be unresolved in PR #19. Use paths such as `commands::cache_refresh::get_refresh_settings` instead.

### Cache-first startup

`lib.rs` opens/migrates SQLite and ensures the one-time cache seed before the frontend is usable. No network request is part of startup.

PR #23 reads view state, shell status, cached items, and refresh settings from local Rust commands during boot. Cache reads are also refreshed when Compact/Board is entered. Future networking must remain outside the startup critical path.

When cache refresh later changes unseen state, preserve `ShellStatus` as the Rust-owned source of truth. Do not invent a second frontend unread/badge state.

### Cache-driven frontend slice (PR #23)

The frontend remains Vanilla TypeScript and now treats the SQLite cache as presentation input rather than embedding demo content in markup.

- Compact renders at most the top three cached items returned by `list_cached_items`.
- Board finds the first cached item whose `(source_kind, source_config_json)` exactly matches the widget. Newly created demo-era widgets currently use `{}` for `source_config_json`, so the persistent demo cache matches them.
- Cached text inserted into generated markup must stay HTML-escaped. Source-kind class names are sanitized separately.
- Compact and Board content remains the direct click target; no detail screen is introduced.
- Items surfaced in Compact or Board are sent to `mark_cached_items_seen`. The command remains responsible for updating Rust-owned `has_unseen`.
- A badge-only `shell-status-changed` event should update the Idle badge in place and must not rebuild an active Board tree. Shortcut-state changes may still require targeted UI refresh where the shortcut controls are visible.
- The refresh slider uses five-minute UI steps from OFF through 24 h and calls `set_auto_refresh_interval` on committed `change`, not continuously during pointer movement.
- Cached remote images are only rendered in Compact/Board. Idle still renders/decodes no content media.

The current frontend has no `cache-changed` event because there is no runtime coordinator yet. When refreshes begin writing new items, prefer a targeted cache/content-change event and update only affected visible content. Do not respond to each background refresh by blindly re-rendering the whole Board.

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

As of 2026-09-13, `docs/PERF_BASELINE.md` still says **real desktop measurement pending**. CI/dev measurements must not be substituted for it.

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

PR #23 makes the first concrete change in this direction: badge-only shell-status events update Idle badge visibility directly rather than calling the global `render()` path.

## Rust temporary-lifetime pitfall

Two PRs exposed the same family of `E0597` surprises:

- PR #12: tail `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

When a guard/iterator/borrow-producing tail expression triggers a surprising lifetime error, first make destruction order explicit with a local binding or terminating semicolon. Do not redesign ownership unless necessary.

## Board implementation knowledge

Board drag/resize updates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Schema v2/v3 keeps `source_config_json` and `refresh_config_json`; use these unless a concrete adapter requirement justifies typed relational columns.

Board content is now interactive. Keep drag bound to the dedicated drag handle so clicking cached content opens the original URL instead of beginning a drag.

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
2. Inspect PR #23 plus Issues #5, #6, and #15; also inspect `docs/PERF_BASELINE.md` before making claims about Issue #3's measurement status.
3. If PR #23 is open, require Linux/Windows/macOS CI green and merge it as the frontend/cache slice of Issue #5.
4. From fresh `main`, implement the event/deadline-driven runtime coordinator without holding scheduler locks across DB/network work.
5. Add the first real source adapter, preferably arXiv, through the existing adapter/cache/scheduler boundary; canonicalize source config before relying on deduplication.
6. Emit targeted cache/content changes rather than rebuilding the Board on every refresh.
7. Run the real release-build Idle baseline when a desktop session is available and record it in `docs/PERF_BASELINE.md`.
8. Continue Issue #15 lockfile/cache work separately from product feature PRs.

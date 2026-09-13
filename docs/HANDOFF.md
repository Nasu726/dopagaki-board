# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

Merged to `main`:

- PR #12: free-placement Board
- PR #16: configurable global shortcut + Rust-owned Idle badge
- PR #17: Linux Idle performance baseline tooling
- PR #18: independent Linux / Windows / macOS CI, each reaching a Tauri release build
- PR #19: cache-first SQLite data layer + deterministic scheduler core
- PR #22: cache-driven Compact/Board presentation + automatic-refresh slider

Issue #20 is complete. PR #23 was a duplicate frontend implementation and was closed after #22 merged.

Active branch: `fix-cache-identity`.
Active PR: #24.
Current work: correctness prerequisite for Issue #21 before real arXiv writes.

PR #24 repairs the cache identity discovered during the arXiv pre-implementation review:

1. schema v4 makes `feed_items` primary key `(source_kind, source_config_json, id)` rather than globally unique `id`
2. v3 cache rows migrate without loss
3. the same external item may now belong to several source/query configurations safely
4. `mark_seen` remains intentionally global by external item id
5. the top/global cache query deduplicates identical item ids so overlapping queries do not repeat the same paper in Compact
6. regression tests cover migration, duplicate source-scoped rows, global seen propagation, and top-cache deduplication

After #24 is green and merged, continue Issue #21 from fresh `main`: source-config canonicalization, event/deadline-driven runtime coordination, then the first real arXiv adapter. Do not hide network waits under a scheduler mutex or put network completion on startup's critical path.

Issue #3 is closed in GitHub, but `docs/PERF_BASELINE.md` still correctly records the **real desktop Idle CPU/RSS baseline as pending**. Do not interpret the closed issue as a measured baseline. Issue #6 still owns the broader performance-budget/refactor discipline. Issue #15 tracks Cargo lockfile/cache/reproducibility separately.

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
- `feat/cache-ui`
- `feat-cache-ui`

Do not base new work on those branches.

## Cross-platform CI knowledge

The workflows are deliberately separate rather than one matrix job:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check.

PR #18 established all three platforms green through a Tauri release build. PR #22 also passed all three workflows before merge.

Windows/macOS cold CI can take around tens of minutes. Do not spend an active development session polling a slow green-looking run. Once a PR is structurally ready, continue independent work and check CI at logical checkpoints; never weaken checks just to shorten the wait.

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

### Schema v4

Schema v3 introduced `feed_items` and `source_refresh_state`. Schema v4 changes cached-item identity to `(source_kind, source_config_json, id)`.

This distinction is required before real adapters: the same external item can legitimately be selected by multiple source configurations. For example, one arXiv paper can match both a graph-theory query and a hypergraph query. A global `id` primary key would make one query collide with or overwrite the other.

Keep these semantics:

- cache row identity: `(source_kind, canonical source_config_json, external item id)`
- global/top presentation: deduplicate identical external item ids
- seen state: currently global by external item id; seeing one copy marks all cached copies seen
- source-specific cache reads: exact source kind + canonical config

The demo cache is seeded only once, guarded by `cache.demo_seeded_v1`. Do not reseed on every launch because deleted/replaced demo data must not reappear forever.

### Scheduler core

`src-tauri/src/scheduler.rs` is deliberately pure Rust: no Tauri, SQLite, HTTP, timers, or wall-clock calls inside decision logic.

A source instance is keyed by `(source_kind, source_config_json)`, not widget id. Equivalent widget dependencies must deduplicate into one pending refresh. Before real adapters depend on this, canonicalize `source_config_json`; textual JSON equivalence is not sufficient deduplication.

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

Do not hold the scheduler mutex across SQLite or HTTP work. Pop/snapshot a scheduling decision, release the scheduler lock, perform DB/network I/O, then reacquire only to commit success/failure. This avoids scheduler->DB lock inversion and foreground commands waiting behind network latency.

### arXiv constraints already established for Issue #21

For the legacy arXiv query API, preserve the constraints recorded on Issue #21:

- Atom 1.0 response
- automatic arXiv refresh should clamp to a 24 h source-specific interval because search results follow the daily submission cycle
- serialize arXiv requests and enforce at least a 3 s gate between legacy API requests
- do not invent ETag / Last-Modified behavior if the endpoint does not document it
- manual refresh may exist while auto is OFF, but it still respects the hard arXiv request gate

### Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting those functions from `commands/mod.rs` and passing the re-exported path to `generate_handler!` caused the generated command marker symbols to be unresolved in PR #19. Use paths such as `commands::cache_refresh::get_refresh_settings` instead.

### Cache-first startup and UI boundary

`lib.rs` opens/migrates SQLite and ensures the one-time cache seed before the frontend is usable. No network request is part of startup.

The cache/UI boundary introduced in PR #22 is intentionally narrow:

- Compact invokes `list_cached_items` only when Compact is rendered
- Board invokes `list_cached_items_for_source` only for source/config pairs represented by current widgets
- cache results update the specific Compact feed or widget content nodes through DOM APIs
- shell-status changes update only the relevant visible shell element; they must not cause a whole-Board rebuild because that can destroy an active drag/resize/settings interaction
- external feed titles/authors/URLs are applied through DOM properties / `textContent`, not interpolated as trusted HTML
- current cached image fields are URLs, not locally stored image bytes, so offline startup must still remain useful from cached text if image fetches fail

When runtime refresh starts changing cache contents, emit a narrow cache/content signal and preserve this targeted-update pattern instead of calling the top-level `render()` for every background event.

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

Do not re-render the whole Board on shell/cache events; doing so can destroy an active drag/resize/settings interaction. PR #22 changed the shell-status listener to update the Idle badge or active shortcut controls narrowly and leaves Board geometry/content DOM intact.

## Rust temporary-lifetime pitfall

Two PRs exposed the same family of `E0597` surprises:

- PR #12: tail `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

When a guard/iterator/borrow-producing tail expression triggers a surprising lifetime error, first make destruction order explicit with a local binding or terminating semicolon. Do not redesign ownership unless necessary.

## Board implementation knowledge

Board drag/resize updates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Schema v2+ keeps `source_config_json` and `refresh_config_json`; use these unless a concrete adapter requirement justifies typed relational columns.

Cached feed content must remain separate from geometry persistence. Hydrating content must not replace widget elements or reset pointer gestures; update only each widget's `[data-widget-content]` node.

## CI follow-up

Issue #15 tracks missing `Cargo.lock` and repeated Rust dependency resolution/build cost. Three independent OS workflows make cold-build cost more visible, but correctness was established without cache first so the current runs are useful before-values.

First commit the executable lockfile and use `--locked`; evaluate build caching separately so dependency reproducibility and cache benefit are not conflated. Do not mix this maintenance work into the arXiv feature PR merely because both cause Rust CI to run.

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
2. Inspect PR #24 plus Issues #5, #6, #15, and #21; also inspect `docs/PERF_BASELINE.md` before making claims about measured Idle performance.
3. If PR #24 is open, let the normal Linux/Windows/macOS CI complete; do not sit idle polling it. Continue independent work and merge #24 once green.
4. From fresh `main` after #24, canonicalize source configs and implement the event/deadline-driven runtime coordinator without holding scheduler locks across DB/network work.
5. Add the first real arXiv adapter through that boundary, with a 24 h automatic minimum and serialized >=3 s request gate.
6. Emit targeted cache/content changes rather than rebuilding the Board on every refresh.
7. Run the real release-build Idle baseline when a desktop session is available and record it in `docs/PERF_BASELINE.md`.
8. Continue Issue #15 lockfile/cache work separately from product feature PRs.

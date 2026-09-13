# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

PR #12 (free-placement Board), PR #16 (configurable global shortcut + Rust-owned Idle badge), and PR #17 (Linux Idle performance baseline tooling) are merged to `main`.

Issue #3 is intentionally still open. Its code-side acceptance criteria are complete; the remaining item is a **real desktop Idle CPU/RSS baseline** recorded in `docs/PERF_BASELINE.md`.

Active branch: `ci/cross-platform`.
Active PR: #18.
Current work:

1. keep Linux validation as an independent workflow
2. add independent Windows and macOS validation
3. require frontend build + Rust tests/check + a real Tauri release build (`--no-bundle --ci`) on each OS
4. merge only after all three platform workflows are green
5. then return to the real release-build Idle baseline and Issue #5 scheduler work

Issue #6 tracks the broader performance-budget/refactor discipline. Issue #15 tracks Cargo lockfile/cache/reproducibility work separately.

## Cross-platform CI knowledge

The workflows are deliberately separate rather than one matrix job:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

This makes a platform-specific failure independently visible and rerunnable.

Each OS should validate:

- frontend production build
- Rust tests
- `cargo check`
- Tauri release application build with `npm run tauri build -- --no-bundle --ci`

Linux additionally owns rustfmt and the syntax check for the Linux performance sampler.

CI is compile/link/configuration validation, not a substitute for real GUI interaction tests. Packaging/signing is also intentionally separate from this check.

### Windows icon incident

The first Windows run reached the Rust/Tauri build script and failed because `tauri-build` requires `src-tauri/icons/icon.ico` when generating Windows executable resources. Linux and macOS did not expose this requirement.

Repository policy:

- canonical visual source remains `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico.b64` stores the equivalent Windows ICO in text form because the repository connector cannot reliably write binary blobs
- `scripts/decode_windows_icon.ps1` materializes `src-tauri/icons/icon.ico`
- Windows CI must run that helper **before any Cargo command**, because even `cargo test` executes `tauri-build`
- generated `src-tauri/icons/icon.ico` is ignored by Git

For a fresh Windows checkout, run:

```powershell
pwsh -File scripts/decode_windows_icon.ps1
```

before invoking Cargo directly. The CI workflow performs this automatically.

The first macOS cross-platform run passed frontend build, Rust tests/check, and the Tauri release build without platform-specific source changes.

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
- no schema migration; use the existing SQLite settings table
- publish/manage `AppState` before OS shortcut registration so the plugin callback cannot observe missing managed state
- serialize runtime shortcut changes with `AppState.shortcut_change`
- replace bindings non-destructively: register new -> unregister old -> persist new
- ordinary parse/conflict failure leaves the old working shortcut intact
- persistence failure attempts to remove the new binding and restore the old runtime binding
- retrying the same configured shortcut can clear a prior registration error without rewriting SQLite
- never silently register fallback shortcuts
- shortcut registration/persistence remains Rust-owned; do not add the JavaScript global-shortcut plugin

## Shell status / unseen badge

`ShellStatus` is intentionally orthogonal to `ViewState` and currently contains:

- `has_unseen: bool`
- configured global shortcut
- active shortcut registration error, if any

The frontend reflects this state but is not its source of truth. When Issue #5 later changes `has_unseen` from background refreshes, update only the relevant visible shell element. Do not re-render the whole Board on every shell-status event because an active drag/resize/settings interaction could be destroyed.

## Scheduler design already settled for Issue #5

Do not equate widgets with network fetch jobs.

Multiple widgets can depend on the same source/config. Separate:

- widget state: desired freshness, visible priority, manual refresh request
- source-instance state (source kind + canonical config): due/in-flight, validators, quota/backoff, last attempt/success
- coordinator: priority, deduplication, bounded concurrency

Equivalent source/config requests should fetch once and fan the normalized/cache result out to dependent widgets. On wake/resume after long sleep, collapse duplicate overdue work and stagger automatic refreshes rather than bursting all sources at once.

A cross-platform OS "system idle" detector is not required for MVP. Soft deadlines, small concurrency, foreground priority, backoff, and interruptible preload provide the important non-interference behavior with much less complexity.

## Rust temporary-lifetime pitfall

Two PRs have exposed the same family of `E0597` surprises:

- PR #12: a tail `query_map(...).collect()` expression retained a temporary relative to the prepared statement
- PR #16: a tail `match state.shell.lock() { ... }` retained the `Result<MutexGuard<...>>` temporary relative to the Tauri `State` binding

When a guard/iterator/borrow-producing expression at block tail triggers a surprising lifetime error, first make destruction order explicit with a local binding or a terminating semicolon. Do not immediately redesign ownership when explicit drop order is sufficient.

## Board implementation knowledge

Board drag/resize updates the DOM during pointer movement and persists geometry only once at gesture end. Do not write SQLite on every pointer move.

The frontend is intentionally Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or a canvas dependency merely for current Board interactions.

Schema v2 already reserves `source_config_json` and `refresh_config_json`. Use those when source adapters and refresh configuration arrive unless a concrete requirement justifies typed relational columns and another migration.

## CI follow-up

Issue #15 tracks missing `Cargo.lock` and repeated Rust dependency resolution/build cost.

Current cold CI repeatedly logs roughly 487 resolved Rust packages. First commit the executable's Cargo lockfile and use `--locked` for reproducibility; evaluate build caching separately so lockfile benefit and cache benefit are not conflated.

Do not combine Issue #15 with platform correctness fixes unless a platform run directly proves the lockfile is required for correctness.

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
2. Inspect PR #18 plus Issues #3, #5, #6, and #15.
3. If PR #18 is active, require Linux/Windows/macOS workflows to reach the Tauri release-build step and finish green; fix platform-specific failures rather than weakening the checks.
4. Merge #18 once all three are green.
5. Run the release-build Idle baseline on a real desktop and record results in `docs/PERF_BASELINE.md`.
6. Close Issue #3 only after that measurement is committed.
7. Then continue with Issue #5 unless another priority is explicitly chosen.

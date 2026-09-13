# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

PR #12 (free-placement Board) is merged to `main`; Issue #4 is complete. Its final CI passed frontend build, rustfmt, Rust tests, and `cargo check`.

Active implementation branch: `feat/shortcut-badge`.
Current target: finish the remaining code-side acceptance criteria of Issue #3:

1. configurable, persisted global shortcut with explicit conflict/error handling
2. Rust-owned boolean unseen/update badge for Idle
3. preserve a minimal UI surface for shortcut configuration

Idle CPU/RSS measurement still requires a real desktop session and belongs in `docs/PERF_BASELINE.md`; coordinate that with Issue #6 rather than pretending CI can measure it.

## Planned shortcut behavior

The current default is `CmdOrCtrl+Shift+Space`. Reuse the existing SQLite `settings` table; no schema migration is needed.

- At startup, load the persisted shortcut; use the default only when no setting exists.
- Register exactly the selected shortcut; do not silently register fallbacks.
- If startup registration fails, retain the configured value plus an error in Rust-owned shell status so the UI can explain the conflict.
- When changing shortcut, try registering the requested new shortcut while the old binding is still active. Ordinary parse/conflict failure must leave the old shortcut untouched.
- Only after new registration succeeds, unregister the old shortcut and then persist the new setting.
- If the old unregister step fails, best-effort unregister the newly registered shortcut and return an error rather than intentionally leaving two bindings.
- Keep shortcut registration and persistence in Rust; do not add the JavaScript global-shortcut plugin.

## Planned unseen badge behavior

The blue dot already exists in Idle markup/CSS but is always hidden. Add an orthogonal Rust-owned boolean shell status rather than overloading `ViewState`.

- expose a small shell-status command/event
- frontend renders the dot from Rust state
- keep this boolean; do not introduce counts or a notification-center model yet

## Minimal configuration UI

Do not add a full settings page. Use a small keyboard/shortcut popover from the Board toolbar. If startup shortcut registration fails, Compact may show a contextual warning that leads to this configuration affordance.

## Historical Board CI knowledge

PR #12 initially exposed Rust `E0597` in `src-tauri/src/db/widgets.rs`: returning a `query_map(...).collect()` tail expression kept the mapped-row temporary alive too long relative to the prepared statement. Binding the collected `Vec` to a local value fixed it (`c970d1a1a7d51f470f9051a1cfcdeeea25aa383e`). A following Actions run failed at startup with zero jobs, but a later normal run passed fully; treat zero-job `startup_failure` separately from code failures.

Board drag/resize updates the DOM during pointer movement and persists geometry only once at gesture end. Keep that behavior.

## CI follow-up

Issue #15 tracks missing `Cargo.lock` / repeated Rust dependency resolution and possible conservative CI caching. Keep that separate from Issue #3 unless it becomes a blocker.

## Repository-memory protocol

- settled decisions: `docs/DECISIONS.md`
- current checkpoint / incidents / next actions: this file
- architecture: `docs/ARCHITECTURE.md`
- performance method: `docs/PERFORMANCE.md`
- measured baselines: `docs/PERF_BASELINE.md`
- feature acceptance/progress: Issues and PRs
- agent discipline: `AGENTS.md`

Meta tracking issue: #13.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Inspect Issue #3 and the active PR/branch for it.
3. Verify CI state before merging.
4. Update this file whenever the true restart point changes.

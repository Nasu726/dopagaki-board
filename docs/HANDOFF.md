# Development handoff

This is the live restart point for long-running development. Keep information here when it would otherwise exist only in chat or local terminal history.

Last updated: 2026-09-13

## Current checkpoint

PR #12 (free-placement Board) is merged to `main`; Issue #4 is complete. Its final CI passed frontend build, rustfmt, Rust tests, and `cargo check`.

Active implementation branch: `feat/shortcut-badge`.
Active PR: #16, `Make global shortcut configurable and drive Idle badge from Rust`.
Current target: finish the remaining code-side acceptance criteria of Issue #3:

1. configurable, persisted global shortcut with explicit conflict/error handling
2. Rust-owned boolean unseen/update badge for Idle
3. preserve a minimal UI surface for shortcut configuration

Idle CPU/RSS measurement still requires a real desktop session and belongs in `docs/PERF_BASELINE.md`; coordinate that with Issue #6 rather than pretending CI can measure it.

## Shortcut implementation and invariants

The default is `CmdOrCtrl+Shift+Space`. The underlying `global-hotkey` parser explicitly accepts `CmdOrCtrl` as a cross-platform alias, even though Tauri examples often spell the same concept `CommandOrControl`.

Reuse the existing SQLite `settings` table; no schema migration is needed.

- At startup, load the persisted shortcut; use the default only when no setting exists.
- Register exactly the selected shortcut; do not silently register fallbacks.
- **Manage/publish `AppState` before registering the OS shortcut.** The plugin handler can fire as soon as registration succeeds, so registering first creates a small race in which the handler could access state that Tauri does not yet manage.
- If startup registration fails, retain the configured value plus an error in Rust-owned shell status so the UI can explain the conflict.
- Serialize runtime shortcut changes with a dedicated mutex. Tauri commands can overlap; two concurrent replacement attempts must not interleave register/unregister/persist operations.
- When changing shortcut, register the requested new binding while the old binding is still active. Ordinary parse/conflict failure therefore leaves the known-working old shortcut untouched.
- Only after new registration succeeds, unregister the old shortcut and then persist the new setting.
- If the old unregister step fails, best-effort unregister the newly registered shortcut and return an error rather than intentionally leaving two bindings.
- If persistence fails after a swap, best-effort remove the new binding and restore the previous runtime binding.
- Retrying the **same** configured shortcut does not need another SQLite write. If the previous startup registration had failed but registration now succeeds, clear the registration error directly.
- Keep shortcut registration and persistence in Rust; do not add the JavaScript global-shortcut plugin.

## Unseen badge implementation

The Idle blue dot is driven by an orthogonal Rust-owned `ShellStatus.has_unseen` boolean rather than overloading `ViewState`.

- `ShellStatus` also carries the configured global shortcut and an active shortcut registration error.
- frontend reads/reflects shell status but is not its source of truth
- `shell-status-changed` publishes status changes
- keep unseen state boolean for now; do not introduce counts or notification-center semantics prematurely

When the scheduler later starts changing `has_unseen` in the background, do **not** blindly re-render the entire Board on every shell-status event. Board may contain an active drag/resize or settings form. Prefer state-specific targeted updates (Idle badge only, minimal Compact status, Board only where required). This is also recorded on Issue #5.

## Minimal configuration UI

Do not add a full settings page. PR #16 uses a small keyboard/shortcut popover from the Board toolbar. If startup shortcut registration fails, Compact shows a contextual warning that leads to this configuration affordance.

Shortcut/error text is assigned via DOM `.value` / `.textContent` rather than interpolated into HTML markup.

## Board implementation knowledge

PR #12 initially exposed Rust `E0597` in `src-tauri/src/db/widgets.rs`: returning a `query_map(...).collect()` tail expression kept the mapped-row temporary alive too long relative to the prepared statement. Binding the collected `Vec` to a local value fixed it (`c970d1a1a7d51f470f9051a1cfcdeeea25aa383e`). A following Actions run failed at startup with zero jobs, but a later normal run passed fully; treat zero-job `startup_failure` separately from code failures.

Board drag/resize updates the DOM during pointer movement and persists geometry only once at gesture end. Keep that behavior.

The frontend is intentionally Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or a canvas dependency merely for current Board interactions.

Schema v2 already reserves `source_config_json` and `refresh_config_json`. Use those when source adapters and refresh configuration arrive unless a concrete requirement justifies typed relational columns and another migration.

## CI follow-up

Issue #15 tracks missing `Cargo.lock` / repeated Rust dependency resolution and possible conservative CI caching. Keep that separate from Issue #3 unless it becomes a blocker.

Cold Ubuntu CI repeatedly spends roughly tens of seconds installing Tauri/WebKitGTK system packages and minutes compiling the Rust/Tauri graph. A lockfile improves reproducibility/resolution; it does not by itself solve cold compilation. Measure lockfile and cache changes separately.

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
2. Inspect Issue #3 and PR #16.
3. Verify current CI state before changing or merging the branch.
4. Update this file whenever the true restart point changes.

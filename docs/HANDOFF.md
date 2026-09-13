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

Current product-correctness branch: `fix-cache-identity`.
Current product-correctness PR: #24.

PR #24 is the prerequisite for Issue #21 before real arXiv writes. It now establishes both cache identity and canonical source keys:

1. schema v4 makes `feed_items` primary key `(source_kind, source_config_json, id)` rather than globally unique `id`
2. v3 cache rows migrate without loss
3. the same external item may belong to several source/query configurations safely
4. `mark_seen` remains intentionally global by external item id
5. the top/global cache query deduplicates identical item ids so overlapping queries do not repeat the same paper in Compact
6. source config JSON is parsed as a bounded JSON object, recursively key-sorted, and serialized compactly
7. scheduler keys and source-specific cache reads use the canonical config, so whitespace/key-order differences do not create duplicate source instances
8. tests cover migration, duplicate source-scoped rows, global seen propagation, top-cache deduplication, and equivalent JSON source keys

After #24 is green and merged, Issue #21 can proceed directly to the event/deadline-driven runtime coordinator and first real arXiv adapter. Do not add another ad-hoc source-key representation.

Independent maintenance branch: `ci-lockfile-bootstrap`.
Independent maintenance PR: #25.

PR #25 now contains the generated `src-tauri/Cargo.lock`; its temporary bootstrap workflow deleted itself after generating the file. The normal Linux/Windows/macOS workflows verify `cargo metadata --locked` and run `cargo test` / `cargo check` with `--locked`. Build caching remains a later, separately measured step so reproducibility and cache-speed effects are not conflated.

Issue #3 is closed in GitHub, but `docs/PERF_BASELINE.md` still correctly records the **real desktop Idle CPU/RSS baseline as pending**. Do not interpret the closed issue as a measured baseline. Issue #6 owns the broader performance-budget/refactor discipline.

## CI working rule

Windows/macOS cold CI can take around tens of minutes. Do not spend an active development session continuously polling a slow run.

- once a PR is structurally ready, let its workflows run while independent work continues
- check CI at logical checkpoints, before merge, or when a failure notification/result becomes relevant
- never weaken or skip platform checks merely to shorten the wait
- do not stack dependent feature branches merely to stay busy; independent work may proceed on a separate clean branch

This rule exists to avoid wasting development time while preserving the requirement that merge candidates finish green on Linux, Windows, and macOS.

## Branch hygiene

Keep the repository close to `main + one active feature branch`, with a second branch only when the work is genuinely independent (for example current PR #25 CI maintenance).

- after a feature PR is merged or superseded, delete its branch when tooling permits
- do not reuse old feature branches for unrelated work
- branch new product work from current `main`
- do not build Issue #21 on top of PR #24 unless necessary; after #24 merges, start the runtime slice from fresh `main`

Known obsolete branches that may be deleted safely when a deletion-capable path is available:

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

## Cross-platform CI knowledge

The workflows are deliberately separate:

- `.github/workflows/ci.yml` -> `CI / Linux`
- `.github/workflows/ci-windows.yml` -> `CI / Windows`
- `.github/workflows/ci-macos.yml` -> `CI macOS`

Each OS validates frontend production build, Rust tests/check, and `npm run tauri build -- --no-bundle --ci`. Linux additionally owns rustfmt and the Linux performance-helper syntax check. PR #22 passed all three before merge.

### Windows icon incident

`tauri-build` requires `src-tauri/icons/icon.ico` when generating Windows executable resources, including during Cargo tests because the build script runs there.

Repository policy:

- canonical visual source remains `src-tauri/icons/icon.png`
- `src-tauri/icons/icon.ico.b64` stores the equivalent Windows ICO as text
- `scripts/decode_windows_icon.ps1` materializes `src-tauri/icons/icon.ico`
- Windows CI runs the helper before any Cargo command
- generated `src-tauri/icons/icon.ico` is ignored by Git

For a fresh Windows checkout:

```powershell
pwsh -File scripts/decode_windows_icon.ps1
```

before direct Cargo commands.

CI compile/link/configuration validation is not a substitute for real GUI interaction tests or signing/installer tests.

## Cache and source identity

### Schema v4

Schema v3 introduced `feed_items` and `source_refresh_state`. Schema v4 changes cached-item identity to `(source_kind, source_config_json, id)`.

The same external item can legitimately be selected by multiple source configurations. For example, one arXiv paper can match two queries. A global `id` primary key would make one query collide with or overwrite the other.

Keep these semantics:

- cache row identity: `(source_kind, canonical source_config_json, external item id)`
- global/top presentation: deduplicate identical external item ids
- seen state: currently global by external item id; seeing one copy marks all cached copies seen
- source-specific cache reads: exact source kind + canonical config

The demo cache is seeded only once, guarded by `cache.demo_seeded_v1`. Do not reseed on every launch.

### Canonical source config

`src-tauri/src/source_config.rs` is the canonical boundary for source config JSON.

- input must be a JSON object and is bounded to 16 KiB
- object keys are recursively sorted
- array order is preserved
- output is compact JSON
- scheduler `SourceKey::new` canonicalizes before constructing a key
- source-specific cache reads canonicalize before querying SQLite

Future widget configuration writes and adapter cache writes must store the same canonical representation. Do not compare raw user-entered JSON strings as source identity.

## Scheduler core

`src-tauri/src/scheduler.rs` is deliberately pure decision logic: no Tauri, SQLite, HTTP, timers, or wall-clock calls inside it.

A source instance is keyed by `(source_kind, canonical source_config_json)`, not widget id. Equivalent widget dependencies must deduplicate into one pending refresh.

Current invariants:

- default automatic interval: 1 hour
- setting key: `refresh.auto_interval_seconds`
- `off` means automatic refresh disabled
- numeric range: 5 minutes .. 24 hours
- manual refresh remains possible with auto OFF
- background concurrency starts at 2
- manual request upgrades an already queued auto request instead of duplicating it
- failures use exponential backoff starting at 60 s and capped at 6 h
- blocked sources do not start before `blocked_until`

The runtime coordinator is not implemented yet. It must use event/deadline wakeups rather than frequent polling. HTTP waits must use async I/O.

**Locking rule:** never hold the scheduler mutex across SQLite or HTTP work. Snapshot/pop a scheduling decision, release the lock, perform DB/network I/O, then reacquire only to commit success/failure. This avoids scheduler -> DB lock inversion and foreground commands waiting behind network latency.

## arXiv constraints already established for Issue #21

Preserve the policy recorded on Issue #21 for the legacy arXiv API:

- response is Atom 1.0
- automatic arXiv refresh is source-clamped to 24 h
- serialize legacy API requests and enforce at least a 3 s request gate
- do not invent ETag / Last-Modified behavior if the endpoint does not document it
- manual refresh may exist while auto is OFF, but still respects the hard arXiv request gate

The first real adapter must normalize results into schema v4 and emit narrow cache-change signals rather than forcing a full Board render.

## Cache-first UI boundary

`lib.rs` opens/migrates SQLite and ensures the one-time cache seed before frontend use. Network completion is never part of startup.

PR #22 established a narrow cache/UI boundary:

- Compact reads cached top items only when Compact is rendered
- Board reads cache only for source/config pairs represented by current widgets
- async cache results update specific content nodes, not the whole Board
- shell-status changes update only relevant visible shell elements
- external feed titles/authors/URLs use DOM properties / `textContent`, not trusted `innerHTML`
- image URLs may fail offline; cached text still needs to remain useful

When runtime refresh begins changing cache contents, emit a targeted cache/content event and preserve this update pattern.

## Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting command functions and registering the re-exported path caused generated command marker symbols to be unresolved in PR #19. Use paths such as `commands::cache_refresh::get_refresh_settings`.

## Shortcut / shell status invariants

Default shortcut: `CmdOrCtrl+Shift+Space`.

- persisted key: `shell.global_shortcut`
- publish/manage `AppState` before OS shortcut registration
- serialize changes with `AppState.shortcut_change`
- replacement order: register new -> unregister old -> persist new
- conflict/parse failure leaves the old shortcut intact
- persistence failure attempts runtime rollback
- never silently register fallback shortcuts
- shortcut ownership stays in Rust

`ShellStatus` is orthogonal to `ViewState` and owns `has_unseen`, configured shortcut, and shortcut registration error. The frontend reflects it but is not the source of truth.

Do not re-render the whole Board on shell/cache events; that can destroy active drag/resize/settings interaction.

## Board implementation knowledge

Board drag/resize updates DOM during pointer movement and persists geometry once at gesture end. Do not write SQLite on every pointer move.

The frontend remains Vanilla TypeScript. Do not add React/Vue/Svelte, a grid engine, or canvas dependency for current interactions.

Cached content must remain separate from geometry persistence. Hydration must not replace widget elements or reset pointer gestures; update only the widget content node.

## Rust temporary-lifetime pitfall

Two prior `E0597` incidents came from tail expressions retaining a borrow/temporary longer than expected:

- PR #12: `query_map(...).collect()` relative to a prepared statement
- PR #16: tail `match state.shell.lock()` relative to Tauri `State`

When this family of error appears, first make destruction order explicit with a local binding or terminating semicolon before redesigning ownership.

## Idle baseline procedure

Use a release build, not `tauri dev` or CI numbers.

```bash
npm install
npm run tauri build
./src-tauri/target/release/dopagaki-board &
APP_PID=$!
python3 scripts/measure_idle_linux.py --pid "$APP_PID" --settle 60 --duration 300 --interval 1 --csv /tmp/dopagaki-idle.csv
```

Keep the app in Idle with no interaction during settle/sample. `docs/PERF_BASELINE.md` defines the metric semantics and condition template. The helper includes WebKit descendants and reports conservative summed RSS plus PSS where readable.

As of 2026-09-13, the real desktop baseline is still pending. Do not substitute CI/dev estimates.

## CI reproducibility / Issue #15

PR #25 is the lockfile/reproducibility slice:

- commit `src-tauri/Cargo.lock`
- verify lock consistency early with `cargo metadata --locked`
- use `--locked` for Rust test/check on all three OSes
- keep the existing Tauri release build
- evaluate build caching in a later measured change, using previous cold timings as before-values

Do not mix Cargo cache experimentation into product feature PRs.

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
2. Inspect PR #24 and PR #25 plus Issues #5, #6, #15, and #21.
3. Do not sit idle polling macOS/Windows CI. Continue independent work and check each PR at a logical merge checkpoint.
4. Merge #24 only after all required CI is green; then start the runtime coordinator from fresh `main`.
5. Implement arXiv through the canonical source-key/cache boundary, with event/deadline wakeups and no scheduler lock held across DB/network I/O.
6. Merge #25 separately once its locked-CI checks are green; evaluate Rust build caching afterward as a separate measured change.
7. Emit targeted cache/content changes rather than rebuilding the Board on every refresh.
8. Run and record the real release-build Idle baseline when a desktop session is available.

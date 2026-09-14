# Development handoff

Durable implementation knowledge for restarting work after a long gap or interrupted agent session. **Do not use this as the primary current-status document.** Read `ACTIVE_WORK.md` and GitHub first for the active branch/PR; read the authoritative specs/decisions for current product behavior.

Last reconciled: 2026-09-15.

## Restart pointer

At this reconciliation point, `main` is merged through PR #51 and draft PR #52 on `real-source-adapters-clean` contains the five-source expansion (arXiv plus Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS). The implementation portion of #52 is complete; desktop smoke testing is intentionally deferred to the user's next available Windows session. Issue #53 tracks optional YouTube Data API work; #54 tracks a post-#52 frontend maintainability extraction.

This paragraph can age. After any interruption, treat actual GitHub branch/PR/workflow state as authoritative and then read `ACTIVE_WORK.md`.

## Source identity and config boundary

A source instance is **`(source_kind, canonical source_config_json)`**, never widget id.

`src-tauri/src/source_config.rs` is the generic JSON canonicalization boundary. Adapter-specific defaults/validation stay in each source adapter. Scheduler keys and source-specific cache reads must use canonical identity; do not create another source-key representation.

Widget source config edits go through a Rust/Tauri command. The frontend must not write config directly into SQLite. A successful edit wakes the existing coordinator and rehydrates only the affected widget/source; it does not create a new poller or rebuild the Board.

Multiple widgets with the same source identity share scheduler/cache work. Refresh policy resolves per widget but collapses to the most eager enabled effective interval for that shared source. See `REFRESH_POLICY.md` for exact semantics/floors.

## Runtime locking invariant

`scheduler.rs` stays deterministic and independent from Tauri/SQLite/HTTP/wall-clock calls. `runtime.rs` is the integration layer.

**Never hold the scheduler mutex across SQLite or HTTP I/O.**

Coordinator shape is snapshot DB state -> release DB -> briefly synchronize/pop scheduler -> release scheduler -> async HTTP/DB work -> briefly record result -> sleep until `Notify` or the next deadline. Do not replace this with periodic high-frequency polling.

Background concurrency is bounded. Widget geometry changes do not wake refresh scheduling; source/refresh changes do.

## Cache/UI boundary

Startup is cache-first and network completion is never on the critical path.

`cache-changed` is deliberately narrow: source kind + canonical config + affected widget ids. Compact may reload its small cached feed, but Board refreshes only affected content nodes. Do not replace widget containers or rerender the whole Board on background freshness events; doing so can reset drag/resize/config interactions.

Hidden/Idle do no feed DOM/layout/media work. The unseen badge is Rust-owned shell state.

Compact only considers sources represented by current Board widgets. Stale cache from a deleted final widget must not keep that source in Compact. Default source priority is Board spatial order (top-to-bottom, left-to-right).

## Board geometry invariant

Board persistence is a responsive logical **12×8 integer grid**. Widgets are integer rectangles, never overlap, and never implicitly push/reflow neighbors. Drag/resize updates the DOM during the gesture and persists geometry once at gesture end; do not write SQLite on every pointer move.

Every edge/corner is a resize handle. A colliding candidate is rejected and the last valid rectangle remains. Legacy pixel layouts were migrated to grid coordinates on load.

Board feed rows must work both with and without `image_url`. The current row implementation uses an optional fixed-basis thumbnail plus flexible text; do not reintroduce a layout that reserves an empty image column for text-only sources.

## Source-specific traps worth remembering

### arXiv

The legacy API path is Atom, sorted by submitted date descending. Requests share one serialized adapter gate and request starts are spaced by at least 3 seconds. Stable cache ids strip version suffixes. Do not invent ETag/Last-Modified support. Scheduler backoff and the arXiv request gate solve different problems; preserve both.

### YouTube

Public selected-channel RSS is the no-key baseline. A raw `UC...` ID or `/channel/UC...` URL can configure it. Adding a YouTube widget opens settings immediately; cancelling keeps the dormant widget because creating it is treated as intent to configure later.

Empty YouTube channel config is a valid setup state. The adapter returns an empty result before HTTP, so an unconfigured widget does not hit YouTube or record a refresh failure. Empty configs also canonicalize to the same source identity, so multiple unconfigured widgets do not create one poller each.

Optional Data API work belongs to #53 and uses a user-supplied key; never embed a shared key. RSS remains the fallback. OAuth/subscription-aware discovery is later. Recommendation/ranking stays application-owned rather than pretending an API exposes the user's current YouTube Home feed.

## Tauri command macro boundary

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting a command and registering the re-exported path previously caused generated command marker symbols to be unresolved (PR #19). Prefer paths such as `commands::cache_refresh::get_refresh_settings`.

## Windows icon build trap

`tauri-build` requires `src-tauri/icons/icon.ico` while generating Windows resources, including some Cargo commands because the build script runs there.

Repository convention:

- visual source: `src-tauri/icons/icon.png`
- committed text representation: `src-tauri/icons/icon.ico.b64`
- `scripts/decode_windows_icon.ps1` materializes `icon.ico`
- generated `icon.ico` is ignored
- Windows CI runs the helper before Cargo/Tauri work

Fresh Windows checkout before direct build if needed:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\decode_windows_icon.ps1
```

## Global shortcut replacement

Default: `CmdOrCtrl+Shift+Space`. Shortcut ownership is Rust-side. Replacement is deliberately non-destructive: register new -> unregister old -> persist new. A conflict/parse failure leaves the old shortcut intact; persistence failure should attempt runtime rollback. Do not silently choose fallback shortcuts.

## Rust temporary-lifetime pitfall

Two earlier `E0597` incidents came from tail expressions keeping a temporary alive longer than expected (`query_map(...).collect()` relative to a statement, and a tail `match state.shell.lock()` relative to Tauri `State`). For similar errors, first make destruction order explicit with a local binding or terminating semicolon before redesigning ownership.

## CI and branch working rule

There are independent Linux, Windows, and macOS workflows. A merge candidate requires all three release-build workflows green. CI compile/link validation is not a substitute for real GUI/network smoke testing.

Windows/macOS cold CI can take long enough that actively polling it wastes the session. Do independent review/docs work and check at logical gates rather than waiting continuously. A prior session had two overlapping work streams after the client disconnected during a long CI wait; after any interruption, inspect actual GitHub state before acting.

Prefer `main + one active product/maintenance branch`. Do not stack unrelated work onto a nearly-finished PR merely because CI or desktop testing is pending. #54 exists specifically so the frontend decomposition can happen after #52 instead of destabilizing the smoke-test candidate.

The repository is public. If branch deletion/non-fast-forward behavior is surprising, inspect the actual ruleset; an earlier `main protection` ruleset appeared broad enough to affect more than `main`.

## Performance facts and discipline

`PERFORMANCE.md` defines budgets; `PERF_BASELINE.md` is the measurement record. Never infer numeric gains from structural cleanup alone.

First practical Windows Idle observation (2026-09-14): about 109 MB memory, Task Manager 0% CPU, 0 MB/s disk, 0 Mbps network during observation. A separate Board process-tree observation showed app process about 5.3 MB and WebView2 Manager about 120 MB; these are separate samples and must not be added to the 109 MB Idle figure.

The app is intended to stay resident. If nothing useful is due, it should actually do nothing: no high-frequency timers, hidden rendering, media decode, or unnecessary network work.

## Documentation memory protocol

- settled choices/open product questions: `DECISIONS.md`
- current product behavior: `PRODUCT_SPEC.md` / `UX_AND_DESIGN.md`
- technical boundaries: `ARCHITECTURE.md` / `REFRESH_POLICY.md`
- current branch/next gate: `ACTIVE_WORK.md` + Issue/PR
- durable implementation traps/incidents: this file
- performance policy/results: `PERFORMANCE.md` / `PERF_BASELINE.md`
- long-running agent discipline: `AGENTS.md`

Do not copy the same transient status into all of them. Historical notes such as `REFRESH_PATH_REFACTOR.md` should be clearly marked as historical.

## Restart checklist

1. Read `AGENTS.md`, `README.md`, `DECISIONS.md`, and `ACTIVE_WORK.md`; inspect current GitHub branch/PR/CI state.
2. Read the specific spec/architecture document relevant to the task rather than assuming this handoff is the latest product definition.
3. If #52 is still active, its next gate should be evidence (desktop smoke + final-head CI), not more source implementation, unless a concrete defect has been found.
4. Preserve canonical source identity, narrow UI rehydration, event/deadline scheduling, and the scheduler-lock invariant.
5. Record a new non-obvious trap here only if it will matter after the current task/PR is gone.

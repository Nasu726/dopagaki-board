# Development handoff

Durable implementation knowledge for restarting work after a long gap or interrupted session. Current branch/PR/CI state is owned by GitHub plus `ACTIVE_WORK.md`; product behavior is owned by the product/UX documents.

Last reconciled: 2026-09-15.

## Restart protocol

1. Inspect actual GitHub `main`, open PRs/Issues, and workflow state before acting.
2. Read `ACTIVE_WORK.md` for the current maintenance gate.
3. Read only the spec/architecture document relevant to the task.
4. Preserve the invariants below unless a deliberate product/architecture change replaces them.

## Source identity and configuration

A source instance is **`(source_kind, canonical source_config_json)`**, never widget id.

`src-tauri/src/source_config.rs` is the generic JSON canonicalization boundary. Adapter-specific semantics/defaults stay with the adapters. Scheduler keys and source-specific cache reads must use the same canonical identity.

Widget source-config edits go through Rust/Tauri commands; the frontend does not write SQLite directly. Successful edits wake the existing coordinator and rehydrate only the affected widget/source. Multiple widgets with the same canonical source share scheduler/cache work.

Refresh policy resolves per widget but collapses to the most eager enabled effective interval for a shared source. See `REFRESH_POLICY.md` for exact inheritance/floor semantics.

## Scheduler/runtime invariant

`scheduler.rs` stays deterministic and independent from Tauri, SQLite, HTTP, and wall-clock calls. `runtime.rs` is the integration layer.

**Never hold the scheduler mutex across SQLite or HTTP I/O.** The coordinator snapshots DB state, releases DB locks, briefly synchronizes/pops scheduler work, releases the scheduler, performs async work, records the result briefly, then sleeps until `Notify` or the next deadline. Do not replace this with high-frequency polling.

Background concurrency is bounded. Widget geometry changes do not wake refresh scheduling; source/refresh changes do.

Source HTTP failures use the shared classification boundary. Rate limits may supply a retry floor; resulting deadlines are persisted in the existing per-source `blocked_until` state. A blocked source instance must not stall unrelated sources.

## Cache/UI boundary

Startup is cache-first; network completion is never on the critical startup path.

`cache-changed` is intentionally narrow: source kind + canonical config + affected widget ids. Compact may reload its small cached feed, but Board refreshes only affected content nodes. Do not rebuild the whole Board on background freshness or source-config save.

Hidden/Idle do no feed DOM/layout/media work. Compact only considers sources represented by current Board widgets; deleted-source stale cache must not keep a source in Compact. Default Compact source priority follows Board spatial order, top-to-bottom then left-to-right.

## Board and shell invariants

Board persistence is a responsive logical **12×8 integer grid**. Widgets are integer rectangles, never overlap, and never implicitly push/reflow neighbors. Drag/resize updates the DOM during the gesture and persists geometry once at gesture end.

Feed rows must work with and without images. Do not reserve a phantom image column for text-only sources.

The main window remains taskbar-free. Resident controls use the native system tray/notification area and the existing `ViewEvent` state machine rather than a parallel shell-state path.

On Windows/macOS, Idle disables the native window shadow so the 64×64 transparent host does not reveal a square outline around the circular Idle UI. Compact/Board restore their native shadow. Preserve this distinction when changing window state code.

## Source-specific constraints

### arXiv

The Atom endpoint is sorted by submitted date descending. Requests share one serialized adapter gate and request starts remain at least 3 seconds apart. Stable cache ids strip version suffixes. Scheduler retry/backoff and this request-spacing gate are separate mechanisms; preserve both.

### YouTube

Selected-channel RSS is the no-key baseline. Raw `UC...` IDs and `/channel/UC...` URLs work without another API request.

An empty channel id is a valid dormant setup state: the adapter returns before HTTP and does not record failure/backoff. Cancelling initial YouTube configuration keeps the new dormant widget so setup can be retried without recreating placement.

Optional Data API work is #53. Users supply their own key; never embed a shared project key. RSS remains the fallback. Recommendation/ranking stays application-owned; do not assume the Data API exposes the user's current YouTube Home feed.

## Tauri/platform traps

Keep `#[tauri::command]` functions registered from the module where the macro is defined. Re-exporting a command and registering the re-exported path can break generated command-marker symbols.

Windows resource generation requires `src-tauri/icons/icon.ico`. Repository convention is:

- visual source: `src-tauri/icons/icon.png`
- committed text representation: `src-tauri/icons/icon.ico.b64`
- `scripts/decode_windows_icon.ps1` materializes the ignored `icon.ico`
- Windows CI runs that helper before Cargo/Tauri work

For a fresh Windows checkout before direct build:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\decode_windows_icon.ps1
```

Global shortcut ownership is Rust-side. Replacement is non-destructive: register new -> unregister old -> persist new. A conflict/parse failure leaves the previous shortcut intact.

## CI and performance discipline

Linux, Windows, and macOS release-build workflows are independent. A merge candidate requires all three green, but CI is not a substitute for real GUI/network smoke.

Do independent work instead of continuously polling slow CI. After any client/session interruption, inspect GitHub state rather than trusting a stale local/handoff assumption.

`PERFORMANCE.md` defines budgets; `PERF_BASELINE.md` owns measurements. Never infer numeric CPU/RSS gains from structural cleanup alone. The app is intended to stay resident, so when nothing is due it should do no high-frequency timers, hidden rendering, media decode, or unnecessary network work.

## Documentation ownership

- current task/merge gate: `ACTIVE_WORK.md` + GitHub Issue/PR
- product behavior: `PRODUCT_SPEC.md` / `UX_AND_DESIGN.md`
- architecture/refresh invariants: `ARCHITECTURE.md` / `REFRESH_POLICY.md`
- settled/open product choices: `DECISIONS.md`
- reproducible performance policy/results: `PERFORMANCE.md` / `PERF_BASELINE.md`
- durable cross-cutting traps: this file
- long-running contribution discipline: `AGENTS.md`

Historical task narration belongs in Issues/PRs/commits unless it still explains a live correctness, platform, or repeated-work hazard.

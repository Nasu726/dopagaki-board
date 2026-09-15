# dopagaki-board

Lightweight desktop discovery board for ambient feeds and one-click content access.

## Status

The functional MVP is in real-use expansion. The app is Tauri 2 + a Rust core + local SQLite with a deliberately small Vanilla TypeScript/WebView presentation layer.

Working source adapters are **arXiv, Wikipedia, Qiita, Zenn, and selected-channel YouTube RSS**. YouTube RSS works without Google credentials. Optional YouTube Data API enrichment will use a user-supplied key, with OAuth/subscription-aware discovery deferred to a later update.

The first practical Windows release-build observation measured about 109 MB Idle memory with Task Manager displaying 0% CPU and 0 Mbps network traffic during the observation. Treat this as a practical baseline, not a lab benchmark; details and caveats are in `docs/PERF_BASELINE.md`.

## Product idea

Keep interesting sources quietly present on the desktop without demanding attention. Most of the time the app collapses into a transparent circular Idle orb. Restore Compact for a few high-priority items or Board for a spatial overview, then open the original content in one click.

## Interaction model

- **Idle:** tiny transparent orb; no feed DOM or media work.
- **Compact:** up to three cached items from currently active Board sources, prioritized by Board position; opening content collapses back to Idle.
- **Board:** responsive 12×8 logical grid. Widgets can use different integer sizes, cannot overlap, move by grid snapping, and resize from every edge/corner.
- Click empty Board space to add a working source near that point.
- Global shortcut and refresh settings live behind the gear/settings surface.
- Source configuration is widget-local; refresh/cache work is shared by canonical source identity rather than duplicated per widget.

## Design principles

- Content > app decoration.
- Less UI > more UI where discoverability is preserved.
- One click to original content.
- Idle by default.
- Cache-first and local-first.
- Freshness matters, but foreground responsiveness matters more.
- Lightweightness is a product feature, not a final polish step.

## Documentation map

Use each document for one job instead of copying the same status everywhere:

- `docs/PRODUCT_SPEC.md` — current product behavior.
- `docs/UX_AND_DESIGN.md` — interaction and visual rules.
- `docs/ARCHITECTURE.md` — current technical boundaries and invariants.
- `docs/REFRESH_POLICY.md` — refresh-resolution semantics.
- `docs/PERFORMANCE.md` — performance budgets and measurement discipline.
- `docs/PERF_BASELINE.md` — measured observations and reproducible procedures.
- `docs/ROADMAP.md` — completed/current/future implementation stages.
- `docs/DECISIONS.md` — settled choices and deliberately open questions.
- `docs/ACTIVE_WORK.md` — short-lived branch checkpoint and immediate next gate.
- `docs/HANDOFF.md` — durable implementation knowledge, incidents, and restart traps.
- `AGENTS.md` — development discipline for long-running agent work.

## Development

The frontend intentionally remains Vanilla TypeScript. Runtime application logic belongs in Rust unless it is presentation/direct-manipulation behavior.

```bash
npm ci
npm run tauri dev
```

For real performance/desktop validation use a release build:

```bash
npm ci
npm run tauri build
```

On a fresh Windows checkout, materialize the committed icon before direct Cargo/Tauri build commands if needed:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\decode_windows_icon.ps1
```

Linux requires the normal Tauri 2 WebKitGTK development dependencies.

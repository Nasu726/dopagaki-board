# dopagaki-board

Lightweight desktop discovery board for ambient feeds and one-click content access.

## Status

The functional MVP has passed its first real Windows desktop test. The current implementation is Tauri 2 + Rust core + local SQLite with a lightweight Vanilla TypeScript/WebView UI.

The first live source adapter is **arXiv**. Planned sources are not shown as fake placeholder widgets; they become selectable only after a real adapter exists. NHK is intentionally out of scope.

Observed Windows resident behavior at the first practical checkpoint was about 109 MB Idle memory with Task Manager showing 0% CPU and 0 Mbps idle network traffic. See `docs/PERF_BASELINE.md` for the measurement caveats and reproducible procedure.

## Product idea

Keep interesting sources such as arXiv, YouTube, Wikipedia, Qiita, and Zenn quietly present on the desktop without demanding attention. Most of the time the app collapses into a transparent circular Idle orb. Restore Compact for a few high-priority items or Board for a spatial overview, then reach the original content in one click.

## Interaction model

- **Idle:** tiny transparent orb, no feed DOM/media work.
- **Compact:** up to three items from currently active Board sources, prioritized by Board position; opening content collapses back to Idle.
- **Board:** responsive 12×8 logical grid. Widgets may use different integer sizes, cannot overlap, move by grid snapping, and resize from every edge/corner.
- Click empty Board space to add a working source near that point.
- The undecorated window has familiar minimize/restore/maximize-like controls and a draggable toolbar region.
- Global shortcut and refresh settings live behind the gear/settings surface.

## Design principles

- Content > app decoration.
- Less UI > more UI.
- One click to original content.
- Idle by default.
- Cache-first and local-first.
- Freshness matters, but foreground responsiveness matters more.
- Lightweightness is a product feature, not a final polish step.
- Never pretend an unimplemented source works by showing seeded placeholder data.

## Project documentation

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — product behavior
- [`docs/UX_AND_DESIGN.md`](docs/UX_AND_DESIGN.md) — interaction/visual rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Tauri/Rust/SQLite boundaries
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — budgets and simplification loop
- [`docs/PERF_BASELINE.md`](docs/PERF_BASELINE.md) — measured observations/procedure
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implementation sequence
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable decision log
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — current checkpoint and exact restart path
- [`AGENTS.md`](AGENTS.md) — long-running development invariants

GitHub issue #1 remains the frozen snapshot of the initial planning discussion. Later confirmed decisions in `docs/DECISIONS.md` override it.

## Development

The frontend intentionally remains Vanilla TypeScript. Runtime application logic belongs in Rust unless it is presentation/direct-manipulation behavior.

```bash
npm ci
npm run tauri dev
```

For real performance/desktop validation use a release build instead:

```bash
npm ci
npm run tauri build
```

On a fresh Windows checkout, materialize the committed icon before direct Cargo/Tauri build commands if needed:

```powershell
pwsh -NoProfile -ExecutionPolicy Bypass -File .\scripts\decode_windows_icon.ps1
```

Linux requires the normal Tauri 2 WebKitGTK development dependencies.

# dopagaki-board

Lightweight desktop discovery board for ambient feeds and one-click content access.

## Status

Early MVP development. The current implementation track is Tauri 2 + Rust core + local SQLite, with a replaceable lightweight WebView UI.

## Product idea

Keep interesting sources such as YouTube, arXiv, Wikipedia, NHK, Qiita, and Zenn quietly present on the desktop without demanding attention. Most of the time the app should collapse into a tiny circular Idle orb. Open it only when something looks tempting, then reach the original content in one click.

## Design principles

- Content > app decoration.
- Less UI > more UI.
- One click to original content.
- Idle by default.
- Cache-first and local-first.
- Freshness matters, but foreground responsiveness matters more.
- Lightweightness is a product feature, not a final polish step.

## Project documentation

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — agreed product behavior
- [`docs/UX_AND_DESIGN.md`](docs/UX_AND_DESIGN.md) — Idle / Compact / Board and visual rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Tauri/Rust/SQLite boundaries
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — budgets and simplification loop
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implementation sequence
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — durable decision log
- [`docs/HANDOFF.md`](docs/HANDOFF.md) — current checkpoint, known incidents, and exact restart path
- [`AGENTS.md`](AGENTS.md) — instructions for long-running AI-assisted development

GitHub issue #1 is also a complete snapshot of the initial planning discussion for recovery if context is lost. Meta issue #13 tracks the rule that reusable development knowledge must remain repository-native rather than living only in chat.

## Development

The frontend intentionally starts with Vanilla TypeScript rather than a UI framework. Runtime application logic belongs in Rust unless there is a strong presentation-specific reason otherwise.

```bash
npm install
npm run tauri dev
```

Linux requires the normal Tauri 2 WebKitGTK development dependencies.

# dopagaki-board

Lightweight desktop discovery board for ambient feeds and one-click content access.

## Product idea

`dopagaki-board` keeps interesting information close without demanding attention. It surfaces fresh or tempting content from sources such as YouTube, arXiv, Wikipedia, NHK, Qiita, and Zenn, then gets out of the way when the user opens the original content.

The application is intentionally local-first, cache-first, and aggressively lightweight. Its normal long-lived state is a tiny circular idle orb rather than a conventional window.

## MVP stack

- Tauri 2
- Rust-owned application core
- SQLite persistence/cache
- WebView UI for the MVP

A native Windows/macOS/Linux UI may be considered later only if the product proves valuable and measurements show a meaningful benefit.

## Core interaction states

- **Hidden** — no visible surface; background refresh may continue.
- **Idle** — tiny circular orb, optional blue update dot, no content rendering.
- **Compact** — 1–3 high-priority content items; one click opens the original content and automatically collapses back to Idle.
- **Board** — freely positioned and freely sized widgets on a canvas. Clicking empty space starts an add-widget flow.

## Design principles

1. Content > app decoration.
2. Less UI > more UI.
3. One click to original content.
4. Cache first; network is never on startup's critical path.
5. Freshness matters, but foreground responsiveness matters more.
6. Lightweightness is a product feature, not a final optimization pass.

## Durable project docs

- [`docs/PRODUCT_SPEC.md`](docs/PRODUCT_SPEC.md) — agreed product requirements
- [`docs/UX_AND_DESIGN.md`](docs/UX_AND_DESIGN.md) — state model, layout, visual rules
- [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) — Rust/UI boundary, persistence, scheduler
- [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md) — performance budgets and reduction loop
- [`docs/ROADMAP.md`](docs/ROADMAP.md) — implementation order and milestones
- [`docs/DECISIONS.md`](docs/DECISIONS.md) — concise decision log and open questions
- [`AGENTS.md`](AGENTS.md) — development rules for coding agents

GitHub Issue #1 is also a frozen checkpoint of the initial design discussion.

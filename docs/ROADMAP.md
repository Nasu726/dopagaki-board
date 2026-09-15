# Roadmap

Current checkpoint (2026-09-15): **functional MVP is in a real-use maintenance pass.** The Tauri shell, four-state loop, responsive 12×8 Board, SQLite cache/scheduler, source-aware refresh policy, five working public-source presentations, notification-area controls, and source-scoped retry/backoff behavior are on `main`.

The current priority is to simplify and verify that baseline before another broad feature expansion: extract/redesign widget settings (#54/#61), finish the glanceable result-count defaults and resize smoke (#60), complete remaining Windows shell checks (#59/#66), and keep the lightweightness/docs passes active (#57/#63). Optional YouTube Data API work remains #53.

## Phase 0 — durable specification

- [x] Repository and durable product/architecture docs.
- [x] Decision log and handoff protocol.
- [x] Documentation roles clarified so transient branch state does not masquerade as durable specification.

## Phase 1 — smallest runnable shell

- [x] Tauri 2 + Rust core boundary.
- [x] SQLite and migrations/data-directory handling.
- [x] Minimal frontend/Rust command boundary.
- [x] Reproducible baseline tooling and first real Windows resident observation.
- [x] First explicit deletion/simplification pass.

## Phase 2 — core state loop

- [x] Hidden / Idle / Compact / Board state model.
- [x] Transparent Idle orb + boolean update badge.
- [x] Cache-driven Compact and configurable global shortcut.
- [x] Compact external launch -> Idle without waiting for network.
- [x] Taskbar-free resident shell with notification-area controls.
- [ ] Continue real-device transition/startup/shell verification as behavior evolves.

## Phase 3 — responsive Board

- [x] Empty-space add flow.
- [x] Responsive logical 12×8 grid persistence.
- [x] Grid-snapped drag and eight-direction resize.
- [x] Non-overlap without neighbor push/reflow.
- [x] Gesture-end persistence and legacy pixel-layout conversion.
- [x] Size-aware feed presentation through lightweight container queries.
- [ ] Finish real-device review across representative widget/window sizes (#60).
- [ ] Introduce explicit Select/Add interaction modes after the settings surface stabilizes (#62).

## Phase 4 — cache and scheduler

- [x] Source-scoped SQLite cache identity and canonical config.
- [x] Cache-first presentation.
- [x] Event/deadline-driven scheduler with bounded concurrency and persisted backoff.
- [x] Narrow refresh-path DB queries and narrow cache-change UI updates.
- [x] Global/source/widget refresh resolution with OFF and manual refresh.
- [x] Shared-source scheduling by canonical source identity.
- [x] Shared HTTP failure classification with rate-limit retry floors persisted per source instance.

## Phase 5 — real adapters

1. [x] arXiv — Atom metadata, editable query/result count, 24 h automatic floor, serialized request gate.
2. [x] Wikipedia — random MediaWiki discovery + PageImages, language/result settings, 6 h floor.
3. [x] Qiita — public items API + optional query, 1 h floor.
4. [x] Zenn — public trend/user/topic RSS, 1 h floor.
5. [x] YouTube RSS — selected-channel public RSS, thumbnails, typed channel/result settings, manual/source-aware refresh, 1 h floor.
6. [ ] YouTube Data API enrichment — optional user-supplied key with RSS fallback; tracked by #53.
7. [ ] YouTube OAuth/subscription-aware discovery — later update after practical non-OAuth use is proven.

The five-source public baseline is merged. Remaining source-adjacent work is product polish/verification and optional API-assisted expansion rather than an adapter merge gate.

## Phase 6 — settings and maintainability

- [ ] Extract cohesive source/widget configuration logic from the frontend monolith (#54).
- [ ] Move widget configuration into a dedicated editing surface with clear source/refresh grouping (#61).
- [ ] Allow exact automatic-refresh interval entry while keeping the slider synchronized (#61).
- [ ] Keep Rust as the authoritative validation/canonicalization boundary and preserve narrow rehydration.

## Phase 7 — API-assisted discovery and media discipline

Add Data API capability incrementally, beginning with `@handle` resolution/validation and only then useful visible metadata or bounded candidate discovery. API credentials are user-supplied; API/background work stays bounded to useful results.

For media loading: visible thumbnails first; near-visible preload only when justified; off-screen preload only after measurement; foreground work always wins.

## Phase 8 — recommendation

Recommendation/ranking is application-owned. RSS/API/OAuth may broaden the candidate pool, while ranking remains separate and bounded by cache/quota budgets.

Start with transparent heuristics: freshness, already-shown penalty, click history, channel preference, and controlled randomness. Tune only after real usage data exists.

## Phase 9 — recurring simplification and real use

This is a loop, not an end phase:

1. stabilize and validate a feature batch
2. measure representative resident/interaction behavior
3. remove unnecessary dependencies, DOM/state work, polling, duplicate I/O, and broad rehydration
4. use the app daily and fix observed friction
5. repeat before the next broad feature batch

Performance wins require measurement rather than inference from structural refactors alone.

## Phase 10 — native decision

Only after product value is proven, compare Tauri against measured pain points: resident memory, idle CPU, startup, window behavior, and OS integration. A native rewrite is justified only by concrete benefit large enough to offset maintaining platform-specific implementations.

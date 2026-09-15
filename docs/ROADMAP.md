# Roadmap

Current checkpoint (2026-09-15): **functional MVP is in real-use expansion.** The Tauri shell, four-state loop, responsive 12×8 Board, SQLite cache/scheduler, source-aware refresh policy, and five working public-source presentations are implemented on the active source-expansion branch. PR #52 is code-complete for arXiv/Wikipedia/Qiita/Zenn/YouTube RSS and is waiting on final-head CI plus the user's planned real-desktop smoke test before merge. Optional YouTube Data API work is #53.

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
- [ ] Continue real-device transition/startup measurement as behavior evolves.

## Phase 3 — responsive Board

- [x] Empty-space add flow.
- [x] Responsive logical 12×8 grid persistence.
- [x] Grid-snapped drag and eight-direction resize.
- [x] Non-overlap without neighbor push/reflow.
- [x] Gesture-end persistence and legacy pixel-layout conversion.
- [ ] Continue real-device review across practical window sizes.

## Phase 4 — cache and scheduler

- [x] Source-scoped SQLite cache identity and canonical config.
- [x] Cache-first presentation.
- [x] Event/deadline-driven scheduler with bounded concurrency and persisted backoff.
- [x] Narrow refresh-path DB queries and narrow cache-change UI updates.
- [x] Global/source/widget refresh resolution with OFF and manual refresh.
- [x] Shared-source scheduling by canonical source identity.

## Phase 5 — real adapters

1. [x] arXiv — Atom metadata, editable query/result count, 24 h automatic floor, serialized request gate.
2. [x] Wikipedia — random MediaWiki discovery + PageImages, language/result settings, 6 h floor.
3. [x] Qiita — public items API + optional query, 1 h floor.
4. [x] Zenn — public trend/user/topic RSS, 1 h floor.
5. [x] YouTube RSS — selected-channel public RSS, thumbnails, typed channel/result settings, manual/source-aware refresh, 1 h floor.
6. [ ] YouTube Data API enrichment — optional user-supplied key with RSS fallback; tracked by #53.
7. [ ] YouTube OAuth/subscription-aware discovery — later update after practical non-OAuth use is proven.

PR #52's remaining gate is evidence, not adapter implementation: real desktop smoke testing and final merge validation.

## Phase 6 — API-assisted discovery and media discipline

Add Data API capability incrementally, beginning with `@handle` resolution/validation and only then useful visible metadata or bounded candidate discovery. API credentials are user-supplied; API/background work stays bounded to useful results.

For media loading: visible thumbnails first; near-visible preload only when justified; off-screen preload only after measurement; foreground work always wins.

## Phase 7 — recommendation

Recommendation/ranking is application-owned. RSS/API/OAuth may broaden the candidate pool, while ranking remains separate and bounded by cache/quota budgets.

Start with transparent heuristics: freshness, already-shown penalty, click history, channel preference, and controlled randomness. Tune only after real usage data exists.

## Phase 8 — recurring simplification and real use

This is a loop, not an end phase:

1. measure
2. remove unnecessary dependencies/DOM/state/background work
3. use the app daily
4. fix observed friction
5. repeat

Performance wins require measurement rather than inference from structural refactors alone.

## Phase 9 — native decision

Only after product value is proven, compare Tauri against measured pain points: resident memory, idle CPU, startup, window behavior, and OS integration. A native rewrite is justified only by concrete benefit large enough to offset maintaining platform-specific implementations.

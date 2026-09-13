from pathlib import Path

handoff = Path("docs/HANDOFF.md")
text = handoff.read_text()
text = text.replace(
    "- PR #34: first post-runtime deletion/simplification pass\n",
    "- PR #34: first post-runtime deletion/simplification pass\n- PR #40: editable validated arXiv widget source settings + contextual Board editor\n",
    1,
)
old = """Issue #5 (cache/scheduler), Issue #15 (Rust lockfile/reproducibility), Issue #21 (runtime/arXiv), and Issue #28 (first simplification pass) are complete.

Current product branch: `feat-widget-source-config`.
Current product issue: #35, editable source configuration for Board widgets. This is the final planned MVP feature slice before treating the current app as a usable first-complete checkpoint.

The first implementation targets arXiv only: query + bounded result count, source-specific validation, canonical sparse configuration, contextual widget-local editor, and narrow cache rehydration. Do not expose raw JSON in the normal UI and do not invent a generic settings framework until another adapter demonstrates a common schema.

Independent maintenance work exists in PR #38 (npm lockfile / `npm ci`) and stacked PR #39 (measured Rust/npm CI caching). Keep those maintenance changes separate from #35.
"""
new = """Issue #5 (cache/scheduler), Issue #15 (Rust lockfile/reproducibility), Issue #21 (runtime/arXiv), Issue #28 (first simplification pass), and Issue #35 (editable arXiv widget source configuration) are complete.

**Functional MVP checkpoint reached.** There is no active product feature branch. Idle / Compact / free-form Board, cached presentation, event-driven refresh, one real arXiv adapter, manual/automatic refresh, and contextual arXiv query/result-count editing are all on `main`, with Linux/Windows/macOS CI green on the merge candidate.

This is a first-complete usability checkpoint, not a claim that product validation is finished. The next product-facing work should come from real desktop use: capture the pending Idle CPU/RSS baseline, inspect small/wide/half-screen behavior, and fix observed friction before adding adapters indiscriminately. Issue #7's formal Figma comparison sheet also remains open and is design validation/polish rather than a blocker for this MVP checkpoint.

Independent maintenance work exists in PR #38 (npm lockfile / `npm ci`) and stacked PR #39 (measured Rust/npm CI caching). Keep maintenance changes separate from product behavior.
"""
if old not in text:
    raise RuntimeError("current checkpoint block not found")
text = text.replace(old, new, 1)
text = text.replace(
    "Cache hydration must not replace widget containers or reset pointer gestures; update only each widget's content node. The manual-refresh button is excluded from the drag-handle pointer path.",
    "Cache hydration must not replace widget containers or reset pointer gestures; update only each widget's content node. Manual-refresh and source-config controls are excluded from the drag-handle pointer path.",
    1,
)
old_restart = """## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Inspect Issue #28 and parent performance Issue #6.
3. Treat GitHub state as authoritative after an interrupted or overlapping stream.
4. For the simplification PR, require rustfmt, locked Rust tests/check, frontend build, and Tauri release build to pass on Linux/Windows/macOS.
5. Merge the simplification slice only if behavior stays unchanged and the command/policy duplication is genuinely reduced.
6. Capture the real release-build Idle baseline when a desktop session is available.
7. After that checkpoint, choose the next adapter deliberately (likely YouTube or Wikipedia) using the existing scheduler/runtime/cache boundary rather than inventing another framework.
"""
new_restart = """## Restart checklist

1. Read `AGENTS.md`, `README.md`, this file, and `docs/DECISIONS.md`.
2. Treat GitHub state as authoritative after an interrupted or overlapping stream; the product MVP checkpoint is PR #40 on `main`.
3. Inspect parent performance Issue #6, design Issue #7, and the independent maintenance PRs #38/#39 before starting new work.
4. Capture the real release-build Idle baseline when a desktop session is available; do not infer or fabricate the missing pre-adapter numbers.
5. Use the app on a real desktop at small, wide, and half-screen Board sizes and record concrete friction before broadening scope.
6. Choose the next adapter deliberately (likely YouTube or Wikipedia) only after that checkpoint, reusing the established scheduler/runtime/cache/source-config boundaries.
7. Keep Linux/Windows/macOS release-build CI green for every merge candidate.
"""
if old_restart not in text:
    raise RuntimeError("restart checklist not found")
text = text.replace(old_restart, new_restart, 1)
handoff.write_text(text)

roadmap = Path("docs/ROADMAP.md")
text = roadmap.read_text()
old_checkpoint = "Current checkpoint (2026-09-14): the runnable shell, state loop, free-form Board, cache/scheduler, first real arXiv adapter, and first simplification pass are implemented. Issue #35 adds editable widget source configuration and is the final planned MVP feature slice before a first-complete usability checkpoint. A reproducible desktop performance procedure exists, but the actual numeric Idle CPU/RSS baseline is still pending and must not be reconstructed from CI or estimates."
new_checkpoint = "Current checkpoint (2026-09-14): **functional MVP first-complete checkpoint reached.** The runnable shell, state loop, free-form Board, cache/scheduler, first real arXiv adapter, first simplification pass, and editable arXiv query/result-count UI are implemented on `main`. The next product checkpoint is real desktop validation and measurement, not automatic feature expansion. A reproducible performance procedure exists, but the actual numeric Idle CPU/RSS baseline is still pending and must not be reconstructed from CI or estimates."
if old_checkpoint not in text:
    raise RuntimeError("roadmap checkpoint not found")
text = text.replace(old_checkpoint, new_checkpoint, 1)
text = text.replace(
    "   - [ ] Editable query/result-count UI (#35; in progress).",
    "   - [x] Editable query/result-count UI (#35 / PR #40).",
    1,
)
roadmap.write_text(text)

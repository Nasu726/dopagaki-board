from pathlib import Path

handoff = Path("docs/HANDOFF.md")
text = handoff.read_text()

pr27 = "- PR #27: current `src-tauri/Cargo.lock` + `--locked` Rust CI on Linux/Windows/macOS\n"
if "- PR #34: first post-runtime deletion/simplification pass\n" not in text:
    if pr27 not in text:
        raise RuntimeError("PR #27 checkpoint line not found")
    text = text.replace(
        pr27,
        pr27 + "- PR #34: first post-runtime deletion/simplification pass\n",
        1,
    )

old = """Issue #5 (cache/scheduler) and Issue #15 (lockfile/reproducibility) are complete. Issue #21 closed with PR #26. The next product-development axis is performance/simplification (#6) before adding another adapter indiscriminately.

Current branch: `perf-simplification-pass-1`.
Current issue: #28, first deliberate post-runtime simplification pass.

Issue #28 currently removes stale bootstrap/debug command surface and centralizes automatic-refresh setting persistence/validation in `refresh_settings.rs`. It also corrects stale roadmap/performance documentation. This is intentionally a deletion/refactor slice, not a new feature.

Accidental duplicate Issues #29–#33 were created during tool setup and immediately closed as not planned. #28 is the canonical simplification issue.
"""
new = """Issue #5 (cache/scheduler), Issue #15 (Rust lockfile/reproducibility), Issue #21 (runtime/arXiv), and Issue #28 (first simplification pass) are complete.

Current product branch: `feat-widget-source-config`.
Current product issue: #35, editable source configuration for Board widgets. This is the final planned MVP feature slice before treating the current app as a usable first-complete checkpoint.

The first implementation targets arXiv only: query + bounded result count, source-specific validation, canonical sparse configuration, contextual widget-local editor, and narrow cache rehydration. Do not expose raw JSON in the normal UI and do not invent a generic settings framework until another adapter demonstrates a common schema.

Independent maintenance work exists in PR #38 (npm lockfile / `npm ci`) and stacked PR #39 (measured Rust/npm CI caching). Keep those maintenance changes separate from #35.

Accidental duplicate Issues #29–#33 were created during tool setup and immediately closed as not planned.
"""
if old not in text:
    raise RuntimeError("HANDOFF current checkpoint block not found")
text = text.replace(old, new, 1)

marker = "## Scheduler + runtime invariants\n"
section = """## Widget source configuration

Issue #35 establishes the source-editing boundary. Preserve these rules:

- widget source configuration is updated through an explicit Rust/Tauri command, never by direct frontend DB writes
- generic JSON shape canonicalization remains in `source_config.rs`; adapter semantics belong in the adapter
- arXiv defaults normalize sparsely, so `{}` and an explicit default query/count identify the same source and share cache/scheduler work
- invalid edits must leave the last persisted valid config untouched
- saving a config wakes the existing event/deadline runtime; it does not create another polling loop
- Board configuration UI is contextual and widget-local; opening or saving it must not rebuild the whole Board
- after a successful edit, update the in-memory widget config and rehydrate only that widget from the new source identity; later `cache-changed` events continue the normal narrow update path

The initial editor exposes arXiv `query` and `maxResults` (1..25). Other source kinds must not get placeholder configuration panels until their adapters define real user-facing fields.

"""
if marker not in text:
    raise RuntimeError("HANDOFF scheduler marker not found")
text = text.replace(marker, section + marker, 1)
handoff.write_text(text)

roadmap = Path("docs/ROADMAP.md")
text = roadmap.read_text()
old_checkpoint = "Current checkpoint (2026-09-14): the runnable shell, state loop, free-form Board, cache/scheduler, and first real arXiv adapter are implemented. The first deliberate post-runtime simplification pass is Issue #28. A reproducible desktop performance procedure exists, but the actual numeric Idle CPU/RSS baseline is still pending and must not be reconstructed from CI or estimates."
new_checkpoint = "Current checkpoint (2026-09-14): the runnable shell, state loop, free-form Board, cache/scheduler, first real arXiv adapter, and first simplification pass are implemented. Issue #35 adds editable widget source configuration and is the final planned MVP feature slice before a first-complete usability checkpoint. A reproducible desktop performance procedure exists, but the actual numeric Idle CPU/RSS baseline is still pending and must not be reconstructed from CI or estimates."
if old_checkpoint not in text:
    raise RuntimeError("ROADMAP checkpoint not found")
text = text.replace(old_checkpoint, new_checkpoint, 1)

old_arxiv = "1. [x] arXiv — async Atom metadata adapter, source-specific 24 h automatic-refresh floor, serialized request gate.\n2. [ ] YouTube"
new_arxiv = "1. [x] arXiv — async Atom metadata adapter, source-specific 24 h automatic-refresh floor, serialized request gate.\n   - [ ] Editable query/result-count UI (#35; in progress).\n2. [ ] YouTube"
if old_arxiv not in text:
    raise RuntimeError("ROADMAP arXiv section not found")
text = text.replace(old_arxiv, new_arxiv, 1)

text = text.replace(
    "Issue #28 is the first explicit post-runtime deletion/refactor slice. Parent tracking: #6.",
    "Issue #28 completed the first explicit post-runtime deletion/refactor slice. Parent tracking remains #6.",
    1,
)
roadmap.write_text(text)

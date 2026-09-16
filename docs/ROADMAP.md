# Roadmap

Current checkpoint (2026-09-16): **the five-source functional MVP is implemented and in real-use maintenance.** Historical completion details belong in GitHub Issues/PRs; this document keeps only the current and future implementation direction.

## Current — simplify and verify the baseline

Keep the existing arXiv, Wikipedia, Qiita, Zenn, and YouTube RSS product stable while reducing maintenance/runtime residue introduced during rapid real-device fixes.

- remove obsolete draft work and one-off patch layers that no longer own a durable responsibility
- keep frontend/Rust source defaults and canonical source identity aligned
- preserve cache-first startup, event/deadline-driven refresh, narrow Board rehydration, and bounded network work
- finish the consolidated Windows release-build smoke for the still-open verification issues (#59, #60, #61, #62, #66, #79, #87, #88, #89, #90)
- after interaction smoke is stable, run the #63 resident-performance gate from `PERF_BASELINE.md`
- fix visible or measured regressions before another broad feature batch

The current maintenance branch also audits whether files/dependencies/observers/listeners still justify their permanent resident and maintenance cost. Structural cleanup should remove accidental patch layering without inventing abstractions merely to make files smaller.

## Next — close remaining baseline usability gaps

The public-source baseline should be comfortable in ordinary daily use before expanding scope.

- finish YouTube human-facing channel setup (#90): normal handles/URLs already work without a Data API key, but resolution should avoid unnecessary repeated channel-page work and retain stable canonical source identity
- finish representative small/medium/large widget and shell interaction verification
- keep image enrichment bounded; remote-image failure must always degrade to usable text
- decide cached-data retention/eviction only when real usage provides enough evidence for a useful policy

## Optional YouTube Data API — #53

RSS remains the credential-free new-video transport. Data API support is optional and additive.

The first API-assisted slice should focus only on capabilities that actually require the API:

1. decide lightweight local storage for a user-supplied API key
2. add key validation/removal UI
3. add bounded visible metadata enrichment where it materially improves the click decision
4. add explicitly quota-bounded candidate discovery only after ordinary RSS use is proven

Handle/normal-channel-URL support is no longer a reason to require Data API configuration. API absence, failure, or quota exhaustion must preserve RSS functionality.

OAuth/subscription-aware discovery remains later work and requires explicit credential/scope/retention decisions before implementation.

## Recommendation

Recommendation/ranking remains application-owned. RSS/API/OAuth may broaden the candidate pool, but ranking stays separate from transport.

Start with transparent bounded heuristics using freshness, shown/click state, source/channel preference, and controlled randomness. Tune only after real usage data exists; do not build a broad crawler before there is evidence it improves discovery.

## Recurring simplification and measurement

This is a permanent development loop rather than a final phase:

`Implement -> Test -> Measure -> Refactor -> Delete -> Measure again -> Next feature`

After meaningful feature batches:

- remove unnecessary dependencies, DOM/state work, listeners/observers, polling, duplicate I/O, and broad rehydration
- verify that Hidden/Idle still avoid feed rendering/media work
- measure rather than infer CPU/RSS/network improvements
- keep Linux/Windows/macOS release-build CI green and use real-device smoke where CI cannot establish GUI behavior

## Native implementation decision

Do not rewrite the Tauri/WebView shell for aesthetic reasons. Revisit native UI only if measured resident memory, idle CPU, startup, window behavior, or OS integration becomes a concrete limitation large enough to justify platform-specific maintenance.

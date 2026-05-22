# Prism Knowledge V1-V3 Delivery Plan

This file is the execution checklist for making `prism knowledge` truly production-usable.

Implementation prep for V1: `docs/knowledge-v1-prep.md`.
Implementation prep for V2: `docs/knowledge-v2-prep.md`.
Implementation prep for V2.1: `docs/knowledge-v2.1-prep.md`.
Implementation prep for V2.2: `docs/knowledge-v2.2-prep.md`.
Implementation prep for V2.3: `docs/knowledge-v2.3-prep.md`.
Implementation prep for V2.4: `docs/knowledge-v2.4-prep.md`.
Implementation prep for V2.5: `docs/knowledge-v2.5-prep.md`.
Implementation prep for V2.6: `docs/knowledge-v2.6-prep.md`.
Implementation prep for V3: `docs/knowledge-v3-prep.md`.

## Outcome Target

By end of V3, Prism should provide:

1. Deterministic knowledge build (`prism knowledge build`)
2. Useful deterministic answer files (`prism knowledge answer`)
3. Deterministic incremental knowledge updates from git history (`prism knowledge update`)

All without LLM judgment for architecture facts.

## Version Summary

1. V1: Make answers useful from existing artifacts
2. V2: Scale + reliability hardening for real-world usage
3. V3: Commit-range incremental updates to keep knowledge fresh

---

## V1 - Useful Deterministic Answers

### Goal

Turn `knowledge answer` from basic keyword matching into high-signal, structured, grounded answers.

### Scope

1. Ingest richer analyze artifacts:
   - `graph/graph.json`
   - key `final/pages/*.md` sections
   - stronger use of `repo-index` and `insights`
2. Add deterministic query intents (for example):
   - `auth-flow`
   - `permissions`
   - `data-flow`
   - `failure-debug`
3. Render structured answers:
   - Entry points
   - Flow
   - Guards/permissions
   - State/tokens/dependencies
   - Failure paths
   - Evidence and gaps
4. Deduplicate repetitive insight rows and repeated findings.
5. Improve ranking heuristics by intent.

### Non-goals

1. No chatbot session memory
2. No LLM-based inference/guessing
3. No graph merge by speculation

### Done Criteria

1. Auth, permissions, and failure-debug questions produce materially useful answer files.
2. Evidence sections are concise, deduplicated, and grounded in artifact links.
3. Wrong-domain noisy matches are significantly reduced.
4. Deterministic output remains stable across repeated runs.

### Validation

1. Unit tests for intent routing + ranking + dedupe
2. Snapshot tests for answer file structure
3. Regression tests for `--code-root` grounding

---

## V2 - Hardening and Scale

### Goal

Make knowledge + answer workflows robust for larger repos and frequent usage.

### Scope

1. Performance and indexing improvements:
   - cached derived indices
   - bounded query paths
2. Confidence/gap reporting:
   - explicit uncertainty and missing evidence markers
3. Contradiction and staleness detection:
   - stale run warnings
   - conflicting artifact signals surfaced
4. Better batch workflows:
   - large questions-file handling
   - answer index/report quality
5. Documentation hardening:
   - operational guidance
   - troubleshooting patterns

### Non-goals

1. External DB dependency (still optional)
2. Runtime code execution in answer step

### Done Criteria

1. Works reliably on large artifact sets without brittle failure.
2. Batch answering is predictable and complete.
3. Reports clearly show confidence and evidence gaps.
4. End-to-end reruns remain resumable and deterministic.

### Validation

1. Large-fixture tests
2. Determinism checks across repeated runs
3. Failure-mode tests (partial/malformed/stale artifacts)

---

## V3 - Incremental Updates From Git History

### Goal

Keep knowledge current by processing commit ranges and updating only impacted slices.

### Scope

1. New command:
   - `prism knowledge update`
2. Git-driven change detection:
   - added/modified/deleted/renamed files
   - commit-range and batch support
3. Deterministic impact mapping:
   - changed files -> affected analyze entries/workdirs
4. Partial re-analysis and selective knowledge refresh.
5. Update reporting + state tracking:
   - processed commit range
   - changed entities
   - failures/gaps

### Proposed CLI (target)

```bash
prism knowledge update \
  --repo-root /path/to/repo \
  --knowledge-root .prism/knowledge \
  --from <commit> \
  --to <commit> \
  --batch-size 20
```

### Proposed Artifacts

1. `.prism/knowledge/state.json`
2. `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.json`
3. `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.md`

### Non-goals

1. Automatic background daemon behavior
2. LLM-based impact mapping

### Done Criteria

1. Same commit range gives identical update outputs.
2. Only impacted entries are reprocessed.
3. Deletions/renames are reflected in knowledge artifacts.
4. Update report explains exactly what changed and why.

### Validation

1. Git-fixture tests with synthetic commit history
2. Idempotency tests for same range
3. Rename/delete/add edge-case tests

---

## Cross-Version Guardrails

1. Deterministic and disk-backed by default
2. No silent artifact drops
3. Stable, versioned output schemas
4. Force/skip semantics stay consistent
5. PR review pipeline remains untouched

---

## Progress Tracker

Use this checklist while implementing:

### V1

- [ ] Rich artifact ingestion added
- [ ] Intent-aware deterministic query routing added
- [ ] Structured answer renderer added
- [ ] Insight dedupe/cluster added
- [ ] V1 tests green

### V2

- [ ] Scale/perf index layer added
- [ ] Confidence/gap reporting added
- [ ] Staleness/contradiction signals added
- [ ] Batch workflow hardened
- [ ] V2 tests green

### V3

- [x] `knowledge update` command added
- [x] Commit-range diff ingestion added
- [x] Impact mapping rules added
- [x] Selective re-analysis + refresh added
- [x] Update state/report artifacts added
- [x] V3 tests green

---

## Release Readiness Definition

Knowledge system is considered "goal achieved" when:

1. V1, V2, V3 checklists are complete.
2. Full test suite passes with new coverage.
3. Determinism verified in repeated runs.
4. Real repo smoke tests pass for:
   - build
   - answer
   - update
5. Docs are updated and operationally clear.

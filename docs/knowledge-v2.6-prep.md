# Prism Knowledge V2.6 Prep (Stabilization + Regression Hardening)

This file tracks V2.6 stabilization work before V3 polish.

## V2.6 Goal

Harden deterministic behavior, regression safety, and operational reliability for the full V2 knowledge-answer pipeline.

## Scope Freeze (V2.6)

### In Scope

1. Regression fixtures covering:
   - question classification
   - evidence-pack orchestration
   - fail-open decisions
   - batch index rendering
2. Deterministic snapshot tests:
   - single-question markdown/json/classification/evidence-pack
   - multi-question `index.md`
3. Performance guardrails:
   - bounded scans validated in tests
   - stable truncation behavior
4. Explicit truncation markers where output is capped.
5. One larger strict-mode golden batch scenario (10+ questions).

### Out of Scope

1. New retrieval/ranking logic (V2.1–V2.4 already set).
2. Incremental update semantics (V3 area).
3. Runtime daemon/service behavior.

## Stabilization Targets

1. Same inputs produce byte-identical outputs across reruns.
2. Batch index remains stable and parse-friendly at scale.
3. Strict categories remain deterministic and complete.
4. Fail-open behavior remains deterministic for ambiguous prompts.

## Test Plan

1. Golden snapshots for:
   - single answer markdown
   - single answer JSON
   - classification sidecar
   - evidence-pack sidecar
   - batch `index.md`
2. Determinism rerun checks with unchanged inputs.
3. Large batch strict test (10+ questions) with summary assertions.
4. Truncation marker assertions (`showing N of M` style).

## Done Checklist

- [x] regression fixtures added for V2 pipeline
- [x] deterministic snapshots added/updated
- [x] large strict batch test added
- [x] truncation markers standardized and tested
- [x] performance guardrail tests added
- [x] docs refreshed for stabilization expectations
- [x] `format:check`, `typecheck`, tests passing

## Completion Notes

1. Added deterministic rerun checks for markdown/json/classification/evidence-pack outputs.
2. Added strict large-batch (11 questions) coverage with stable `index.md` assertions.
3. Added bounded fallback scan guardrail assertions (`maxFiles`, scanned/matched consistency).
4. Standardized human-section truncation marker format to `- showing N of M ...` and added coverage.

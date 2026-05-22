# Prism Knowledge V2.5 Prep (Batch + Index UX Hardening)

This file tracks V2.5 implementation and validation.

## V2.5 Goal

Make multi-question runs (`--questions-file`) easier to review at scale with deterministic, high-signal batch summaries and per-question traceability.

## Scope Freeze (V2.5)

### In Scope

1. Improve batch `index.md` with richer per-question columns:
   - `questionClass`
   - `failOpen` status
   - `evidencePack` status
2. Add deterministic links to all per-question artifacts:
   - markdown answer
   - optional answer JSON
   - classification sidecar
   - evidence-pack sidecar
3. Add grouped deterministic summaries:
   - by strict failure category
   - by question class
   - by evidence-pack status
4. Add “needs follow-up” section:
   - ambiguous class
   - fail-open-triggered
   - partial evidence pack
5. Add tests for stable ordering and batch index content.

### Out of Scope

1. New retrieval/ranking logic.
2. Interactive chat behavior.
3. Incremental update workflow changes (V3 area).

## Batch Index Target (V2.5)

Core sections:

1. `Run Metadata`
2. `Answers Table`
3. `Strict Summary` (when strict is enabled)
4. `Class Summary`
5. `Evidence-Pack Summary`
6. `Needs Follow-Up`

## Determinism Contract

1. Per-question rows sorted by input order.
2. Summary groups sorted by key name, then count.
3. Paths rendered consistently relative to base dir.
4. Repeated runs with unchanged inputs are byte-identical.

## Test Plan

1. Multi-question snapshot checks for new table fields.
2. Strict-mode batch index checks with new grouped summaries.
3. Determinism test for repeated batch runs.
4. Follow-up section checks for ambiguous/fail-open questions.

## Done Checklist

- [x] batch answers table includes class/fail-open/evidence-pack columns
- [x] classification/evidence-pack sidecar links added
- [x] grouped class/evidence summaries added
- [x] deterministic “needs follow-up” section added
- [x] tests added for batch rendering and determinism
- [x] docs updated with new batch index contract
- [x] `format:check`, `typecheck`, tests passing

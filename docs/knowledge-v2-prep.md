# Prism Knowledge V2 Prep

This document turns V2 into implementation-ready slices.

## V2 Objective

Harden `prism knowledge answer` for scale, reliability, and repeatable operations on large artifact sets, while preserving:

1. deterministic output
2. disk-backed reproducibility
3. no LLM inference for architecture facts

## Scope Freeze (V2)

### In Scope

1. Deterministic section renderer upgrade for answer quality:
   - `Auth Flow`
   - `Guards & Permissions`
   - `Failure Paths`
   - `Evidence Map`
2. Batch reliability improvements:
   - consistent answer index behavior for large question sets
   - stable per-question failure reporting
3. Staleness and contradiction signals:
   - stale-run warnings surfaced clearly
   - conflicting evidence markers (when detectable from artifacts)
4. Operational hardening:
   - better strict-mode diagnostics
   - deterministic quality gates for CI usage
5. Documentation hardening for operators.

### Out of Scope

1. External DB dependency
2. Background daemon behavior
3. Git history incremental updates (V3)
4. Any probabilistic inference layer

## Proposed Implementation Slices

### Slice 1: Deterministic Section Renderer

Files:

1. `src/stages/knowledge/answer.ts`
2. `tests/knowledge.test.ts`

Work:

1. Add deterministic section blocks populated from existing evidence.
2. Keep evidence references explicit and traceable.
3. Ensure section ordering and formatting are stable.

Done when:

1. Auth/permissions/failure queries produce sectioned outputs.
2. Output is byte-stable on reruns with unchanged artifacts.

### Slice 2: Batch Robustness and Index Quality

Files:

1. `src/stages/knowledge/answer.ts`
2. `src/cli.ts`
3. `tests/knowledge.test.ts`

Work:

1. Strengthen batch index metadata (counts, strict summary if enabled).
2. Ensure per-question output naming collisions remain deterministic.
3. Keep partial successes usable in batch runs.

Done when:

1. Large question files produce complete answer sets deterministically.
2. Failures do not corrupt successful answer outputs.

### Slice 3: Staleness and Contradiction Signals

Files:

1. `src/stages/knowledge/build.ts`
2. `src/stages/knowledge/answer.ts`
3. `tests/knowledge.test.ts`

Work:

1. Surface stale-run signals more explicitly in answer metadata.
2. Add deterministic contradiction flags from artifact-level conflicts (where derivable).
3. Keep warnings actionable and source-linked.

Done when:

1. Stale/conflicting evidence is visible in answer output.
2. No silent degradation on stale/missing artifacts.

### Slice 4: Strict Mode Hardening for CI

Files:

1. `src/stages/knowledge/answer.ts`
2. `src/lib/knowledge-options.ts`
3. `src/cli.ts`
4. `tests/knowledge.test.ts`

Work:

1. Add deterministic strict failure categories.
2. Improve strict summaries for multi-question runs.
3. Ensure strict mode is easy to consume in CI logs.

Done when:

1. Strict failures are concise, deterministic, and parse-friendly.
2. CI users can gate pipelines with clear actionable messages.

### Slice 5: Docs and Schema Contract

Files:

1. `docs/knowledge-v0.md`
2. `README.md`
3. `docs/knowledge-answer-schema.md` (new)

Work:

1. Publish stable JSON answer schema contract.
2. Document strict-mode operational patterns.
3. Add troubleshooting playbook for common artifact gaps.

Done when:

1. Operators can run and debug V2 without reading source code.
2. JSON consumers have a clear schema contract.

## V2 Test Matrix

### Unit/Integration

1. Section renderer stability tests.
2. Batch runs with mixed-quality questions.
3. Stale artifact and contradiction signal tests.
4. Strict-mode multi-question failure summarization tests.
5. Deterministic JSON and Markdown parity checks.

### Smoke

1. Arcana build + answer batch run (`--emit-json`).
2. Arcana strict run with high threshold.
3. Validate answer index and strict summaries.

## Acceptance Criteria (V2 Exit)

1. `bun run format:check`, `bun run typecheck`, `bun test`, and `git diff --check` pass.
2. Answer quality improves with deterministic sections and clearer evidence mapping.
3. Batch and strict workflows are reliable for CI usage.
4. Staleness/conflict signals are explicit and actionable.
5. JSON schema doc is published and aligned with emitted output.

## Execution Order

1. Slice 1 (section renderer)
2. Slice 2 (batch robustness)
3. Slice 4 (strict hardening)
4. Slice 3 (staleness/conflict signals)
5. Slice 5 (schema/docs)

This order improves user value early while minimizing churn.

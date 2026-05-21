# Prism Knowledge V1 Prep

This document converts the V1 roadmap into an implementation-ready plan.

## V1 Objective

Improve `prism knowledge answer` from keyword listing to useful deterministic answers while preserving:

1. No LLM inference
2. Disk-backed reproducibility
3. Stable, testable output format

## Scope Freeze (V1)

### In Scope

1. Deterministic query intents:
   - `auth-flow`
   - `permissions`
   - `data-flow`
   - `failure-debug`
   - `general` fallback
2. Richer evidence ingestion from existing artifacts:
   - `graph/graph.json` (typed edges)
   - `repo-index/repo-index.json` (module/symbol summaries)
   - `insights/insights.json` (deduped insight evidence)
   - selected `final/pages/*.md` references (pointer-level, not free-form semantic parsing)
3. Structured answer template with deterministic sections:
   - Summary
   - Entry points
   - Flow narrative (deterministic from edges + ranked entries)
   - Guards and permissions
   - Failure paths
   - Evidence map
   - Gaps/limits
4. Insight dedupe/grouping rules.
5. Better ranking heuristics by intent.

### Out of Scope

1. Any LLM reasoning
2. Cross-entry graph merge speculation
3. Background/daemon updates (V3)
4. External database

## Proposed Implementation Slices

### Slice 1: Intent Classifier (Deterministic)

Files:

1. `src/stages/knowledge/answer.ts`
2. `tests/knowledge.test.ts`

Work:

1. Add `classifyIntent(question)` using keyword dictionaries and precedence rules.
2. Persist detected intent in answer metadata.

Done when:

1. Intent is deterministic for same question string.
2. Tests cover each intent and collision precedence.

### Slice 2: Evidence Model Expansion

Files:

1. `src/stages/knowledge/answer.ts`
2. `src/schemas/knowledge.ts` (only if answer-side schema contracts are expanded)
3. `tests/knowledge.test.ts`

Work:

1. Load `graph.json` when present for matched entries.
2. Derive edge summaries by type buckets.
3. Add deterministic extraction of auth/permission/failure related signals.

Done when:

1. Answer contains flow evidence beyond name/path matching.
2. Missing artifacts degrade gracefully and are reported.

### Slice 3: Ranking v1 Heuristics

Files:

1. `src/stages/knowledge/answer.ts`
2. `tests/knowledge.test.ts`

Work:

1. Introduce weighted score components:
   - token/path/name matches
   - intent-specific boosts
   - entry status success boost
   - `code_file exists` boost
   - graph signal boost
2. Add deterministic tie-break ordering.

Done when:

1. Auth questions prioritize auth service/login/oauth/firewall entries.
2. Worker/noisy matches are lower ranked for auth intent.

### Slice 4: Insight Dedupe/Cluster

Files:

1. `src/stages/knowledge/answer.ts`
2. `tests/knowledge.test.ts`

Work:

1. Deduplicate repeated insights by stable key:
   - `(entry, lens, title, severity)`
2. Aggregate counts/evidence totals.

Done when:

1. Repeated cycle entries are clustered instead of repeated rows.

### Slice 5: Structured Renderer

Files:

1. `src/stages/knowledge/answer.ts`
2. `tests/knowledge.test.ts`
3. `README.md`
4. `docs/knowledge-v0.md` (or split to v1 doc if preferred)

Work:

1. Replace current generic narrative with sectioned deterministic template.
2. Add confidence and explicit gap notes from evidence coverage.

Done when:

1. Output is actionable and scan-friendly.
2. Sections are stable across reruns.

## Test Matrix (V1)

### Unit/Integration

1. Intent classification:
   - auth-flow question
   - permissions question
   - failure-debug question
2. Ranking correctness:
   - auth query ranks `auth-service` above unrelated workers
3. Dedupe:
   - repeated cycle insights collapse into grouped output
4. Missing artifact resilience:
   - absent `graph.json` does not crash, records gap
5. Determinism:
   - same inputs produce byte-identical answer file
6. CLI:
   - `knowledge answer --question ...`
   - `knowledge answer --questions-file ...`
   - `--code-root` grounding remains valid

### Smoke

1. Arcana auth query run writes useful answer file.
2. Evidence entries point to existing code files and relevant artifact pages.

## Acceptance Criteria (V1 Exit)

1. `format:check`, `typecheck`, `bun test`, `git diff --check` all pass.
2. Auth-system answer is concise, non-noisy, and grounded.
3. Duplicate insight spam removed.
4. Determinism preserved with repeat runs.

## Execution Order

1. Slice 1 (intent)  
2. Slice 3 (ranking)  
3. Slice 4 (dedupe)  
4. Slice 2 (graph signal enrichment)  
5. Slice 5 (renderer + docs)

This order gets usefulness wins early while reducing refactor churn.

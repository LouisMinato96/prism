# Session-2 Prompt (Start at v2.10 — Analyze Lens Expansion)

Use this after v2.8 (CLI scaffold) and v2.9 (deterministic aggregator) are complete and shipped.

```text
Continue from v2.10 in /Users/shubhammandal/Documents/SM/projects/prism.

Context:
- v2.7 (discovery), v2.8 (CLI scaffold), v2.9 (deterministic aggregator) are complete.
- `prism knowledge answer-report` exists, aggregates existing per-question sidecars deterministically, emits navigable folder.
- Existing `analyze` insights catalog has 5 lenses (layer-leak, direction-violation, cycle, hub, empty-diagram).
- This session adds 8 new deterministic lenses + plumbing through knowledge-pack so answer-report teaching pages (v2.11) can consume them.

Read first:
- docs/session-plans/knowledge-answer-report/01-new-session-versioned-plan.md  (lens catalog in §G, schema in §G)
- src/stages/analyze/insights.ts (existing 5-lens pattern to mirror)
- src/schemas/analyze.ts (AnalyzeInsight + AnalyzeInsightSchema to extend)

Constraints:
- No LLM at lens-detection time. AST walks via ts-morph (already a dep). No subprocess to eslint.
- Each lens isolated under src/stages/analyze/lenses/<lens-id>.ts
- Existing 5 lenses untouched
- Insights.json schema additions must be ADDITIVE only (optional fields)
- Determinism: same fixture input → byte-identical insights.json

v2.10 scope — 8 lenses to add:

1. hook-deps-mismatch        — Walk useEffect/useCallback/useMemo. Collect referenced identifiers vs deps array literal. Flag missing/extra. Severity medium/high.
2. complexity-hotspot        — Per-function: cyclomatic + cognitive (SonarQube algorithm). Thresholds 10/15/25. Severity low/medium/high.
3. type-safety-escape        — Count any/as/non-null assertions per file+function. Severity by density.
4. bloater                   — long-function (>50 LoC), long-file (>500 LoC), long-param-list (>4), large-class (>20 methods).
5. dead-code                 — Exported symbol with zero incoming graph edges. Reuse existing graph.
6. await-in-loop             — await inside for/while/for-of/for-in body (not for-await-of).
7. security-quick-win        — dangerouslySetInnerHTML, eval(, new Function(, hardcoded-secret regex (AWS AKIA[0-9A-Z]{16}, GCP, generic api-key prefixes).
8. todo-density              — TODO/FIXME/HACK/XXX comment count per file. Severity by density.

Schema extension (src/schemas/analyze.ts):
- AnalyzeInsightSchema.lens enum: extend with new 8 ids
- Add OPTIONAL fields: metric?: { name, value, threshold }, docsUrl?: string
- AnalyzeInsightSchema must remain backward compatible (existing artifacts still parse)

File layout:
- src/stages/analyze/lenses/hook-deps-mismatch.ts
- src/stages/analyze/lenses/complexity-hotspot.ts
- src/stages/analyze/lenses/type-safety-escape.ts
- src/stages/analyze/lenses/bloater.ts
- src/stages/analyze/lenses/dead-code.ts
- src/stages/analyze/lenses/await-in-loop.ts
- src/stages/analyze/lenses/security-quick-win.ts
- src/stages/analyze/lenses/todo-density.ts
- src/stages/analyze/lenses/index.ts        (registry: exports lens fn list + ids)

Each lens module shape:
  export const id = "<lens-id>";
  export function detect(input: LensInput): AnalyzeInsight[];
  where LensInput = { graph, repoIndex, sourceFiles: SourceFile[], opts: LensOptions }

src/stages/analyze/insights.ts becomes a thin orchestrator: import lenses from ./lenses, call each, concat + sort by id, write insights.json.

Pipe through knowledge build:
- src/stages/knowledge/build.ts already loads insights via loadInsightsSummaries. Verify new lens ids are accepted.
- KnowledgeInsightSummarySchema may need additive fields (metric, docsUrl). Bump if needed but stay at schemaVersion 1 if additive.

Suggested ownership split (parallelize lens work):
- Agent A: lenses 1-4 (hook-deps-mismatch, complexity-hotspot, type-safety-escape, bloater)
- Agent B: lenses 5-8 (dead-code, await-in-loop, security-quick-win, todo-density)
- Base session: schema extension, registry, integration, tests

Tests:
- tests/analyze-lenses.test.ts (new)
  - Per-lens: fixture file → expected insights array
  - Idempotency: same fixture twice → identical insights.json
  - Schema: each emitted insight parses against extended schema
- tests/knowledge.test.ts (extend)
  - Verify build pipes new lens insights into knowledge-pack
- Existing tests must remain green

Quality gates:
- bun run format:check
- bun run typecheck
- bun test
- git diff --check

Determinism verification:
- bun test (with fixture-based lens tests)
- regenerate analyze fixture twice; diff insights.json byte-identical

Final report back format:
- What changed
- Files changed
- Commands run
- Test results (existing + new lens tests)
- Determinism check result
- Remaining risks/follow-ups

After v2.10 ships, proceed to v2.11 (answer-report teaching pages consuming the new insights).
```

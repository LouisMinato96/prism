# New Claude Session Plan: Deterministic, Teachable `knowledge answer-report`

> **Status as of v2.7 discovery (complete):** baseline gates green, existing surface mapped, contract frozen. See §J for the discovery findings.

## A) Base Model Recommendation

Use Claude Code base model:

- Primary: `opus`
- Fallback: `sonnet`

Set model:

```bash
/model opus
```

Why:

- Spans CLI contracts, schemas, deterministic generation, new analyze lenses, tests, docs, backward compatibility.
- `opus` better for architecture/integration decisions in cross-cutting changes.

## B) Vision

`prism knowledge answer-report` is **not a navigation index** over existing answer artifacts. It is a **deterministic, teachable, multi-file report** that:

1. Aggregates per-question answer sidecars produced by `knowledge answer`.
2. Surfaces opinionated, codebase-grounded **insights** (SOLID-leaning, design patterns, React/TS/Next.js standards, security, performance, smells, complexity hotspots) per ranked entry.
3. Teaches the reader: each finding includes explanation + suggestion + canonical learning resource link (Fowler refactoring catalog, React docs, MDN, SonarSource rules).
4. Stays 100% deterministic: same inputs → byte-identical output. No LLM at report-generation time.

Heavy lifting (insight detection) lives in `analyze`. `answer-report` is the **teaching layer** that contextualizes those insights to the questions asked.

## C) Multi-Agent Topology

Base session responsibilities:

- Own architecture, sequencing, integration.
- Preserve deterministic, disk-backed behavior.
- Prevent regressions in: `review`, `analyze`, `knowledge build`, `knowledge answer`, `knowledge update`.
- Approve every version checkpoint.

Subagent roles:

| Role | Model | Write Scope | Purpose |
| --- | --- | --- | --- |
| Repo Cartographer | `sonnet`/`haiku` | Read-only | Inspect existing features, inputs/outputs, schemas, tests, docs, artifact shapes. |
| Contract Designer | `sonnet` | `src/schemas/knowledge.ts`, docs schema file, tests (after approval) | Freeze deterministic `answer-report` contract + folder schema + insight schema additions. |
| CLI/Options Implementer | `sonnet` | `src/cli.ts`, `src/lib/knowledge-options.ts`, tests | Add `prism knowledge answer-report` command + option validation. |
| Report Implementer | `sonnet` | new `src/stages/knowledge/report.ts` + local helpers | Implement deterministic multi-file report generation. |
| Lens Implementer | `sonnet` | `src/stages/analyze/lenses/*.ts`, schema extensions | Implement new deterministic insight lenses (one PR per lens). |
| Teaching-Page Implementer | `sonnet` | `src/stages/knowledge/report-pages/*.ts` | Render per-topic teaching pages from enriched insights. |
| Test/Fixture Agent | `sonnet`/`haiku` | `tests/knowledge.test.ts`, `tests/analyze-lenses.test.ts`, fixtures only | Add deterministic/idempotency/compatibility tests. |
| Docs Agent | `haiku`/`sonnet` | `README.md`, `docs/knowledge-answer-report-schema.md`, `docs/analyze-lenses.md` | Usage, output contract, lens catalog, operational guidance. |

Parallelization limits:

- Max 2 write-capable subagents at once.
- Never allow overlapping write scopes.
- Lens work parallelizes well: one subagent per lens, distinct files under `src/stages/analyze/lenses/`.
- Prefer contract-first flow: options/schema → generator → lenses → teaching pages → tests → docs.

Checkpoint rules:

- Each agent returns: files touched, assumptions, tests run, risks, unresolved questions.
- Base session reviews diff before next slice starts.

## D) Versioned Roadmap

| Version | Goal | Main Scope | Acceptance Criteria |
| --- | --- | --- | --- |
| **v2.7** ✅ | Discovery + contract freeze | Read repo state, document existing IO contracts, freeze answer-report + insight extension contracts. | Approved contract; no behavior changes. **Complete.** |
| **v2.8** | CLI/options scaffold | Add `prism knowledge answer-report` command shell + option parsing/validation + placeholder output folder (manifest.json + index.md only). | Existing commands unchanged; help/validation deterministic; second run byte-identical. |
| **v2.9** | Deterministic aggregator | Generate multi-file folder from existing `knowledge-pack`, `artifacts-index`, and `knowledge answer` JSON sidecars (`.json`, `.classification.json`, `.evidence-pack.json`). Emit pages: overview, evidence-map, class-breakdown, follow-up, strict-issues, integrity-signals; per-question pages; data/ jsons; diagrams/ copies. | Same input → byte-identical output; no LLM calls in renderer; no re-ranking/re-classification (consumes existing rankings only). |
| **v2.10** | Analyze lens expansion (8 new deterministic lenses) | Extend `src/stages/analyze/insights.ts` (split into `lenses/` directory). Pipe enriched insights through `knowledge build` into `knowledge-pack.json`. Schema additions: extend `AnalyzeInsightSchema.lens` enum, add optional `metric`/`docsUrl` fields. | All lenses idempotent; existing 5 lenses unchanged; insights.json shape additive only; tests for each lens with fixtures. |
| **v2.11** | answer-report teaching pages | Render per-topic teaching pages consuming v2.10 enriched insights: SOLID-leaning, design patterns, React standards, TS standards, security, performance, bloater smells, coupling/cohesion, complexity-hotspots, test-coverage-gaps, glossary. Each finding: file:line + explanation + suggestion + canonical doc link. | Report is genuinely teachable for focused human study; per-finding deterministic ordering; every detected item links to source + canonical reference; glossary page complete. |
| **v2.12** | Hardening + docs gate | Final tests/docs and full quality gates. README capability matrix updated. Schema docs for answer-report + new lenses. | format/typecheck/test/diff-check pass; docs complete; example walkthrough in README. |

## E) Required v2.7 Discovery Step (✅ Complete)

See §J for findings. Re-run if revisiting:

```bash
cd /Users/shubhammandal/Documents/SM/projects/prism

git status --short --branch
git log --oneline -5

sed -n '1,260p' src/cli.ts
sed -n '1,260p' src/lib/knowledge-options.ts
sed -n '1,360p' src/schemas/knowledge.ts
sed -n '1,320p' src/stages/knowledge/build.ts
sed -n '1,760p' src/stages/knowledge/answer.ts
sed -n '1,320p' src/stages/knowledge/update.ts
sed -n '1,360p' tests/knowledge.test.ts
sed -n '1,260p' docs/knowledge-answer-schema.md
sed -n '1,320p' README.md

# Existing analyze insight surface (the bedrock answer-report extends)
sed -n '1,260p' src/stages/analyze/insights.ts
ls prompts/
```

Baseline quality gate:

```bash
bun run format:check
bun run typecheck
bun test
git diff --check
```

## F) Target Output Shape (`answer-report`)

```text
.prism/knowledge/answer-reports/<digest>/
├── manifest.json
├── index.md                         # mermaid nav + snapshot + reading order + top-insights + strict banner
├── validation-report.md             # missing artifacts + gaps + strict issues + integrity signals
├── pages/
│   ├── 00-overview.md               # question list w/ class/confidence/evidence/fail-open badges
│   ├── 01-evidence-map.md           # cross-question entry rollup (entry → questions referencing it, total score)
│   ├── 02-class-breakdown.md        # class histogram + per-class question list
│   ├── 03-follow-up.md              # fail-open + ambiguous + partial-evidence questions w/ candidate topics
│   ├── 04-strict-issues.md          # category table + per-issue rows
│   ├── 05-integrity-signals.md      # stale + contradiction signals consolidated
│   ├── 06-diagram-index.md          # diagrams referenced across questions
│   ├── 10-solid-review.md           # SRP/DIP heuristic findings on referenced entries  (v2.11)
│   ├── 11-design-patterns.md        # patterns present + anti-patterns                  (v2.11)
│   ├── 12-react-standards.md        # hooks, deps, rerender, purity, effects             (v2.11)
│   ├── 13-typescript-standards.md   # any/as/non-null/floating-promises                  (v2.11)
│   ├── 14-security.md               # dangerouslySetInnerHTML/eval/hardcoded-secret      (v2.11)
│   ├── 15-performance.md            # await-in-loop, deep-clone, etc                     (v2.11)
│   ├── 16-bloaters-smells.md        # long-function, long-file, long-param-list          (v2.11)
│   ├── 17-coupling-cohesion.md      # existing cycles + hubs + new metrics               (v2.11)
│   ├── 18-complexity-hotspots.md    # cyclomatic + cognitive complexity rankings         (v2.11)
│   ├── 19-test-coverage-gaps.md     # source files without sibling test                  (v2.11)
│   └── 99-glossary.md               # teaches what each smell/pattern/metric means       (v2.11)
├── questions/
│   └── <q-digest>.md                # per-question: digest, class, confidence, links to answer .md + sidecars, top entries summary, evidence-pack status, lens findings for this question's entries
├── data/
│   ├── questions.json               # array of question summaries
│   ├── entries-rollup.json          # entry-path → [{questionDigest, score, run}]
│   ├── strict-rollup.json           # categories with question lists
│   └── lens-findings.json           # lens-id → entries → findings  (v2.11)
└── diagrams/                        # copies of analyze diagrams referenced
```

**Digest rule**: SHA-1(12) of sorted `[knowledge-pack mtime+path, artifacts-index mtime+path, each answer sidecar mtime+path, each lens-finding mtime+path]`.

**Determinism rules:**

- No LLM-generated facts in report generation.
- Template + schema transform only.
- Stable sorting for rows/lists.
- No wall-clock-based volatile fields. `generatedAt` = max mtime of inputs.
- Strict mode writes files first, then exits non-zero if strict gates fail.
- Reuse existing helpers: `writeJsonIfChanged`/`writeTextIfChanged` from `build.ts`, `escapeTableCell`/`toDisplayPath`/`slugifyQuestion`/`readArtifactTextIfExists` from `answer.ts`.

## G) Deterministic Insight Lens Catalog (v2.10)

Eight lenses to add to `src/stages/analyze/lenses/`. Each module exports `(graph, repoIndex, ast, opts) => AnalyzeInsight[]`. AST walks via `ts-morph` (already a dep). No subprocess to `eslint`; preserve determinism guarantee.

| # | Lens id | Severity range | Detection | Canonical link |
| --- | --- | --- | --- | --- |
| 1 | `hook-deps-mismatch` | medium / high | Walk `useEffect`/`useCallback`/`useMemo` callbacks. Collect referenced identifiers. Compare against deps array literal. Flag missing or extra. | [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks) |
| 2 | `complexity-hotspot` | low / medium / high | Per function: cyclomatic (count branches: `if`/`else if`/`case`/`&&`/`\|\|`/`?:`/`catch`) + cognitive (SonarQube algorithm: +1 base + nesting penalty). Thresholds 10/15/25. | [SonarQube cognitive complexity](https://www.sonarsource.com/resources/cognitive-complexity/) |
| 3 | `type-safety-escape` | info / medium | Count `any` type refs, `as` assertions, `!` non-null per file/function. Severity by density. | [typescript-eslint no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/) |
| 4 | `bloater` | low / medium / high | Long-function (>50 LoC), long-file (>500 LoC), long-param-list (>4), large-class (>20 methods). Thresholds configurable. | [Refactoring.guru Bloaters](https://refactoring.guru/refactoring/smells/bloaters) |
| 5 | `dead-code` | low | Exported symbol with zero incoming graph edges. Reuse existing graph. | [Fowler dead code](https://refactoring.com/catalog/removeDeadCode.html) |
| 6 | `await-in-loop` | medium | AST: `await` inside `for`/`while`/`for-of`/`for-in` body (not `for-await-of`). | [MDN await in loop](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await) |
| 7 | `security-quick-win` | high / critical | `dangerouslySetInnerHTML` usage, `eval(`/`new Function(`, hardcoded-secret regex (AWS `AKIA[0-9A-Z]{16}`, GCP, generic api-key patterns). | [SonarSource security rules](https://rules.sonarsource.com/typescript/type/vulnerability/) |
| 8 | `todo-density` | info / low | `TODO`/`FIXME`/`HACK`/`XXX` comment count per file. Severity by density. | — |

Plus existing 5 (unchanged): `layer-leak`, `direction-violation`, `cycle`, `hub`, `empty-diagram`.

**Schema extension** (`src/schemas/analyze.ts`):

```typescript
AnalyzeInsightSchema extended with:
  lens: enum extended w/ new ids
  metric?: { name: string; value: number; threshold: number }   // for numeric lenses
  docsUrl?: string                                                // canonical learning link
```

**Out of v2.10 scope** (defer):

- LSP / inappropriate-intimacy / feature-envy / data-clumps (high false-positive without type-flow analysis)
- Next.js-specific (RSC boundaries, server actions) — reliable detection needs Next.js project shape detection
- a11y (separate JSX semantics effort)
- Cross-class metrics (LCOM, instability) — codebase mostly functional TS
- Pattern presence catalog (Singleton/Factory/HOC/Adapter etc.) — defer to v2.13+ once base lens infrastructure proven

## H) Quality Gates per Version

Every version:

```bash
bun run format:check
bun run typecheck
bun test
git diff --check
```

v2.9+ determinism check:

```bash
rm -rf /tmp/prism-report-a /tmp/prism-report-b

bun bin/prism knowledge answer-report \
  --knowledge-root .prism/knowledge \
  --answers-dir .prism/knowledge/answers \
  --report-out /tmp/prism-report-a

bun bin/prism knowledge answer-report \
  --knowledge-root .prism/knowledge \
  --answers-dir .prism/knowledge/answers \
  --report-out /tmp/prism-report-b

diff -ru /tmp/prism-report-a /tmp/prism-report-b
```

v2.10 lens determinism check (per lens fixture):

```bash
# Same fixture input → byte-identical insights.json
bun test tests/analyze-lenses.test.ts
```

## I) Risk Register + Mitigation

| Risk | Mitigation |
| --- | --- |
| Report invents facts | Renderer consumes only existing artifacts/JSON fields; no LLM in answer-report. |
| Regression in `knowledge answer` | Compatibility tests + isolated new command/stage. |
| Regression in `analyze` from new lenses | Each lens isolated under `lenses/`; existing 5 lenses untouched; lens registry composable. |
| Non-deterministic output ordering | Canonical sort rules and deterministic serialization. |
| Lens false positives | Conservative thresholds, severity tuned low for noisy lenses; lens can be disabled via config in v2.12+. |
| Noise/oversized report | Bounded sections, explicit truncation markers, manifest counts. |
| Dirty workspace artifacts interference | Use temp output dirs for deterministic tests. |
| `ts-morph` AST drift across TS versions | Pin TS version; lens tests use literal fixture source files. |
| Hardcoded-secret regex false positives | Restrict to high-entropy patterns + known prefixes; severity `medium` not `critical` for generic matches. |

Rollback strategy:

- Keep `answer-report` isolated to new subcommand and new stage module.
- Avoid mutating existing knowledge artifacts by default.
- New lenses isolated under `src/stages/analyze/lenses/`; revert by removing registry entry.
- If needed, remove new wiring/modules without touching existing command paths.

## J) v2.7 Discovery Findings (Frozen)

**Baseline gates green:** format ✓, typecheck ✓, 71/71 tests pass (5.68s), diff --check clean.

**Existing surface:**

- `src/cli.ts` (487 LoC): `knowledge build`/`answer`/`update` wired; each calls option resolver → stage runner → `log.done` paths.
- `src/lib/knowledge-options.ts` (148 LoC): clean resolver pattern; `cleanOption`/`cleanOptional` helpers; validates + defaults + throws on invalid.
- `src/schemas/knowledge.ts` (413 LoC): zod schemas at version 1. Existing: KnowledgePack, ArtifactsIndex, KnowledgeQuestionClassification, KnowledgeUpdateReport, KnowledgeState.
- `src/stages/knowledge/build.ts` (984 LoC): emits `knowledge-pack.json` + `artifacts-index.json` + `validation-report.md`. Reusable: `writeJsonIfChanged`/`writeTextIfChanged`/`resolveGeneratedAt`/`renderValidationSection`.
- `src/stages/knowledge/answer.ts` (3532 LoC): per-question MD + `.classification.json` + `.evidence-pack.json` + optional `.json`. Reusable: `escapeTableCell`/`slugifyQuestion`/`toDisplayPath`/`readArtifactTextIfExists`/`loadDiagramManifest`/`summarizeGraph`/`rankEntryMatches`/`dedupeInsightMatches`.
- `src/stages/knowledge/update.ts` (1003 LoC): git-backed incremental refresh. Same write-if-changed pattern.
- `src/stages/analyze/insights.ts` (248 LoC): **only 5 lenses today** (layer-leak, direction-violation, cycle, hub, empty-diagram). This is the bedrock v2.10 extends.
- `prompts/`: `review-solid.md`, `review-patterns.md`, `review-react.md`, `review-nextjs.md`, `architecture.md`, `aggregate.md`. PR review uses LLM for SOLID/patterns/React/Next.js (non-deterministic). `answer-report` must achieve similar coverage **deterministically**.

**Reuse precedents:**

- Analyze pipeline output is the gold standard: SHA-1 workdir naming, `final/index.md` + `pages/00-12-*.md` + `analysis.md` layered model, composable sort comparators, slice + truncation markers, escape helpers, `writeJsonIfChanged`/`writeTextIfChanged` + `existsSync` cache check.
- Answer.ts already deterministically emits all per-question evidence. answer-report consumes; does not re-rank, re-classify, or re-fetch.

**Flag collisions:** none — `--report-out`, `--answers-dir`, `--answer-report` unused. `--out-dir` is taken by `answer` (answers output) → use `--report-out`.

**File layout fits:** `src/stages/knowledge/report.ts` parallel to `build.ts`/`answer.ts`/`update.ts`. Lens files: `src/stages/analyze/lenses/<lens-id>.ts` + `src/stages/analyze/lenses/index.ts` registry.

## K) References (Deterministic Insight Sources)

- [SonarSource TS React rules catalog](https://rules.sonarsource.com/typescript/tag/react/)
- [SonarQube 10.4 React rules](https://www.sonarsource.com/blog/clean-react-code-sonarqube)
- [SonarQube cognitive complexity whitepaper](https://www.sonarsource.com/resources/cognitive-complexity/)
- [Fowler refactoring catalog](https://refactoring.com/catalog/)
- [Refactoring.guru code smells](https://refactoring.guru/refactoring/smells)
- [eslint-plugin-react-hooks v7 recommended preset](https://react.dev/reference/eslint-plugin-react-hooks)
- [Rules of React (purity & determinism)](https://react.dev/reference/rules)
- [typescript-eslint rules](https://typescript-eslint.io/rules/)
- [Code smell detection ASTVisitor (ResearchGate)](https://www.researchgate.net/publication/341111058_Code_Smell_Detection_and_Refactoring_Using_ASTVisitor)
- [Detection of code smells in React TS apps (ScienceDirect 2025)](https://www.sciencedirect.com/science/article/abs/pii/S0950584925001740)
- [Refactoring for Software Design Smells (ACM)](https://dl.acm.org/doi/book/10.5555/2755629)
- [Static analysis tools curated list](https://github.com/analysis-tools-dev/static-analysis)

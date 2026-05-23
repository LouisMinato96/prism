# Knowledge Answer Report Schema

Schema contract for `prism knowledge answer-report`. Version: v2.26.

## Overview

`answer-report` aggregates existing `prism knowledge answer` sidecars into a deterministic, navigable multi-file report. No LLM is used at report-generation time. All content is rendered from answer sidecars, knowledge-pack insights, and artifacts-index metadata.

## Inputs

| Input | Source | Required |
| --- | --- | --- |
| `knowledge-pack.json` | `prism knowledge build` | yes |
| `artifacts-index.json` | `prism knowledge build` | yes |
| `*.classification.json` | `prism knowledge answer` (always emitted) | yes |
| `*.evidence-pack.json` | `prism knowledge answer` (always emitted) | yes |
| `*.json` (answer sidecar) | `prism knowledge answer --emit-json` | no (degrades gracefully) |
| `*.md` (answer markdown) | `prism knowledge answer` | no |

## Output Structure

```text
<report-root>/
├── manifest.json          # machine-readable run metadata
├── index.md               # navigation hub with mermaid reading-order
├── validation-report.md   # load warnings, malformed sidecars, integrity signals
├── pages/
│   ├── 00-overview.md           # question table with badges
│   ├── 01-evidence-map.md       # entry paths referenced across questions
│   ├── 02-class-breakdown.md    # class histogram + per-class lists
│   ├── 03-follow-up.md          # ambiguous/fail-open/partial-evidence rows
│   ├── 04-strict-issues.md      # strict category table + issue rows
│   ├── 05-integrity-signals.md  # stale-run and contradiction signals
│   ├── 06-diagram-index.md      # diagrams from artifacts-index entry workdirs
│   ├── 10-react-standards.md    # hook deps, direction violations
│   ├── 11-typescript-standards.md # type-safety escapes
│   ├── 12-security.md           # dangerouslySetInnerHTML, eval, secrets
│   ├── 13-performance.md        # await-in-loop serialization
│   ├── 14-bloaters.md           # long files/functions/params/classes
│   ├── 15-complexity-hotspots.md # cyclomatic/cognitive complexity
│   ├── 16-coupling-cohesion.md  # cycles, hubs, layer leaks, dead exports
│   ├── 17-todo-debt.md          # TODO/FIXME/HACK/XXX density
│   ├── 18-console-log.md        # console.log/warn/error/debug + debugger
│   ├── 19-unused-imports.md     # unreferenced import identifiers
│   ├── 20-promise-error-handling.md # .then() without .catch()
│   ├── 21-magic-numbers.md      # numeric literals without named constants
│   ├── 22-no-floating-promises.md # unhandled async calls
│   ├── 23-duplicate-string-literals.md # strings appearing 3+ times
│   ├── 24-excessive-nesting.md  # control flow nested beyond 4 levels
│   ├── 25-implicit-any-return.md # functions without return type annotations
│   ├── 26-empty-catch.md        # empty or comment-only catch blocks
│   ├── 27-long-parameter-list.md # functions with 5+ parameters
│   ├── 28-large-file.md         # files exceeding line/declaration thresholds
│   ├── 29-switch-without-default.md # switch missing default case
│   ├── 30-cross-slice.md        # repo-wide entry hotspots, lens co-occurrence
│   └── 99-glossary.md           # all 25 lens definitions
├── questions/
│   └── <digest>.md        # per-question detail page
└── data/
    ├── questions.json         # normalized question list
    ├── entries-rollup.json    # entry path rollup by score
    ├── strict-rollup.json     # strict issues + summary
    └── cross-slice.json       # repo-wide hotspots + lens co-occurrence
```

## Manifest Schema (`manifest.json`)

```typescript
interface KnowledgeAnswerReportManifest {
  schemaVersion: 1;
  generatedAt: string;             // ISO 8601 from max mtime of inputs
  digest: string;                  // SHA-1(12) content digest of all inputs
  knowledgeRoot: string;           // display path
  answersDir: string;              // display path
  reportRoot: string;              // display path
  strict: boolean;
  minConfidence: "low" | "medium" | "high" | null;
  counts: {
    inputs: number;                // total input files
    questions: number;             // normalized questions
    answerSidecars: number;        // classification + evidence-pack + answer-json total
    classificationSidecars: number;
    evidencePackSidecars: number;
    answerJsonSidecars: number;
    markdownSidecars: number;
    warnings: number;
    malformedSidecars: number;
    questionsWithoutJson: number;
    integritySignalsStale: number;
    integritySignalsContradiction: number;
  };
  strictSummary: StrictSummary | null;
  sources: string[];               // display paths of all inputs
  pages: Array<{ name: string; relPath: string }>;
}
```

## Strict Gates

Strict mode (`--strict`) evaluates each question against gates. Report files are always written first; strict failure causes a non-zero exit after writing.

| Category | Trigger | Since |
| --- | --- | --- |
| `confidence_below_min` | Answer confidence level below `--min-confidence` threshold | v2.9 |
| `question_class_ambiguous` | Question classified as `unknown_or_ambiguous` | v2.9 |
| `evidence_pack_incomplete` | Evidence pack status is `partial` | v2.9 |
| `fail_open_required` | Fail-open was triggered during answer generation | v2.9 |
| `missing_code_file` | Entry code file(s) have `codeExists === false` (requires .json sidecar) | v2.12 |

Deferred gates (v2.13+): `missing_graph`, `missing_repo_index`, `missing_final_index`, `missing_service_flow_page`.

### Strict Summary

```typescript
interface StrictSummary {
  questionCount: number;
  failedQuestionCount: number;
  issueCount: number;
  categories: Array<{ category: StrictCategory; count: number }>;
}
```

### Strict Issue

```typescript
interface StrictIssue {
  questionDigest: string;
  question: string;
  category: StrictCategory;
  detail: string;
}
```

## Data Schemas

### `data/questions.json`

```typescript
{
  schemaVersion: 1;
  count: number;
  questions: Array<{
    digest: string;
    question: string;
    class: QuestionClass;
    classConfidence: ClassConfidence;
    evidencePackStatus: "complete" | "partial";
    evidencePackRequirements: string[];
    evidencePackSatisfied: string[];
    evidencePackMissing: string[];
    confidence: { level: string; score: number } | null;
    failOpenTriggered: boolean | null;
    failOpenReasons: string[];
    intent: string | null;
    answerJsonPresent: boolean;
    entryCount: number;
    insightCount: number;
  }>;
}
```

### `data/entries-rollup.json`

```typescript
{
  schemaVersion: 1;
  entryCount: number;
  entries: Array<{
    path: string;
    questionCount: number;
    totalScore: number;
    maxScore: number;
    questions: Array<{
      digest: string;
      run: string;
      name: string;
      score: number;
      status: "success" | "failed";
      codeExists: boolean;
    }>;
  }>;
}
```

### `data/strict-rollup.json`

```typescript
{
  schemaVersion: 1;
  summary: StrictSummary | null;
  issues: Array<{
    questionDigest: string;
    category: StrictCategory;
    detail: string;
  }>;
}
```

### `data/cross-slice.json`

```typescript
{
  schemaVersion: 1;
  entryCount: number;
  lensCount: number;
  totalFindings: number;
  severityTotals: { high: number; medium: number; low: number; info: number };
  hotspots: Array<{
    entry: string;
    findingCount: number;
    severityScore: number;
    highCount: number;
    mediumCount: number;
    lowCount: number;
    infoCount: number;
    lensSpread: number;
    topLenses: string[];
  }>;
  coOccurrence: Array<{
    lensA: string;
    lensB: string;
    sharedEntryCount: number;
    entries: string[];
  }>;
}
```

## Determinism Rules

1. **Content-based digest**: report folder name is `SHA-1(12)` of concatenated `path|fileContent` for all inputs. Same content always produces same folder.
2. **Write-if-changed**: `writeTextIfChanged` / `writeJsonIfChanged` skip writes when content is byte-identical. Prevents mtime churn.
3. **Stable sort keys**: all lists sorted by deterministic keys (severity rank, metric value, file path, line number, digest, id).
4. **No LLM**: all rendering is string concatenation from loaded data. No model calls during report generation.
5. **Graceful degradation**: missing `.json` sidecars produce warnings but do not block report generation. Evidence map and entry rollup are empty without them.

## Teaching Pages (10-29)

Each teaching page follows a fixed structure:

1. Title and intro explaining the detection approach
2. Lens IDs and filter status
3. Findings table (severity, entry, file:line, title, detail, metric, docs link)
4. "How to Read These Findings" guidance
5. Canonical references with URLs

When `.json` sidecars are present, findings are filtered to entries referenced by ranked answers. Without sidecars, all entries from knowledge-pack insights are shown.

## Glossary (99)

Documents all 25 deterministic insight lenses:

- 20 AST lenses: `hook-deps-mismatch`, `complexity-hotspot`, `type-safety-escape`, `bloater`, `dead-code`, `await-in-loop`, `security-quick-win`, `todo-density`, `console-log`, `unused-imports`, `promise-error-handling`, `magic-number`, `no-floating-promises`, `duplicate-string-literal`, `excessive-nesting`, `implicit-any-return`, `empty-catch`, `long-parameter-list`, `large-file`, `switch-without-default`
- 5 graph lenses: `layering`, `react`, `diagrams`, `coupling-cycle`, `coupling-hub`

Each entry includes: description, severity ladder, typical metric, canonical reference URL.

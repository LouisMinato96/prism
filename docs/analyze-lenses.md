# Analyze Lenses

Complete catalog of all 13 deterministic insight lenses used by `prism analyze` and surfaced in `prism knowledge answer-report` teaching pages.

All detection is deterministic — AST walks or graph analysis, no LLM. Lenses run during `prism analyze` in the `insights` stage and their results propagate through `prism knowledge build` into `knowledge-pack.json`.

## Lens Registry

| # | Lens ID | Detection | Severity | Metric | Since |
| --- | --- | --- | --- | --- | --- |
| 1 | `hook-deps-mismatch` | AST | medium/low | categorical | v2.10 |
| 2 | `complexity-hotspot` | AST | low/medium/high | complexity score | v2.10 |
| 3 | `type-safety-escape` | AST | info/low/medium | escape count | v2.10 |
| 4 | `bloater` | AST | low/medium | LoC/param/method count | v2.10 |
| 5 | `dead-code` | Graph | low | categorical | v2.10 |
| 6 | `await-in-loop` | AST | medium | categorical | v2.10 |
| 7 | `security-quick-win` | AST | high | categorical | v2.10 |
| 8 | `todo-density` | AST | info/low/medium | marker count | v2.10 |
| 9 | `layering` | Graph | medium | categorical | v1 (legacy) |
| 10 | `react` | Graph | high | categorical | v1 (legacy) |
| 11 | `coupling` | Graph | high/low/info | categorical | v1 (legacy) |
| 12 | `diagrams` | Graph | info | categorical | v1 (legacy) |
| 13 | `dead-code` | Graph | low | categorical | v2.10 |

## AST Lenses (8)

### hook-deps-mismatch

**File**: `src/stages/analyze/lenses/hook-deps-mismatch.ts`

Walks `useEffect`, `useCallback`, `useMemo`, `useLayoutEffect` call sites. Collects identifiers referenced inside the callback body (excluding locals, builtins, and property access targets). Diffs against the deps array literal.

- **Missing deps** (referenced but not in array): severity `medium` — stale closure risk
- **Extra deps** (in array but not referenced): severity `low` — unnecessary re-runs

Each finding includes `file:line` location and the specific missing/extra identifier names.

**Canonical reference**: [eslint-plugin-react-hooks](https://react.dev/reference/eslint-plugin-react-hooks)

### complexity-hotspot

**File**: `src/stages/analyze/lenses/complexity-hotspot.ts`

Computes two metrics per function:

- **Cyclomatic complexity**: count of branching constructs (`if`, `case`, `catch`, `for`, `while`, `do`, `&&`, `||`, ternary)
- **Cognitive complexity** (simplified SonarQube): branches + nesting depth penalty

Reports `max(cyclomatic, cognitive)` as the complexity score.

| Threshold | Severity |
| --- | --- |
| >= 10 | low |
| >= 15 | medium |
| >= 25 | high |

**Metric**: `{ name: "complexity", value: <score>, threshold: 10 }`

**Canonical reference**: [SonarQube cognitive complexity whitepaper](https://www.sonarsource.com/resources/cognitive-complexity/)

### type-safety-escape

**File**: `src/stages/analyze/lenses/type-safety-escape.ts`

Counts per file:

- `any` type keyword occurrences
- `as` cast expressions
- `!` non-null assertion expressions

| Escape count | Severity |
| --- | --- |
| < 5 | info |
| 5–14 | low |
| >= 15 | medium |

**Metric**: `{ name: "escapes", value: <total>, threshold: 5 }`

**Canonical reference**: [typescript-eslint no-explicit-any](https://typescript-eslint.io/rules/no-explicit-any/)

### bloater

**File**: `src/stages/analyze/lenses/bloater.ts`

Detects classic Fowler bloater smells:

| Smell | Threshold | Severity |
| --- | --- | --- |
| Long file | > 500 LoC | low |
| Long function | > 50 LoC | low (> 50), medium (> 100) |
| Long parameter list | > 4 params | low |
| Large class | > 20 methods | medium |

Each finding includes the measured value as a metric.

**Canonical reference**: [Refactoring.guru: Bloaters](https://refactoring.guru/refactoring/smells/bloaters)

### dead-code

**File**: `src/stages/analyze/lenses/dead-code.ts`

Pure graph analysis. Identifies exported symbols (excluding the entry file) that have zero incoming graph edges within the analyzed scope.

- Severity: `low` (may have consumers outside scope)
- No metric (categorical)

**Canonical reference**: [Fowler: removeDeadCode](https://refactoring.com/catalog/removeDeadCode.html)

### await-in-loop

**File**: `src/stages/analyze/lenses/await-in-loop.ts`

Detects `await` expressions inside `for`, `for...in`, `for...of`, `while`, `do...while` loops. Excludes intentional `for await...of` loops (checked via `getAwaitKeyword()` on the loop node).

- Severity: `medium`
- No metric (categorical)

**Canonical reference**: [MDN: await operator](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await)

### security-quick-win

**File**: `src/stages/analyze/lenses/security-quick-win.ts`

Detects high-signal security risks:

| Pattern | Detection |
| --- | --- |
| `dangerouslySetInnerHTML` | JSX attribute name match |
| `eval()` | Call expression with `eval` identifier |
| `new Function()` | New expression with `Function` identifier |
| Hardcoded secrets | Regex patterns: AWS `AKIA...`, GCP `AIza...`, GitHub `ghp_...`, OpenAI `sk-...` |

- Severity: `high` for all findings
- No metric (categorical)

**Canonical reference**: [SonarSource TypeScript vulnerabilities](https://rules.sonarsource.com/typescript/type/vulnerability/)

### todo-density

**File**: `src/stages/analyze/lenses/todo-density.ts`

Counts `TODO`, `FIXME`, `HACK`, `XXX` comment markers per file using regex `/\b(TODO|FIXME|HACK|XXX)\b/g` on the full file text.

| Marker count | Severity |
| --- | --- |
| < 5 | info |
| 5–14 | low |
| >= 15 | medium |

**Metric**: `{ name: "marker-count", value: <count>, threshold: 5 }`

**Canonical reference**: [Code Complete (McConnell)](https://stevemcconnell.com/cc2/)

## Graph Lenses (5 legacy)

These lenses run inline in `src/stages/analyze/insights.ts` and predate the lens registry. They operate on the typed dependency graph rather than individual source files.

### layering

Detects `calls` edges from a component node to a service node. Signals presentation/integration layer mixing.

- Severity: `medium`

**Canonical reference**: [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

### react

Detects direction violations where a hook depends on a component (reverse of expected React dependency direction).

- Severity: `high`

**Canonical reference**: [Rules of React](https://react.dev/reference/rules)

### coupling

Aggregates:

- Cycles in the architecture graph: severity `high`
- High fan-out symbols (many outgoing edges): severity `low`
- High fan-in symbols (many incoming edges): severity `info`

**Canonical reference**: [Wikipedia: Coupling](https://en.wikipedia.org/wiki/Coupling_(computer_programming))

### diagrams

Flags rendered diagrams that have zero edges. Typically signals an extraction gap or an architectural relationship not used in this slice.

- Severity: `info`

### dead-code (graph variant)

Shares the `dead-code` lens ID. Graph-based detection of exported symbols with zero incoming edges.

## Lens Input Interface

```typescript
interface LensInput {
  entry: string;
  scope: AnalyzeScope;
  symbols: AnalyzeSymbols;
  graph: AnalyzeGraph;
  diagrams: AnalyzeDiagram[];
  sourceFiles: Map<string, SourceFile>;  // ts-morph SourceFile instances
}
```

All 8 AST lenses receive the same `LensInput`. A single `ts-morph` Project is created once per analyze run, shared across all lenses, and disposed after detection completes.

## Adding a New Lens

1. Create `src/stages/analyze/lenses/<lens-id>.ts` exporting `detect(input: LensInput): AnalyzeInsight[]`
2. Register in `src/stages/analyze/lenses/index.ts` LENSES array (stable order)
3. Add a glossary entry in `src/stages/knowledge/report/teaching.ts` GLOSSARY array
4. Optionally add a teaching topic in the TOPICS array to surface findings in a dedicated page
5. Add a test in `tests/analyze-lenses.test.ts`

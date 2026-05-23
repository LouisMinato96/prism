# Analyze Lenses

Complete catalog of all 25 deterministic insight lenses used by `prism analyze` and surfaced in `prism knowledge answer-report` teaching pages.

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
| 9 | `console-log` | AST | info/low/medium | console-count | v2.13 |
| 10 | `unused-imports` | AST | low | categorical | v2.13 |
| 11 | `promise-error-handling` | AST | medium/low | categorical | v2.13 |
| 12 | `magic-number` | AST | info/low | magic-number-count | v2.13 |
| 13 | `no-floating-promises` | AST | medium/low | categorical | v2.16 |
| 14 | `duplicate-string-literal` | AST | info/low | duplicate-count | v2.16 |
| 15 | `excessive-nesting` | AST | low/medium | max-nesting-depth | v2.16 |
| 16 | `implicit-any-return` | AST | info/low | implicit-return-count | v2.16 |
| 17 | `empty-catch` | AST | medium/low | categorical | v2.21 |
| 18 | `long-parameter-list` | AST | low/medium | param-count | v2.21 |
| 19 | `large-file` | AST | low/medium | file-line-count | v2.22 |
| 20 | `switch-without-default` | AST | info | categorical | v2.22 |
| 21 | `layering` | Graph | medium | categorical | v2.23 |
| 22 | `react` | Graph | high | categorical | v2.23 |
| 23 | `diagrams` | Graph | info | categorical | v2.23 |
| 24 | `coupling-cycle` | Graph | high | categorical | v2.24 |
| 25 | `coupling-hub` | Graph | low/info | categorical | v2.24 |

## AST Lenses (20)

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

### console-log

**File**: `src/stages/analyze/lenses/console-log.ts`

Detects `console.log`, `console.warn`, `console.error`, `console.debug` calls and `debugger` statements.

| Pattern | Severity |
| --- | --- |
| `console.log` / `console.debug` | info |
| `console.warn` / `console.error` | low |
| `debugger` | medium |

Files with 3+ console calls also get a file-level summary finding.

**Metric**: `{ name: "console-count", value: <count>, threshold: 3 }`

**Canonical reference**: [MDN Console API](https://developer.mozilla.org/en-US/docs/Web/API/console)

### unused-imports

**File**: `src/stages/analyze/lenses/unused-imports.ts`

Detects import identifiers not referenced elsewhere in the file body. AST-only analysis; may produce false positives on type-only imports used solely in erased positions.

- Severity: `low`
- No metric (categorical)

**Canonical reference**: [typescript-eslint no-unused-vars](https://typescript-eslint.io/rules/no-unused-vars/)

### promise-error-handling

**File**: `src/stages/analyze/lenses/promise-error-handling.ts`

Detects `.then()` chains without a `.catch()` handler and `await` expressions at statement level not inside a `try/catch` block. Intentional fire-and-forget patterns and `await` in return/assignment positions are excluded.

- `.then()` without `.catch()`: severity `medium`
- Try-less `await`: severity `low`

**Canonical reference**: [MDN: Promise.prototype.catch()](https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch)

### magic-number

**File**: `src/stages/analyze/lenses/magic-number.ts`

Detects numeric literals used outside named constant contexts. Excludes 0/1/-1, const declarations, enum members, array indices, readonly properties, and loop bounds.

| Context | Severity |
| --- | --- |
| Isolated magic number | info |
| 3+ per function | low |

**Metric**: `{ name: "magic-number-count", value: <count>, threshold: 3 }`

**Canonical reference**: [SonarSource magic number (RSPEC-109)](https://rules.sonarsource.com/typescript/RSPEC-109/)

### no-floating-promises

**File**: `src/stages/analyze/lenses/no-floating-promises.ts`

Detects async function calls at statement level without `await`, `void`, or `.then()`/`.catch()`. Uses heuristics: `async` modifier, `Promise` return type annotation, or common async name prefixes (`fetch`, `send`, `post`, etc.).

- Confirmed async: severity `medium`
- Heuristic match: severity `low`

AST-only — cannot resolve return types through call chains.

**Canonical reference**: [typescript-eslint no-floating-promises](https://typescript-eslint.io/rules/no-floating-promises/)

### duplicate-string-literal

**File**: `src/stages/analyze/lenses/duplicate-string-literal.ts`

Detects string literals (>=3 chars) appearing 3+ times in the same file. Excludes import/require paths, type/interface positions, enum members, and property name keys.

| Occurrences | Severity |
| --- | --- |
| 3–4 | info |
| 5+ | low |

**Metric**: `{ name: "duplicate-count", value: <count>, threshold: 3 }`

**Canonical reference**: [SonarSource string literal duplication (RSPEC-1192)](https://rules.sonarsource.com/typescript/RSPEC-1192/)

### excessive-nesting

**File**: `src/stages/analyze/lenses/excessive-nesting.ts`

Measures maximum control flow nesting depth per function (`if`/`for`/`while`/`switch`/`try`). Distinct from `complexity-hotspot`: complexity counts branches, nesting counts depth.

| Depth | Severity |
| --- | --- |
| >= 5 | low |
| >= 7 | medium |

**Metric**: `{ name: "max-nesting-depth", value: <depth>, threshold: 5 }`

**Canonical reference**: [SonarSource control flow nesting (RSPEC-134)](https://rules.sonarsource.com/typescript/RSPEC-134/)

### implicit-any-return

**File**: `src/stages/analyze/lenses/implicit-any-return.ts`

Detects functions with return statements but no explicit return type annotation. Excludes arrow expression bodies (single-expression) and void functions.

| Count per file | Severity |
| --- | --- |
| Standalone | info |
| 3+ per file | low |

**Metric**: `{ name: "implicit-return-count", value: <count>, threshold: 3 }`

**Canonical reference**: [typescript-eslint explicit-function-return-type](https://typescript-eslint.io/rules/explicit-function-return-type/)

### empty-catch

**File**: `src/stages/analyze/lenses/empty-catch.ts`

Detects catch clauses with empty block bodies or blocks containing only comments.

| Pattern | Severity |
| --- | --- |
| Completely empty body | medium |
| Body with only comments | low |

**Canonical reference**: [SonarSource empty catch (RSPEC-2486)](https://rules.sonarsource.com/typescript/RSPEC-2486/)

### long-parameter-list

**File**: `src/stages/analyze/lenses/long-parameter-list.ts`

Detects functions with more than 4 non-rest parameters. Covers `FunctionDeclaration`, `ArrowFunction`, `MethodDeclaration`, `FunctionExpression`.

| Param count | Severity |
| --- | --- |
| 5–6 | low |
| 7+ | medium |

**Metric**: `{ name: "param-count", value: <count>, threshold: 5 }`

**Canonical reference**: [SonarSource too many parameters (RSPEC-107)](https://rules.sonarsource.com/typescript/RSPEC-107/)

### large-file

**File**: `src/stages/analyze/lenses/large-file.ts`

Flags files exceeding line count thresholds and files with high top-level declaration density. Distinct from `bloater` (function-level); this is pure file-level size.

| Metric | Threshold | Severity |
| --- | --- | --- |
| Line count | 300 | low |
| Line count | 500 | medium |
| Declaration count | 15 | low |

**Metric**: `{ name: "file-line-count", value: <count>, threshold: 300 }` or `{ name: "declaration-count", value: <count>, threshold: 15 }`

**Canonical reference**: [SonarSource files should not be too long (RSPEC-104)](https://rules.sonarsource.com/typescript/RSPEC-104/)

### switch-without-default

**File**: `src/stages/analyze/lenses/switch-without-default.ts`

Detects switch statements without a `default` clause. Checks `CaseBlock` children for the presence of a `DefaultClause`.

- Severity: `info`
- No metric (categorical)

**Canonical reference**: [eslint default-case](https://eslint.org/docs/latest/rules/default-case)

## Graph Lenses (5)

All graph lenses are registered in the lens framework and receive `LensInput` with access to `input.graph.edges`, `input.graph.nodes`, and `input.diagrams`. As of v2.24, there are zero legacy graph detectors — all operate through the lens registry.

### layering

**File**: `src/stages/analyze/lenses/layer-violation.ts`

Detects `calls` edges from a component node to a service node. Signals presentation/integration layer mixing.

- Severity: `medium`
- No metric (categorical)

**Canonical reference**: [Clean Architecture (Uncle Bob)](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)

### react

**File**: `src/stages/analyze/lenses/react-direction.ts`

Detects direction violations where a hook depends on a component (reverse of expected React dependency direction). Matches `calls` or `renders` edges from hook to component nodes.

- Severity: `high`
- No metric (categorical)

**Canonical reference**: [Rules of React](https://react.dev/reference/rules)

### diagrams

**File**: `src/stages/analyze/lenses/empty-diagram.ts`

Flags rendered diagrams that have zero edges. Typically signals an extraction gap or an architectural relationship not used in this slice.

- Severity: `info`
- No metric (categorical)

### coupling-cycle

**File**: `src/stages/analyze/lenses/coupling-cycle.ts`

Detects cycles in the architecture graph by walking architectural edges (`renders`, `calls`, `uses_hook`, `uses_context`, `provides_context`, `wraps`). Uses DFS with canonical cycle normalization to avoid duplicates.

- Severity: `high`
- No metric (categorical)

**Canonical reference**: [Wikipedia: Coupling](https://en.wikipedia.org/wiki/Coupling_(computer_programming))

### coupling-hub

**File**: `src/stages/analyze/lenses/coupling-hub.ts`

Identifies high fan-in and fan-out symbols in the architecture graph. Threshold: 4 edges. Excludes `file` type nodes.

| Pattern | Severity |
| --- | --- |
| Fan-out >= 4 | low |
| Fan-in >= 4 | info |

**Canonical reference**: [Wikipedia: Coupling](https://en.wikipedia.org/wiki/Coupling_(computer_programming))

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

All 25 lenses receive the same `LensInput`. A single `ts-morph` Project is created once per analyze run, shared across all lenses, and disposed after detection completes.

## Adding a New Lens

1. Create `src/stages/analyze/lenses/<lens-id>.ts` exporting `detect(input: LensInput): AnalyzeInsight[]`
2. Register in `src/stages/analyze/lenses/index.ts` LENSES array (stable order, append only)
3. Add a glossary entry in `src/stages/knowledge/report/teaching.ts` GLOSSARY array
4. Optionally add a teaching topic in the TOPICS array to surface findings in a dedicated page
5. Add a test in `tests/analyze-lenses.test.ts` — update count assertion and ID list
6. Update `tests/knowledge.test.ts` — glossary list and page count if adding a teaching page
7. Run all three gates: `bun run format:check`, `bunx tsc --noEmit`, `bun test`

## Future Lens Candidates

Patterns not yet implemented but viable as deterministic AST or graph lenses. Sorted roughly by signal-to-noise ratio.

### High Priority

| Candidate | Detection | What it catches | Reference |
| --- | --- | --- | --- |
| `nested-ternary` | AST | Ternary expressions nested 2+ levels deep; hard to read and refactor | [SonarSource RSPEC-3358](https://rules.sonarsource.com/typescript/RSPEC-3358/) |
| `god-class` | AST | Classes with 30+ methods or 1000+ LoC; too many responsibilities | [Refactoring.guru: Large Class](https://refactoring.guru/smells/large-class) |
| `circular-import` | Graph | File-level import cycles detected from `imports` edges in the graph | [eslint-plugin-import no-cycle](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-cycle.md) |
| `re-export-barrel` | AST | Barrel files (`index.ts`) re-exporting 20+ symbols; tree-shaking and IDE perf cost | [Marvin Hagemeister: barrel files](https://marvinh.dev/blog/speeding-up-javascript-ecosystem-part-7/) |

### Medium Priority

| Candidate | Detection | What it catches | Reference |
| --- | --- | --- | --- |
| `unused-variable` | AST | Variables declared but never read (excluding `_` prefix convention) | [typescript-eslint no-unused-vars](https://typescript-eslint.io/rules/no-unused-vars/) |
| `constant-condition` | AST | `if (true)`, `while (false)`, ternary with literal test — dead branches | [eslint no-constant-condition](https://eslint.org/docs/latest/rules/no-constant-condition) |
| `prefer-const` | AST | `let` declarations never reassigned — could be `const` | [eslint prefer-const](https://eslint.org/docs/latest/rules/prefer-const) |
| `no-shadow` | AST | Inner scope variable shadows outer scope name — confusing and error-prone | [typescript-eslint no-shadow](https://typescript-eslint.io/rules/no-shadow/) |
| `unsafe-optional-chain` | AST | `foo?.bar.baz` — optional chain followed by non-optional access | [typescript-eslint no-unsafe-optional-chaining](https://typescript-eslint.io/rules/no-unsafe-optional-chaining/) |
| `string-concat-in-loop` | AST | String concatenation (`+=`) inside loops; O(n^2) in naive engines | General perf pattern |

### Lower Priority / Niche

| Candidate | Detection | What it catches | Reference |
| --- | --- | --- | --- |
| `this-in-arrow` | AST | `this` inside arrow function where binding is unexpected | Common React/TS confusion |
| `export-default-anonymous` | AST | `export default function()` or `export default class` without name | [eslint-plugin-import no-anonymous-default-export](https://github.com/import-js/eslint-plugin-import/blob/main/docs/rules/no-anonymous-default-export.md) |
| `enum-mismatch` | AST | String enum values that don't match member names (e.g., `Foo = "bar"`) | Convention enforcement |
| `prop-drilling-depth` | Graph | Component receiving 5+ props that it passes unchanged to children | React-specific architecture pattern |
| `test-file-ratio` | AST | Source file without corresponding `.test.ts` / `.spec.ts` | Coverage proxy |
| `inconsistent-return` | AST | Function with both explicit `return value` and bare `return` / implicit return | [eslint consistent-return](https://eslint.org/docs/latest/rules/consistent-return) |
| `deep-import` | Graph | Imports reaching 3+ directory levels into another module's internals | Module boundary violation |

### Selection Criteria

When picking from this list:

1. **False positive rate** — prefer patterns detectable with AST-only context that produce < 5% noise
2. **Actionability** — every finding should have a clear next step (refactor, extract, rename)
3. **Distinctness** — no overlap with existing lenses (e.g., `god-class` overlaps with `bloater` on class size but uses a higher threshold and different heuristics)
4. **ts-morph feasibility** — detection must be implementable with `ts-morph` SyntaxKind walks, no type-checker required (keeps analysis fast and deterministic)

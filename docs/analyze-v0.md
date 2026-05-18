# Static Analysis v0

V0 is complete enough to hand off. Prism can deterministically analyze one bounded React/Next.js slice, persist facts to disk, and generate a layered report without asking the LLM to invent graph structure.

## V0 Completion Checklist

- [x] Bounded scope from one entry file and `--depth`
- [x] Config presets via `--config`
- [x] Symbol extraction for files, imports, exports, components, hooks, stores, services, functions, constants, classes, methods, and types
- [x] Repo index for compact file, symbol, export, and module inventory
- [x] Typed graph with deterministic edges
- [x] Small named diagrams
- [x] Deterministic insights from persisted facts
- [x] Layered report pages
- [x] Route, context, hook, store, store-surface, and service pages
- [x] Extraction gaps surfaced explicitly
- [x] Source references on guided pages 03-08
- [x] Interpretation guide
- [x] Symbol directory and module directory pages
- [x] AST fixture hardening for wrappers, hooks, stores, and route maps

## How To Run

Canonical scripted run:

```bash
prism analyze --config prism.analyze.json
```

Direct run:

```bash
prism analyze --entry src/app/page.tsx --depth 3
```

Useful flags:

- `--entry <path>`: required unless provided by config
- `--depth <n>`: maximum traversal depth from the entry file
- `--include <patterns>`: comma-separated allowlist globs
- `--exclude <patterns>`: comma-separated denylist globs
- `--force`: re-run every stage
- `--force-stage <name>`: re-run one stage (`scope`, `symbols`, `repo-index`, `graph`, `diagrams`, `insights`, or `report`)

Config values may use strings or arrays for `include` and `exclude`; CLI flags override config defaults.

Example `prism.analyze.json`:

```json
{
  "entry": "src/app/page.tsx",
  "depth": 3,
  "include": ["src/app/**", "src/components/**"],
  "exclude": ["generated/**"]
}
```

## How To Read The Output

Start with `final/index.md`. It gives the reading order, snapshot counts, top insights, and the link to the interpretation guide.

Then read `final/pages/10-interpretation-guide.md`. It explains:

- what the report can prove
- how to read source references
- how to interpret extraction gaps
- what not to conclude from structure alone

After that, follow the guided pages in order:

1. `00-entry-overview.md`
2. `11-symbol-directory.md`
3. `12-module-directory.md`
4. `01-entry-provider-stack.md`
5. `02-route-map.md`
6. `03-context-boundaries.md`
7. `04-hook-flow.md`
8. `05-state-store-map.md`
9. `06-store-surface.md`
10. `07-extraction-gaps.md`
11. `08-service-flow.md`
12. `09-debug-artifacts.md`

The guided pages 03-08 include source references. `09-debug-artifacts.md` points back to the JSON artifacts. `final/analysis.md` is the full deterministic detail report.

## Pipeline

```mermaid
flowchart LR
  scope --> symbols --> repoIndex["repo-index"] --> report
  symbols --> graph --> diagrams --> insights --> report
```

| Stage | Responsibility | Output |
| --- | --- | --- |
| `scope` | Resolve the entry point and candidate files | `scope.json` |
| `symbols` | Parse TS/TSX source and extract symbols | `ast-manifest.json`, `symbols.json` |
| `repo-index` | Build a compact file and symbol inventory | `repo-index.json` |
| `graph` | Resolve references and build typed nodes and edges | `references.json`, `graph.json` |
| `diagrams` | Produce small named Mermaid diagrams | `diagrams/*.md` |
| `insights` | Run deterministic architecture checks | `insights.json` |
| `report` | Generate the guided and detailed Markdown reports | `index.md`, `pages/*.md`, `analysis.md` |

Each stage reads from disk, writes to disk, and skips existing output unless forced.

## Workdir Layout

```text
.tmp/analyze/<run-id>/
├── raw/
│   └── entry.json
├── scope/
│   └── scope.json
├── symbols/
│   ├── ast-manifest.json
│   └── symbols.json
├── repo-index/
│   └── repo-index.json
├── graph/
│   ├── references.json
│   └── graph.json
├── insights/
│   └── insights.json
├── diagrams/
│   ├── manifest.json
│   ├── component-tree.md
│   ├── provider-stack.md
│   ├── hook-flow.md
│   ├── state-store-map.md
│   ├── store-surface.md
│   ├── context-boundaries.md
│   ├── route-map.md
│   ├── import-map.md
│   └── service-flow.md
└── final/
    ├── index.md
    ├── pages/
    │   ├── 00-entry-overview.md
    │   ├── 01-entry-provider-stack.md
    │   ├── 02-route-map.md
    │   ├── 03-context-boundaries.md
    │   ├── 04-hook-flow.md
    │   ├── 05-state-store-map.md
    │   ├── 06-store-surface.md
    │   ├── 07-extraction-gaps.md
    │   ├── 08-service-flow.md
    │   ├── 09-debug-artifacts.md
    │   ├── 10-interpretation-guide.md
    │   ├── 11-symbol-directory.md
    │   └── 12-module-directory.md
    └── analysis.md
```

## Graph Contract

The graph is the contract. LLM stages can summarize it, but they cannot invent graph facts.

### Node Types

| Type | Meaning |
| --- | --- |
| `file` | Source file in scope |
| `component` | React component |
| `hook` | Custom hook |
| `context` | React context object, provider, or consumer |
| `function` | Non-hook function |
| `constant` | Constant or config value |
| `store` | Zustand-style state store hook |
| `store_state` | State field exposed by a store |
| `store_getter` | Getter exposed by a store |
| `store_action` | Mutation or action exposed by a store |
| `class` | Class declaration |
| `method` | Class method |
| `type` | Type, interface, or schema |
| `service` | Function or module that performs IO, API, persistence, or integration work |

### Edge Types

| Type | From | To | Meaning |
| --- | --- | --- | --- |
| `imports` | file/symbol | file/symbol | Static import relationship |
| `exports` | file | symbol | Exported symbol |
| `renders` | component | component | JSX child or component usage |
| `calls` | symbol | function/service/method | Call expression |
| `uses_hook` | component/hook | hook | Hook call |
| `uses_context` | component/hook | context | Context access |
| `provides_context` | component | context | Provider boundary |
| `reads_constant` | symbol | constant | Constant or config usage |
| `uses_type` | symbol | type | Type dependency |
| `wraps` | component/function | component/function | HOC, decorator, factory wrapper, or JSX wrapper nesting |
| `selects_by` | symbol | constant | Dynamic selection from an object map |
| `routes_to` | constant | component | Object-map entry that routes to a component |
| `fallback_routes_to` | symbol | component | Conditional fallback branch after route selection |
| `uses_store` | component/hook | store | Reactive store subscription or selector wrapper |
| `reads_store` | component/hook/function | store | Imperative store snapshot read |
| `writes_store` | component/hook/function | store | Imperative store mutation or action call |
| `store_has_state` | store | store_state | Store owns a state field |
| `store_has_getter` | store | store_getter | Store exposes a getter |
| `store_has_action` | store | store_action | Store exposes a mutation or action |
| `invokes_store_action` | component/hook/function | store_action | Consumer invokes or selects a store action |

## Diagram Strategy

Prefer many small named diagrams before one large architecture diagram.

| Diagram | Source edges |
| --- | --- |
| `component-tree.md` | `renders` |
| `provider-stack.md` | `wraps` |
| `hook-flow.md` | `uses_hook`, hook-adjacent `calls` |
| `state-store-map.md` | `uses_store`, `reads_store`, `writes_store` |
| `store-surface.md` | `store_has_state`, `store_has_getter`, `store_has_action`, `invokes_store_action` |
| `service-flow.md` | service-adjacent `calls` |
| `context-boundaries.md` | `provides_context`, `uses_context` |
| `route-map.md` | `selects_by`, `routes_to`, `fallback_routes_to` |
| `import-map.md` | `imports` |

If a small diagram cannot explain a local part without reaching across unrelated layers, record that as an insight.

## Insight Model

Insights are structured before they become prose.

| Lens | Insight |
| --- | --- |
| `layering` | Component calls service directly |
| `react` | Hook depends on component |
| `coupling` | Cycle detected in architecture graph |
| `coupling` | High fan-in or fan-out symbol |
| `diagrams` | Named diagram has no matching edges |

Example:

```json
{
  "id": "layer-leak-001",
  "severity": "medium",
  "lens": "layering",
  "title": "Component reaches into persistence layer",
  "evidence": [
    {
      "from": "component:DashboardPage",
      "edge": "calls",
      "to": "service:writeMetricRecord"
    }
  ],
  "explanation": "Presentation code directly performs persistence work.",
  "suggestion": "Route persistence through a hook or service boundary."
}
```

## Report Shape

The V0 report is deterministic and layered:

1. `final/index.md`: start page with counts, reading order, top insights, and diagram size guidance
2. `final/pages/11-symbol-directory.md`: symbol, export, and type inventory
3. `final/pages/12-module-directory.md`: folder/module summaries for scoped files and symbols
4. `final/pages/00-08`: focused guided pages for entry, providers, routes, context, hooks, stores, gaps, and services
5. `final/pages/09-debug-artifacts.md`: raw artifact guide for graph traversal and proof
6. `final/pages/10-interpretation-guide.md`: reader guide for source references, extraction gaps, and limits
7. `final/analysis.md`: full deterministic detail report

An LLM-assisted narrative can sit on top later, once the underlying facts stay stable.

## Known V0 Limits

- V0 analyzes one repo slice from one entry point.
- V0 targets TypeScript and TSX first.
- V0 does not prove runtime behavior, correctness, security, or performance.
- V0 does not treat missing edges as proof of absence.
- V0 does not ask the LLM to discover graph facts.
- V0 does not produce source references on every page; they are present on guided pages 03-08 and summarized through the symbol/module directories.
- V0 may surface unresolved imports, empty diagrams, or unscoped nodes instead of forcing a guess.
- V0 is not a repo-wide architecture map.

## What Moved To Later Versions

- V1 added multi-entry orchestration without merging per-entry graphs.
- V2 added repo-index-backed symbol and module directories.
- V3 added the deterministic multi-entry architecture page.

Still future work:

- analysis profiles and rule/lens configuration
- better navigation than Markdown-only layered pages
- compare runs and architecture drift
- cleaner and richer diagrams
- better action and data-flow extraction
- broader language support
- CI-oriented workflows

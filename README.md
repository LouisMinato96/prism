# prism

A deterministic LLM-orchestrated PR review harness.

`prism` runs a fixed pipeline of stages over a GitHub pull request, calls Claude for each judgment-requiring step, and verifies completed reviews against deterministic AST-derived reviewable units. Coverage is enforced from code metadata, not accepted from LLM self-report.

## Why

LLM PR reviews are usually one shot, vague, and miss things. `prism` makes them:

- **Reproducible** — same inputs → same path through the pipeline.
- **Resumable** — every stage writes to disk; re-run continues from where it stopped.
- **Bounded** — concurrency caps, retry caps, iteration caps.
- **Verifiable** — coverage is computed from AST ground truth, not LLM self-report.

## Architecture

```
fetch  →  enumerate  →  classify  →  review  →  coverage  →  aggregate  →  architecture  →  post
 (gh)      (ts-morph)    (claude)    (claude×N)  (pure logic)  (claude)       (claude)        (gh)
```

Each stage:

- Reads its inputs from disk.
- Writes its outputs to disk.
- Skips cacheable outputs if they already exist (`--force` to override).

The reviewer fan-out runs in parallel (`PRISM_CONCURRENCY=4` by default).

### Enumeration (ts-morph)

The enumerate stage walks each TS/JS file's AST and extracts reviewable units:

| Kind        | Detection rule                                |
| ----------- | --------------------------------------------- |
| `function`  | Function declarations and arrow/function exprs |
| `component` | PascalCase function returning JSX             |
| `hook`      | Function named `use*` (for example `useAuth`) |
| `class`     | Class declarations                            |
| `method`    | Class methods, named `ClassName.methodName`   |

Files without extractable TS/JS units are recorded in `units/` with `units: null` and a reason. The current review fan-out only runs for files with extracted units, so non-TS/JS file-level review is not implemented yet.

### Reviewer input

Each reviewer receives one task per routed `(file, reviewer)` pair with extracted units:

- **UNITS TO ANALYZE** — unit metadata (kind, name, line, span)
- **DIFF** — per-file unified diff showing what changed
- **SOURCE** — full current source code for context

### Coverage retry loop

After the first review pass, coverage is computed by comparing `units_analyzed` against the ground-truth unit names for each completed review. If any units are missing, the reviewer is re-invoked with feedback listing the missed units. Results are merged and coverage is recomputed. This repeats up to `PRISM_MAX_ITER` times.

Review tasks that fail before producing a valid review JSON are tracked in `tasks/`, but they do not currently produce a `coverage/` JSON entry.

## Setup

```bash
bun install
bun link          # registers `prism` as a global command
```

## Usage

### PR Review

```bash
cd /path/to/your/repo
prism review 1234
prism review 1234 --post     # also post report as a PR comment
prism review 1234 --edit     # update the last prism comment instead
```

Output lands in `./.tmp/pr-1234/`:

```
.tmp/pr-1234/
├── raw/             # gh output (meta, full diff, file list)
├── diffs/           # per-file diffs split from full.patch
├── units/           # AST enumeration per file
├── reviews/         # per-(file, reviewer) review JSON
├── coverage/        # per-(file, reviewer) coverage JSON
├── tasks/           # per-task status (the tracker)
└── final/
    ├── pr-review-1234.md
    └── pr-architecture-1234.md
```

## Resuming after failure

```bash
prism review 1234              # default: skip stages with existing output
prism review 1234 --force      # re-run everything
prism review 1234 --force-stage review   # re-run one stage
```

`--force-stage` accepts `fetch`, `enumerate`, `classify`, `review`, `coverage`, `aggregate`, or `architecture`. The `coverage` stage is pure logic and is recomputed during the normal pipeline run.

### Static Analysis

`prism analyze` is the deterministic static-analysis command for a bounded React/Next.js slice. Use it when you want a repeatable read on one entrypoint: what it pulls in, how components/hooks/stores/services connect, where route and context boundaries sit, and where the slice has gaps.

```bash
prism analyze --config prism.analyze.json
```

Use `--config` for the canonical scripted run. The config can set `entry`, `depth`, `include`, and `exclude`; explicit CLI flags still win.

Example `prism.analyze.json`:

```json
{
  "entry": "src/app/page.tsx",
  "depth": 3,
  "include": ["src/app/**", "src/components/**"],
  "exclude": ["generated/**"]
}
```

Start reading the generated output from `final/index.md`. It gives you the reading order, links the `Interpretation Guide`, and points to the layered pages before the raw artifacts. The full traceable report is `final/analysis.md`.

The analyzer follows TS/JS imports and re-exports from the entry file up to `--depth` and extracts:

- files
- imports and exports
- components
- hooks
- Zustand-style stores
- services
- functions, constants, classes, methods, and types
- graph edges such as `renders`, `wraps`, `uses_hook`, `calls`, `uses_store`, `reads_store`, `writes_store`, `store_has_action`, `invokes_store_action`, `selects_by`, `routes_to`, and `fallback_routes_to`
- deterministic Mermaid diagrams generated from `graph.json`
- deterministic insights such as layer leaks, cycles, hubs, and empty diagrams
- a guided Markdown report at `final/index.md`
- a full deterministic detail report at `final/analysis.md`

What it cannot prove: runtime behavior, correctness, performance, security, or complete repo understanding. The report is grounded in extracted facts, and missing edges are not proof that a relationship does not exist.

Import resolution supports TS/JS extensions, common compound sidecars such as `.types.ts`, `.styles.ts`, `.helpers.ts`, and `.constants.ts`, plus simple `baseUrl`/`paths` mappings from `tsconfig.json` or `jsconfig.json`.

Use `--include` and `--exclude` to keep large repos focused. Patterns are comma-separated and support `*` and `**`. If no include is provided, every resolved project file is eligible. The entry file is always included.

Output lands in `./.tmp/analyze/<entry-depth-run-id>/`:

```text
.tmp/analyze/<entry-depth-run-id>/
├── raw/
│   └── entry.json
├── scope/
│   └── scope.json
├── symbols/
│   ├── ast-manifest.json
│   └── symbols.json
├── graph/
│   ├── references.json
│   └── graph.json
├── diagrams/
│   ├── manifest.json
│   ├── component-tree.md
│   ├── provider-stack.md
│   ├── hook-flow.md
│   ├── state-store-map.md
│   ├── store-surface.md
│   ├── service-flow.md
│   ├── context-boundaries.md
│   ├── route-map.md
│   └── import-map.md
├── insights/
│   └── insights.json
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
    │   └── 10-interpretation-guide.md
    └── analysis.md
```

## Configuration

| Env var               | Default | Effect                                     |
| --------------------- | ------- | ------------------------------------------ |
| `PRISM_CONCURRENCY`   | `4`     | Max parallel reviewer calls                |
| `PRISM_MAX_RETRIES`   | `3`     | Claude call retries on validation failure  |
| `PRISM_MAX_ITER`      | `2`     | Coverage retry-loop iterations             |
| `PRISM_CLAUDE_BIN`    | `claude`| Path to claude CLI                         |
| `PRISM_GH_BIN`        | `gh`    | Path to gh CLI                             |
| `PRISM_WORKDIR`       | `.tmp`  | Output root, relative to cwd               |
| `PRISM_VERBOSE`       | `0`     | `1` for detailed logs                      |

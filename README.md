# prism

A deterministic LLM-orchestrated PR review harness.

`prism` runs a fixed pipeline of stages over a GitHub pull request, calls Claude for each judgment-requiring step, and guarantees that every reviewable unit (function, component, hook, class, method) is analyzed by every reviewer it's routed to. Coverage is enforced — not scored.

## Why

LLM PR reviews are usually one shot, vague, and miss things. `prism` makes them:

- **Reproducible** — same inputs → same path through the pipeline.
- **Resumable** — every stage writes to disk; re-run continues from where it stopped.
- **Bounded** — concurrency caps, retry caps, iteration caps.
- **Verifiable** — coverage is computed from AST ground truth, not LLM self-report.

## Architecture

```
fetch  →  enumerate  →  classify  →  review  →  coverage  →  aggregate  →  post
 (gh)      (ts-morph)    (claude)    (claude×N)  (pure logic)  (claude)     (gh)
```

Each stage:

- Reads its inputs from disk.
- Writes its outputs to disk.
- Skips if its output already exists (`--force` to override).

The reviewer fan-out runs in parallel (`PRISM_CONCURRENCY=4` by default).

### Enumeration (ts-morph)

The enumerate stage walks each TS/JS file's AST and extracts reviewable units:

| Kind        | Detection rule                              |
| ----------- | ------------------------------------------- |
| `function`  | Function declarations, arrow/function exprs |
| `component` | PascalCase function returning JSX           |
| `hook`      | Function named `use*` (e.g. `useAuth`)      |
| `class`     | Class declarations                          |
| `method`    | Class methods, named `ClassName.methodName` |

Non-TS/JS files (markdown, JSON, etc.) are routed at file granularity.

### Reviewer input

Each reviewer receives:

- **UNITS TO ANALYZE** — unit metadata (kind, name, line, span)
- **DIFF** — per-file unified diff showing what changed
- **SOURCE** — full current source code for context

### Coverage retry loop

After the first review pass, coverage is computed by comparing `units_analyzed` against the ground-truth unit list. If any units are missing, the reviewer is re-invoked with feedback listing the missed units. Results are merged and coverage is recomputed. This repeats up to `PRISM_MAX_ITER` times.

## Setup

```bash
bun install
bun link          # registers `prism` as a global command
```

## Usage

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
    └── pr-review-1234.md
```

## Resuming after failure

```bash
prism review 1234              # default: skip stages with existing output
prism review 1234 --force      # re-run everything
prism review 1234 --force-stage review   # re-run one stage
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

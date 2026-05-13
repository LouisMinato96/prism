# Static Analysis Roadmap

V0 is effectively complete after docs polish. The shipped analyzer is bounded, deterministic, resumable, disk-backed, and useful on a single React/Next.js slice.

Current smoke run: 439 files, 1360 symbols, 3194 edges, 9 diagrams, 94 insights.

## Current Shape

```mermaid
flowchart LR
  Start["Entry component"] --> Scope["bounded scope"]
  Scope --> Graph["typed graph"]
  Graph --> Pages["layered report"]
  Pages --> Human["readable analysis"]
```

## V0 Status

| Area | Status |
| --- | --- |
| Engine | Complete |
| Report UX | Complete enough for handoff |
| Reliability/docs | Complete after this pass |

V0 means: analyze one repo slice from one entry point and read the output without needing internal context.

V0 now includes:

- bounded scope
- symbols
- graph
- diagrams
- deterministic insights
- layered report pages
- route, context, hook, store, store-surface, and service pages
- extraction gaps
- source refs on guided pages 03-08
- interpretation guide
- config presets
- AST fixture hardening

## V1 Plan

V1 is the next real expansion. Estimate: medium.

```mermaid
flowchart LR
  V0["single slice"] --> V1["repeatable analysis workflow"]
  V1 --> Profiles["analysis profiles"]
  V1 --> Nav["better navigation"]
  V1 --> Compare["compare runs"]
  V1 --> Repo["repo graph"]
  V1 --> Rules["rule and lens config"]
```

V1 should include:

- multi-entry runs
- repo-wide graphing
- analysis profiles
- rule and lens configuration
- Markdown or HTML navigation that is better than the current layered pages
- compare runs and architecture drift
- cleaner diagrams
- richer action and data-flow extraction
- broader language support
- CI-oriented workflows

## Later

Anything beyond V1 is still speculative. If Prism needs a repo architecture map, that should be treated as follow-on scope after V1 lands.

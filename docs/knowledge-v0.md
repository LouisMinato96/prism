# Prism Knowledge V0

V0 adds a deterministic, disk-backed knowledge packaging command:

```bash
prism knowledge build
```

It turns existing `prism analyze` outputs into compact reusable artifacts for future repository development and grounded Q&A.

## Goals

- load existing `prism analyze` artifacts from disk
- build compact deterministic outputs
- validate artifact files and practical docs links
- keep reruns resumable: unchanged output files are not rewritten unless forced

## Non-Goals

- no chatbot behavior
- no Postgres requirement
- no Obsidian dependency
- no LLM-inferred architecture facts
- no graph merging by guesswork
- no changes to PR review behavior

## Inputs

Default roots:

- analyze artifacts: `.tmp/analyze`
- docs links: `docs/prism`
- output root: `.prism/knowledge`

Command with explicit roots:

```bash
prism knowledge build \
  --analyze-root .tmp/analyze \
  --docs-root docs/prism \
  --out .prism/knowledge \
  --force
```

## Outputs

```text
.prism/knowledge/
├── knowledge-pack.json
├── artifacts-index.json
└── validation-report.md
```

`knowledge-pack.json`:

- compact, versioned knowledge payload for future tooling and sessions
- run summaries, entry summaries, folder/domain stats, symbol type counts, module summaries, insights summaries, docs-link summaries

`artifacts-index.json`:

- multi-run digest
- multi-run artifact pointers (`manifest.json`, `index.md`, `architecture.md`)
- per-entry workdir and artifact pointers (`repo-index.json`, `insights.json`, `final/index.md`, `final/analysis.md`)
- symbol/module directory page pointers
- docs artifact-link resolution results

`validation-report.md`:

- missing expected files
- failed entries from manifests
- partial entry workdirs
- malformed artifacts
- docs missing artifact links
- duplicate or stale-looking run signals

## Determinism Notes

- build uses existing disk artifacts only
- outputs are stable and sorted
- no output rewrite when content is unchanged unless `--force`
- malformed or missing artifacts are recorded in validation output instead of being silently ignored

# Prism Knowledge V0

V0 adds a deterministic, disk-backed knowledge packaging command:

```bash
prism knowledge build
```

It also supports deterministic file-backed question answering from built artifacts:

```bash
prism knowledge answer
```

Incremental refresh is available through:

```bash
prism knowledge update
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
- contradiction signals (when detectable from artifact conflicts)

Update history/state outputs:

```text
.prism/knowledge/
├── state.json
└── history/updates/
    ├── <timestamp>-<from>-<to>.json
    └── <timestamp>-<from>-<to>.md
```

Update schema contract:

- See [`docs/knowledge-update-schema.md`](./knowledge-update-schema.md).

Dry-run planning example (default mode):

```bash
prism knowledge update \
  --repo-root /abs/target-repo \
  --knowledge-root /abs/target-repo/.prism/knowledge \
  --from <commit> \
  --to <commit> \
  --batch-size 20
```

Apply mode example (selective refresh + rebuild):

```bash
prism knowledge update \
  --repo-root /abs/target-repo \
  --knowledge-root /abs/target-repo/.prism/knowledge \
  --from <commit> \
  --to <commit> \
  --batch-size 20 \
  --apply \
  --force
```

## Deterministic Answers

Single question:

```bash
prism knowledge answer \
  --question "How does auth work?" \
  --knowledge-root .prism/knowledge \
  --code-root /absolute/path/to/target-repo \
  --out-dir .prism/knowledge/answers \
  --emit-json
```

Strict mode (writes output files, then fails non-zero when quality gates fail):

```bash
prism knowledge answer \
  --question "How does auth work?" \
  --knowledge-root .prism/knowledge \
  --code-root /absolute/path/to/target-repo \
  --out-dir .prism/knowledge/answers \
  --strict \
  --min-confidence high
```

Batch questions:

```bash
prism knowledge answer \
  --questions-file .prism/knowledge/questions.json \
  --knowledge-root .prism/knowledge \
  --code-root /absolute/path/to/target-repo \
  --out-dir .prism/knowledge/answers
```

Answer files are Markdown and include:

- grounded summary text
- deterministic intent classification (`auth-flow`, `permissions`, `data-flow`, `failure-debug`, `general`)
- deterministic section renderer (`Auth Flow`, `Guards & Permissions`, `Failure Paths`, `Evidence Map`)
- evidence entries with artifact links (`final/index.md`, `final/analysis.md`, `final/pages/08-service-flow.md`)
- code-file paths resolved against code root with `exists`/`missing` status
- graph and diagram evidence signals (`flow_signal`, `diagram_signal`)
- repo-index evidence signals (`repo_signal`) for deterministic intent-aware ranking
- compact deterministic excerpts from final artifact pages
- deduped matched insights with grouped occurrences/evidence counts
- stale/contradiction evidence signals from `artifacts-index.json`
- deterministic limits and gaps notes
- optional JSON sidecar output when `--emit-json` is enabled

Answer JSON contract:

- See [`docs/knowledge-answer-schema.md`](./knowledge-answer-schema.md) for the stable machine-readable answer schema and strict diagnostics fields.

## Strict Mode Operations

Strict mode is deterministic and CI-friendly:

- answer artifacts are written first
- strict checks are evaluated after write
- process exits non-zero when any strict issue exists

Strict categories include:

- `confidence_below_min`
- `missing_code_file`
- `missing_graph`
- `missing_repo_index`
- `missing_final_index`
- `missing_service_flow_page`

CLI stderr markers (parse-friendly):

- `STRICT_SUMMARY question_count=<n> failed_question_count=<n> issue_count=<n> min_confidence=<level>`
- `STRICT_CATEGORY category=<name> count=<n>`
- `STRICT_FAILURE question_digest=<digest> category=<name> detail=<text>`

Batch mode (`--questions-file`) also writes deterministic strict summary and strict issue rows in `answers/index.md`.

## Troubleshooting

If answers are weak or strict fails often:

1. Re-run analyze for missing/partial entries and rebuild knowledge:
   - `prism analyze ... --force`
   - `prism knowledge build --force`
2. Inspect `validation-report.md`:
   - `Missing Expected Files`
   - `Malformed Artifacts`
   - `Duplicate Or Stale-Looking Runs`
   - `Contradiction Signals`
3. Verify `--code-root` points to the same repo analyzed by `--analyze-root`.
4. Use `--emit-json` for deterministic downstream checks.
5. Start with `--min-confidence medium` before tightening to `high` in CI.

Cross-repo usage example (run from Prism repo):

```bash
bun bin/prism knowledge build \
  --analyze-root /abs/target-repo/.tmp/analyze \
  --docs-root /abs/target-repo/docs/prism \
  --out /abs/target-repo/.prism/knowledge \
  --force

bun bin/prism knowledge answer \
  --knowledge-root /abs/target-repo/.prism/knowledge \
  --code-root /abs/target-repo \
  --question "How does the auth system work?" \
  --out-dir /abs/target-repo/.tmp/knowledge-answers \
  --force
```

## Determinism Notes

- build uses existing disk artifacts only
- outputs are stable and sorted
- no output rewrite when content is unchanged unless `--force`
- malformed or missing artifacts are recorded in validation output instead of being silently ignored

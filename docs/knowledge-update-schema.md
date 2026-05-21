# Prism Knowledge Update Schema

This document defines the deterministic machine-readable contracts written by:

```bash
prism knowledge update
```

## Outputs

Update writes:

```text
.prism/knowledge/
├── state.json
└── history/updates/
    ├── <timestamp>-<from>-<to>.json
    └── <timestamp>-<from>-<to>.md
```

## Update Report (`history/updates/*.json`)

Top-level fields:

- `schemaVersion`: schema version integer (`1`)
- `generatedAt`: ISO timestamp
- `mode`: `dry-run` or `apply`
- `repoRoot`: repo root used for git/analyze execution
- `knowledgeRoot`: knowledge root used for outputs
- `from`, `to`: requested commit range boundaries
- `resolvedFrom`, `resolvedTo`: fully resolved commit SHAs
- `batchSize`: deterministic planning batch size
- `dryRun`: boolean convenience flag
- `commitCount`: number of commits in `(from, to]`
- `commits[]`: deterministic commit rows (`sha`, `shortSha`, `authoredAt`, `subject`)
- `changeCount`: total changed-file records
- `changes[]`: changed-file rows with:
  - `commitSha`, `commitShortSha`
  - `status`: `added` | `modified` | `deleted` | `renamed`
  - `path`
  - `previousPath` (rename only)
- `changeSummary`: counts by status
- `impactSummary`:
  - `impactedEntries`
  - `staleEntries`
  - `unmappedChanges`
- `impacts[]`: mapped impacted entries with:
  - `runDigest`, `entryName`, `entryPath`, `workdir`, `status`
  - `stale`
  - `matches[]` with mapping reason + stale signal
- `unmappedChanges[]`: changed-file rows without mapping matches
- `execution` (present in `apply` mode):
  - `targetEntries`, `skippedStaleEntries`
  - `attemptedEntries`, `succeededEntries`, `failedEntries`
  - `rebuiltKnowledge`
  - `failures[]`
- `slices[]`: deterministic planning slices (`fromCommit`, `toCommit`, `commitCount`)
- `notes[]`: deterministic operational notes

## State (`state.json`)

Top-level fields:

- `schemaVersion`: schema version integer (`1`)
- `updatedAt`: latest update timestamp
- `latestReportPath`: relative path to latest report JSON
- `latestMode`: `dry-run` or `apply`
- `latestRange`:
  - `from`, `to`
  - `resolvedFrom`, `resolvedTo`
- `lastAppliedReportPath`: latest apply-mode report path (optional)
- `appliedUpdates[]`: deduped apply history rows:
  - `generatedAt`
  - `from`, `to`
  - `resolvedFrom`, `resolvedTo`
  - `reportPath`

## Determinism Notes

- Change ingestion is git-backed and order-stable.
- Mapping and summaries are sorted deterministically.
- Same inputs produce byte-stable report/state content unless source artifacts/commits changed.
- In dry-run mode, no analyze/build mutation is performed.

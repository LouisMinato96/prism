# Prism Knowledge V3 Prep

This document turns V3 into implementation-ready slices.

## V3 Objective

Add deterministic incremental knowledge updates from git history so knowledge stays fresh without full rebuilds, while preserving:

1. deterministic output
2. disk-backed reproducibility
3. no LLM inference for architecture facts

## Scope Freeze (V3)

### In Scope

1. New command:
   - `prism knowledge update`
2. Deterministic commit-range ingestion:
   - added/modified/deleted/renamed file detection
3. Deterministic impact mapping:
   - changed files -> impacted analyze entries/workdirs
4. Selective refresh pipeline:
   - rerun only impacted entry analyses
   - rebuild knowledge artifacts from refreshed analyze outputs
5. Update state and history artifacts:
   - track applied commit ranges
   - persist update reports

### Out of Scope

1. Daemon/background auto-sync
2. Probabilistic or LLM-based impact mapping
3. PR review pipeline changes
4. External DB dependency

## Proposed Implementation Slices

### Slice 1: Command Scaffold + Dry-Run Report

Files:

1. `src/cli.ts`
2. `src/lib/knowledge-options.ts`
3. `src/stages/knowledge/update.ts` (new)
4. `tests/knowledge.test.ts`

Work:

1. Add `knowledge update` command + option parsing.
2. Support required params:
   - `--repo-root`
   - `--knowledge-root`
   - `--from`
   - `--to`
3. Add optional controls:
   - `--batch-size`
   - `--dry-run`
4. Write deterministic dry-run report artifacts.

Done when:

1. Command executes and writes deterministic update report files.
2. No analyze/build mutation occurs in dry-run mode.

### Slice 2: Git Change Ingestion

Files:

1. `src/stages/knowledge/update.ts`
2. `tests/knowledge.test.ts`

Work:

1. Read commit-range file changes from git in deterministic order.
2. Classify changes:
   - `added`
   - `modified`
   - `deleted`
   - `renamed`
3. Normalize paths relative to `repo-root`.

Done when:

1. Same commit range returns byte-identical change sets.
2. Renames and deletions are represented explicitly.

### Slice 3: Impact Mapping From Knowledge Artifacts

Files:

1. `src/stages/knowledge/update.ts`
2. `src/schemas/knowledge.ts` (only if update report schema fields are expanded)
3. `tests/knowledge.test.ts`

Work:

1. Load `artifacts-index.json` and map changed paths to impacted entries/workdirs.
2. Add deterministic mapping reasons (for traceability).
3. Distinguish:
   - directly impacted entries
   - potentially stale entries from deleted/renamed paths

Done when:

1. Impacted entries are deterministic and explainable.
2. Missing mapping context is reported, not silently ignored.

### Slice 4: Selective Refresh Execution

Files:

1. `src/stages/knowledge/update.ts`
2. `src/stages/analyze/run.ts` (or analyze orchestration call site used by update)
3. `src/stages/knowledge/build.ts`
4. `tests/knowledge.test.ts`

Work:

1. Re-run analyze only for impacted entries/workdirs.
2. Rebuild knowledge artifacts after selective analyze completion.
3. Preserve force/skip semantics and deterministic ordering.
4. Keep partial success behavior explicit in report.

Done when:

1. Only impacted entries are refreshed.
2. Unchanged entries are not reprocessed.
3. Final knowledge outputs remain schema-valid and deterministic.

### Slice 5: State Tracking + Ops Docs

Files:

1. `src/stages/knowledge/update.ts`
2. `README.md`
3. `docs/knowledge-v0.md`
4. `docs/knowledge-update-schema.md` (new)
5. `tests/knowledge.test.ts`

Work:

1. Persist update history:
   - `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.json`
   - `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.md`
2. Persist state:
   - `.prism/knowledge/state.json`
3. Document command usage, failure handling, and rollback guidance.
4. Publish deterministic update-report schema contract.

Done when:

1. Operators can audit what changed and why from disk artifacts alone.
2. Update schema contract is documented and stable.

## Proposed CLI (Target)

```bash
prism knowledge update \
  --repo-root /path/to/repo \
  --knowledge-root .prism/knowledge \
  --from <commit> \
  --to <commit> \
  --batch-size 20 \
  --dry-run
```

## Proposed Artifacts

1. `.prism/knowledge/state.json`
2. `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.json`
3. `.prism/knowledge/history/updates/<timestamp>-<from>-<to>.md`

## V3 Test Matrix

### Unit/Integration

1. CLI option parsing for `knowledge update`.
2. Deterministic change ingestion for a synthetic commit range.
3. Rename/delete/add mapping tests.
4. Impact mapping determinism tests.
5. Dry-run mode writes report without mutating analyze/knowledge artifacts.
6. Selective refresh executes impacted entries only.
7. Idempotency: same range twice yields same report content.

### Smoke

1. Run update across a small real commit range in Arcana.
2. Validate impacted entry set and rebuilt knowledge outputs.
3. Validate update history/state artifacts.

## Acceptance Criteria (V3 Exit)

1. `bun run format:check`, `bun run typecheck`, `bun test`, and `git diff --check` pass.
2. Same commit range produces deterministic update outputs.
3. Only impacted entries are re-analyzed.
4. Deletions/renames are surfaced in update reports and stale signals.
5. Update history/state artifacts are complete and operator-friendly.

## Execution Order

1. Slice 1 (command scaffold + dry-run report)
2. Slice 2 (git change ingestion)
3. Slice 3 (impact mapping)
4. Slice 4 (selective refresh execution)
5. Slice 5 (state/docs/schema)

This order de-risks the rollout by proving determinism and reporting first, then enabling mutation.

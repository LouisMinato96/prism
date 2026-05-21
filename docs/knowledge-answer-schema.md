# Prism Knowledge Answer Schema

This document defines the deterministic machine-readable contract for:

1. per-question answer JSON sidecars (`--emit-json`)
2. strict-mode diagnostics for CI

## Per-Question JSON Sidecar

When `--emit-json` is enabled, each answer markdown file has a sibling `.json` file.

Example path:

```text
.prism/knowledge/answers/how-does-auth-work.json
```

### Top-level Shape (`schemaVersion: 1`)

```json
{
  "schemaVersion": 1,
  "question": "How does auth work?",
  "questionDigest": "47cbb495d70a",
  "intent": "auth-flow",
  "intentKeywords": ["auth"],
  "generatedAt": "2026-05-21T05:09:35.363Z",
  "knowledgeRoot": "/abs/repo/.prism/knowledge",
  "codeRoot": "/abs/repo",
  "topLimit": 8,
  "confidence": { "score": 100, "level": "high" },
  "summary": "Primary evidence points to ...",
  "entries": [],
  "insights": [],
  "warnings": [],
  "integritySignals": {
    "staleRunSignals": [],
    "contradictionSignals": [],
    "relevantSignals": []
  },
  "limits": []
}
```

### Field Notes

- `schemaVersion`: literal `1`
- `questionDigest`: deterministic SHA-1 prefix (12 chars)
- `intent`: one of:
  - `auth-flow`
  - `permissions`
  - `data-flow`
  - `failure-debug`
  - `general`
- `confidence.level`: `low | medium | high`
- `entries[]`: ranked evidence entries
- `insights[]`: ranked and deduped insight evidence
- `warnings[]`: missing-artifact warnings for ranked entries
- `integritySignals`:
  - `staleRunSignals`: stale/duplicate/orphan run signals from knowledge build
  - `contradictionSignals`: deterministic artifact-conflict signals from knowledge build
  - `relevantSignals`: query-relevant subset used in answer rendering

### `entries[]` Shape

Each entry contains deterministic evidence pointers and signals:

- `score`, `run`, `name`, `path`, `status`
- `startHere`, `detail`, `serviceFlow`
- `codeFile`, `codeExists`
- `flowSignal`:
  - `exists`, `edgeCount`, `calls`, `serviceCalls`, `routes`, `contextEdges`, `storeEdges`
- `repoSignal`:
  - `files`, `symbols`, `serviceSymbols`, `contextSymbols`, `storeSymbols`, `hookSymbols`, `componentSymbols`
  - `authHints`, `permissionHints`, `dataHints`, `debugHints`
- `diagramSignal`, `finalExcerpt`, `serviceFlowExcerpt`
- `matchedTokens[]`

### `insights[]` Shape

- `score`
- `severity` (`high | medium | low | info`)
- `entry`, `title`, `lens`
- `occurrences`, `evidenceCount`
- `ids[]`
- `matchedTokens[]`

## Strict-Mode Diagnostics Contract

Strict mode is evaluated after writing answer artifacts.

### Exit Behavior

- strict pass: exit code `0`
- strict fail: exit code `1`

### Parse-Friendly stderr Markers

When strict fails, CLI emits:

1. `STRICT_SUMMARY question_count=<n> failed_question_count=<n> issue_count=<n> min_confidence=<level>`
2. `STRICT_CATEGORY category=<name> count=<n>` (one per category)
3. `STRICT_FAILURE question_digest=<digest> category=<name> detail=<text>` (one per issue)

### Strict Categories

- `confidence_below_min`
- `missing_code_file`
- `missing_graph`
- `missing_repo_index`
- `missing_final_index`
- `missing_service_flow_page`

## Batch `answers/index.md` Contract (Strict)

For `--questions-file` runs with `--strict`, `answers/index.md` includes:

1. strict summary counts
2. category table (`category`, `count`)
3. per-question strict issue rows with `code=<category>`

These sections are deterministic and stable for unchanged inputs.

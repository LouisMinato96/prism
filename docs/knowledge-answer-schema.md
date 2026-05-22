# Prism Knowledge Answer Schema

This document defines the deterministic machine-readable contract for:

1. per-question answer JSON sidecars (`--emit-json`)
2. per-question classification sidecars (always emitted)
3. strict-mode diagnostics for CI

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
  "questionClass": "architecture_storyline",
  "questionClassConfidence": "high",
  "questionClassScore": 56,
  "questionClassDelta": 14,
  "questionClassRules": ["verb_how", "phrase_architecture", "domain_token:all"],
  "topicCandidates": [],
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
  "evidencePack": {
    "status": "partial",
    "requirements": [],
    "satisfied": [],
    "missing": [],
    "sources": [],
    "codeRootFallback": {
      "used": true,
      "maxFiles": 25,
      "maxBytesPerFile": 256000,
      "scannedFiles": 3,
      "matchedFiles": 1,
      "matchedPaths": []
    }
  },
  "failOpen": {
    "triggered": false,
    "reasons": [],
    "candidateTopics": [],
    "candidateEntries": [],
    "missingRequirements": []
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
- `questionClass`: one of:
  - `architecture_storyline`
  - `entrypoint_trace`
  - `dependency_flow`
  - `building_blocks`
  - `reference_lookup`
  - `change_guidance`
  - `unknown_or_ambiguous`
- `questionClassConfidence`: `high | medium | low | none`
- `confidence.level`: `low | medium | high`
- `entries[]`: ranked evidence entries
- `insights[]`: ranked and deduped insight evidence
- `warnings[]`: missing-artifact warnings for ranked entries
- `evidencePack`: deterministic analyze-first evidence requirements/satisfaction with bounded code-root fallback stats
- `failOpen`: deterministic fail-open decision payload for ambiguous/low-evidence questions
- `integritySignals`:
  - `staleRunSignals`: stale/duplicate/orphan run signals from knowledge build
  - `contradictionSignals`: deterministic artifact-conflict signals from knowledge build
  - `relevantSignals`: query-relevant subset used in answer rendering

## Per-Question Classification Sidecar

Each answer markdown file also has a deterministic classification sidecar:

```text
.prism/knowledge/answers/how-does-auth-work.classification.json
```

Shape (`schemaVersion: 1`):

```json
{
  "schemaVersion": 1,
  "generatedAt": "2026-05-21T05:09:35.363Z",
  "question": "How does auth work?",
  "questionDigest": "47cbb495d70a",
  "normalizedQuestion": "how does auth work",
  "class": "architecture_storyline",
  "confidence": "high",
  "score": 56,
  "delta": 14,
  "matchedRules": ["verb_how", "phrase_architecture", "domain_token:all"],
  "classScores": [],
  "topicCandidates": []
}
```

Each answer markdown file also has an evidence-pack sidecar:

```text
.prism/knowledge/answers/how-does-auth-work.evidence-pack.json
```

Shape:

```json
{
  "status": "complete",
  "requirements": ["entrypoints", "references"],
  "satisfied": ["entrypoints", "references"],
  "missing": [],
  "sources": [],
  "codeRootFallback": {
    "used": false,
    "maxFiles": 25,
    "maxBytesPerFile": 256000,
    "scannedFiles": 0,
    "matchedFiles": 0,
    "matchedPaths": []
  }
}
```

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
- `question_class_ambiguous`
- `evidence_pack_incomplete`
- `fail_open_required`
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

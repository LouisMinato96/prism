# Prism Knowledge V2.2 Prep (Evidence Pack Orchestration)

This file tracks V2.2 implementation and validation.

## V2.2 Goal

Add deterministic evidence-pack orchestration to `prism knowledge answer`:

1. derive required evidence from question class
2. satisfy from analyze artifacts first
3. use bounded `--code-root` fallback only for unresolved evidence
4. write machine-readable evidence-pack artifacts

## Scope Freeze (V2.2)

### In Scope

1. Class-to-requirements mapping.
2. Analyze-first coverage checks.
3. Bounded code fallback:
   - max files
   - max bytes/file
   - deterministic candidate set
4. Evidence-pack output:
   - embedded in answer JSON
   - always-on `*.evidence-pack.json`
5. Tests for fallback usage and deterministic outputs.

### Out of Scope

1. Human-first answer narrative redesign (V2.3).
2. New probabilistic retrieval methods.
3. Unbounded repository scans.

## Evidence Requirements

Supported requirement labels:

1. `entrypoints`
2. `building_blocks`
3. `dependency_edges`
4. `references`

## Class Mapping (Contract)

1. `architecture_storyline` -> `entrypoints`, `building_blocks`, `dependency_edges`, `references`
2. `entrypoint_trace` -> `entrypoints`, `dependency_edges`, `references`
3. `dependency_flow` -> `dependency_edges`, `references`
4. `building_blocks` -> `building_blocks`, `references`
5. `reference_lookup` -> `references`
6. `change_guidance` -> `entrypoints`, `building_blocks`, `references`
7. `unknown_or_ambiguous` -> `references`

## Fallback Bounds (Contract)

1. max files scanned: `25`
2. max bytes per file: `250 * 1024`
3. deterministic candidates from:
   - path-like question anchors
   - top ranked entry code paths

## Output Contract

Per answer:

1. `<slug>.md`
2. `<slug>.classification.json`
3. `<slug>.evidence-pack.json`
4. optional `<slug>.json` when `--emit-json`

Evidence-pack shape includes:

1. `status` (`complete` | `partial`)
2. `requirements`
3. `satisfied`
4. `missing`
5. `sources`
6. `codeRootFallback` stats

## Done Checklist

- [x] class-to-requirement mapping implemented
- [x] analyze-first evidence coverage implemented
- [x] bounded code fallback implemented
- [x] `*.evidence-pack.json` emitted
- [x] answer JSON includes `evidencePack`
- [x] tests added for evidence-pack and fallback behavior
- [x] docs updated (`README`, `knowledge-v0`, answer schema)
- [x] `format:check`, `typecheck`, tests passing

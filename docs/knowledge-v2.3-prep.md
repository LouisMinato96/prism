# Prism Knowledge V2.3 Prep (Human-First Answer Renderer)

This file tracks V2.3 implementation planning and execution.

## V2.3 Goal

Make `prism knowledge answer` outputs easier for engineers to read and act on while staying deterministic and evidence-grounded.

## Scope Freeze (V2.3)

### In Scope

1. Introduce class-aware answer templates:
   - `architecture_storyline`
   - `entrypoint_trace`
   - `dependency_flow`
   - `building_blocks`
   - `reference_lookup`
   - `change_guidance`
2. Render concise “human-first” sections before raw evidence.
3. Keep a deterministic evidence appendix with full links/signals.
4. Preserve existing machine-readable sidecars (`.json`, `.classification.json`, `.evidence-pack.json`).
5. Add tests for section structure and deterministic formatting per class.

### Out of Scope

1. New retrieval/ranking algorithms (already covered in V2.1/V2.2).
2. Any LLM-generated architecture inference.
3. Interactive chat/session memory behavior.

## Target Markdown Structure

For narrative classes (especially `architecture_storyline`):

1. `Executive Answer` (short)
2. `How To Read This System` (ordered storyline)
3. `Entry Files`
4. `Core Building Blocks`
5. `Dependency / Control Flow`
6. `Failure Paths` (if available)
7. `Gaps / Uncertainty`
8. `Proof References` (artifact + code links)
9. `Raw Evidence Appendix`

For lookup-style classes, keep shorter variants with class-specific ordering.

## Determinism Contract

1. Fixed section ordering per class.
2. Stable list ordering by score/path/run digest.
3. Stable truncation limits for excerpts and tables.
4. No free-form model prose beyond deterministic templates populated from artifacts.

## Rendering Limits (Initial)

1. max narrative bullets per section: `8`
2. max related entries in narrative body: `5`
3. max raw evidence rows before truncation note: `8`
4. all truncation must include deterministic “showing N of M” note

## Test Plan

1. Golden snapshot tests per question class.
2. Determinism test: repeated runs produce byte-identical markdown.
3. Regression tests ensuring evidence links remain present.
4. Batch index test confirming class + confidence remains visible.

## Done Checklist

- [x] class-aware markdown templates implemented
- [x] executive answer + storyline sections added
- [x] deterministic proof reference section added
- [x] raw appendix retained for auditability
- [x] tests added for each class template
- [x] docs updated with new answer structure examples
- [x] `format:check`, `typecheck`, tests passing

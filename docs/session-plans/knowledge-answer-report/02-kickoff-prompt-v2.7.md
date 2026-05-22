# Kickoff Prompt (Start at v2.8 — v2.7 Complete)

> **v2.7 discovery + contract freeze is complete.** Findings recorded in `01-new-session-versioned-plan.md` §J. Existing commands unchanged; baseline gates green (format/typecheck/71 tests/diff). Use this prompt to start a fresh session at v2.8.

```text
We are in /Users/shubhammandal/Documents/SM/projects/prism.

Goal: implement deterministic, teachable `prism knowledge answer-report` as a multi-file report folder generated from existing knowledge artifacts AND from an expanded analyze insight catalog. The report must educate the reader (SOLID-leaning, design patterns, React/TS standards, security, performance, smells, complexity) — not just navigate. All deterministic. No LLM at report-generation time.

Read first:
- docs/session-plans/knowledge-answer-report/01-new-session-versioned-plan.md  (full plan, v2.7 findings in §J, lens catalog in §G)
- docs/session-plans/knowledge-answer-report/03-session-2-prompt-v2.10-start.md (when v2.8 + v2.9 done)

Constraints:
- Preserve backward compatibility for review/analyze/knowledge build/answer/update.
- No broad rewrites.
- Deterministic, disk-backed, resumable behavior.
- Reuse helpers from build.ts (writeJsonIfChanged, writeTextIfChanged, resolveGeneratedAt) and answer.ts (escapeTableCell, slugifyQuestion, toDisplayPath, readArtifactTextIfExists, loadDiagramManifest).

Versioned roadmap (v2.7 done):
- v2.8: CLI/options scaffold for `prism knowledge answer-report` + placeholder output
- v2.9: deterministic aggregator consuming existing per-question sidecars
- v2.10: 8 new deterministic analyze lenses (hook-deps-mismatch, complexity-hotspot, type-safety-escape, bloater, dead-code, await-in-loop, security-quick-win, todo-density)
- v2.11: answer-report teaching pages consuming v2.10 insights
- v2.12: hardening + docs gate

This session: execute v2.8.

v2.8 scope:
- Add `prism knowledge answer-report` subcommand to src/cli.ts (usage text + parseArgs entries + dispatch)
- Add resolveKnowledgeAnswerReportOptions to src/lib/knowledge-options.ts
  - flags: --knowledge-root, --answers-dir, --report-out, --strict, --min-confidence (validation mirroring answer)
- Create src/stages/knowledge/report.ts skeleton:
  - Read knowledge-pack.json + artifacts-index.json
  - Scan answers-dir for *.json + *.classification.json + *.evidence-pack.json
  - Compute digest = SHA-1(12) of sorted [input mtime+path]
  - Emit manifest.json + index.md placeholder only
  - Use writeTextIfChanged pattern
- Tests in tests/knowledge.test.ts:
  - Command runs end-to-end without error
  - Second run is byte-identical (determinism)
  - Existing knowledge build/answer/update tests unchanged
- Quality gates: bun run format:check / typecheck / bun test / git diff --check

Use subagents with strict scopes:
- cli-options-implementer (cli/options only)
- report-implementer (new src/stages/knowledge/report.ts only)
- test agent (tests/knowledge.test.ts only)

Never run overlapping write scopes. Checkpoint after each slice with: changes made, tests run, risks.

Acceptance for v2.8:
- bun bin/prism knowledge answer-report --help shows new command
- bun bin/prism knowledge answer-report --knowledge-root ... --answers-dir ... --report-out ... emits manifest.json + index.md
- Second invocation byte-identical (verify with diff -ru)
- All existing tests pass

After v2.8 ships, hand off to v2.9 (deterministic aggregator) or use 03-session-2 prompt for v2.10 (lens work) once v2.9 done.
```

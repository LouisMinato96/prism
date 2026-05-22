# Session-2 Prompt (Start at v2.8)

Use this after v2.7 discovery/contract freeze is complete.

```text
Continue from v2.8 in /Users/shubhammandal/Documents/SM/projects/prism.

Context:
- v2.7 is complete: current behavior audited, contracts frozen.
- Do not re-open architecture unless a hard blocker appears.

Now execute:
- v2.8: CLI/options scaffold for `prism knowledge answer-report`
- v2.9: deterministic multi-file report folder generation
- v2.10: usefulness pages for teammate workflows
- v2.11: hardening + docs gate

Rules:
- No LLM-generated facts in report generation code.
- Preserve compatibility for existing commands.
- Keep changes narrow and modular.
- Do not overlap write scopes across subagents.

Suggested ownership split:
- Agent A: CLI + options + command wiring (`src/cli.ts`, `src/lib/knowledge-options.ts`)
- Agent B: report stage implementation (`src/stages/knowledge/report.ts` + helpers)
- Base session: integration + tests + docs

Expected command shape:
bun bin/prism knowledge answer-report \
  --knowledge-root .prism/knowledge \
  --answers-dir .prism/knowledge/answers \
  --report-out .prism/knowledge/answer-reports/<digest> \
  --strict

Expected report folder (minimum):
- manifest.json
- index.md
- validation-report.md
- pages/
- questions/
- data/
- diagrams/

Execution checklist:
1) Implement v2.8 scaffold and help text
2) Add deterministic placeholder outputs and schema validation
3) Implement v2.9 renderer from existing answer JSON/artifacts only
4) Add idempotency tests (same input -> same bytes)
5) Add strict-mode propagation tests (write then non-zero)
6) Add usefulness pages (evidence map, follow-up, strict/issues)
7) Update README + schema docs
8) Run full gates

Quality gates:
- bun run format:check
- bun run typecheck
- bun test
- git diff --check

Determinism verification:
- generate report twice to two output roots
- diff outputs recursively
- fail if any non-metadata content differs

Final report back format:
- What changed
- Files changed
- Commands run
- Test results
- Determinism check result
- Remaining risks/follow-ups
```


# Prism Knowledge Answer-Report Session Pack

Planning + kickoff files for **deterministic, teachable** `prism knowledge answer-report`.

The new command does NOT just navigate existing artifacts. It **teaches** the reader by surfacing opinionated, codebase-grounded insights (SOLID-leaning, design patterns, React/TS standards, security, performance, smells, complexity) — all deterministic, no LLM at report-generation time.

## Status

- **v2.7 discovery + contract freeze:** done
- **v2.8 CLI scaffold:** done
- **v2.9 deterministic aggregator:** done
- **v2.10 analyze lens expansion (8 new lenses):** done
- **v2.11 answer-report teaching pages:** done
- **v2.12 hardening + docs gate:** done

## Files

1. [`01-new-session-versioned-plan.md`](./01-new-session-versioned-plan.md) — full plan, vision, lens catalog, v2.7 findings, references
2. [`02-kickoff-prompt-v2.7.md`](./02-kickoff-prompt-v2.7.md) — fresh-session kickoff for v2.8 (v2.7 already complete)
3. [`03-session-2-prompt-v2.10-start.md`](./03-session-2-prompt-v2.10-start.md) — fresh-session kickoff for v2.10 (lens expansion)

## Recommended Base Model

- Primary: `opus`
- Fallback: `sonnet`

Set model in Claude Code:

```bash
/model opus
```

## Quick Start (Next Session)

```bash
cd /Users/shubhammandal/Documents/SM/projects/prism
/model opus
# Paste the kickoff prompt from 02-kickoff-prompt-v2.7.md
```

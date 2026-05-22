# Prism Knowledge V2.4 Prep (Strict + Fail-Open Hardening)

This file tracks V2.4 strict-confidence and fail-open hardening.

## V2.4 Goal

Strengthen strict mode to enforce question-class and evidence-pack quality gates, and provide deterministic fail-open guidance when confidence is weak.

## Scope

1. Strict categories for:
   - ambiguous question class
   - incomplete evidence-pack requirements
   - fail-open-triggered answers
2. Fail-open guidance section in markdown output.
3. Fail-open block in answer JSON sidecar.
4. Tests for ambiguous prompts and strict category emission.

## Done Checklist

- [x] strict categories added for class/evidence/fail-open
- [x] strict issue evaluation updated
- [x] fail-open guidance markdown section added
- [x] fail-open JSON payload added
- [x] tests added and passing
- [x] docs/schema updated

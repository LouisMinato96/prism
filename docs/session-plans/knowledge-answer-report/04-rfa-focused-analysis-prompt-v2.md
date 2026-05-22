# RFAPorfolioTable Focused Analysis Prompt (Claude Code)

```text
Use Prism outputs and repository code to produce a grounded, high-signal multi-file architecture analysis of RFAPorfolioTable.

Important: Do not edit production/source code. Only create or update documentation files under docs/prism/rfa-portfolio-table-analysis/.

Primary target:
src/core/types/RiskFactorAnalysis/RFAPorfolioTable/index.ts

Required evidence sources:
.tmp/rfa-portfolio-table-answers/index.md
.tmp/rfa-portfolio-table-answers/*.md
.tmp/rfa-portfolio-table-answers/*.json
.prism/knowledge/artifacts-index.json
.prism/knowledge/knowledge-pack.json
src/core/types/RiskFactorAnalysis/RFAPorfolioTable/**
Any imports, exports, call sites, tests, stories, fixtures, or consumers discovered via rg.

Goal:
Produce an evidence-grounded architecture packet that explains how RFAPorfolioTable is built, what it depends on, where it is used, how to change it safely, and what risks remain.

Workflow:
1. Inventory the evidence.
2. Read the primary target first.
3. Read all sibling files under src/core/types/RiskFactorAnalysis/RFAPorfolioTable/.
4. Use rg to trace imports, exports, type references, construction sites, and high-signal consumers.
5. Read Prism answer files and JSON artifacts only after understanding the code.
6. Cross-check Prism claims against source code and call sites.
7. Resolve conflicts using the evidence ranking below.
8. Write the requested output files.
9. Run the acceptance checklist before finishing.

Evidence ranking:
Tier 1: Current source code, direct imports/exports, call sites, tests, and build-visible files.
Tier 2: Prism answer files in .tmp/rfa-portfolio-table-answers/.
Tier 3: Prism knowledge artifacts in .prism/knowledge/.
Tier 4: Inference from naming, structure, or repeated conventions.

Evidence rules:
- Every key claim must cite at least one file path and line number.
- Prefer citations from Tier 1 evidence.
- If using Tier 2 or Tier 3 evidence, label it as Prism-derived.
- If a Prism-derived claim conflicts with source code, mark the conflict and treat source code as authoritative.
- Do not state intent, behavior, ownership, or architectural role unless evidence supports it.
- If line numbers are needed, use nl -ba, rg -n, or equivalent.
- If uncertain, write “Uncertain:” and explain what evidence is missing.
- Do not invent missing files, tests, relationships, or runtime behavior.
- Do not generalize from a single example unless clearly labeled as limited evidence.

Output files to create:
docs/prism/rfa-portfolio-table-analysis/README.md
docs/prism/rfa-portfolio-table-analysis/evidence-ledger.md
docs/prism/rfa-portfolio-table-analysis/dependency-map.md
docs/prism/rfa-portfolio-table-analysis/change-plan.md
docs/prism/rfa-portfolio-table-analysis/open-questions.md

README.md format:
# RFAPorfolioTable Architecture Analysis
## Executive Summary
Write 5 to 8 bullets only. Each bullet must include at least one citation.
## Build/Construction Flow
Explain how the table/types/module are constructed, composed, exported, or initialized. Cite every key claim.
## Design Patterns Used
Name only patterns supported by evidence. For each pattern, include evidence and why it matters.
## Architecture Boundaries and Collaborators
Explain internal boundaries, external collaborators, imports, exports, and ownership boundaries supported by code.
## Where Used
List high-signal call sites and consumers. Prioritize production consumers, tests, integration points, and exported APIs.
## Safe Modification Strategy
Give practical guidance for changing this area safely.
## Risks and Mitigations
List concrete risks, impact, mitigation, and evidence.
## Source Confidence
State overall confidence as High, Medium, or Low and explain why.

evidence-ledger.md format:
# Evidence Ledger
| ID | Claim | Evidence Tier | Source | Lines | Confidence | Notes |
| --- | --- | --- | --- | --- | --- | --- |
Each row must contain one atomic claim.
Use confidence values only: High, Medium, Low.
Use Evidence Tier values only: Tier 1, Tier 2, Tier 3, Tier 4.
Include at least 20 rows unless fewer than 20 evidence-backed claims exist.

dependency-map.md format:
# Dependency Map
## Import/Export Summary
| File | Imports From | Exports | Notes |
| --- | --- | --- | --- |
## Internal Collaborators
| Component/File | Relationship To RFAPorfolioTable | Evidence |
| --- | --- | --- |
## External Collaborators
| Component/File | Relationship To RFAPorfolioTable | Evidence |
| --- | --- | --- |
## Usage Graph
Use Mermaid if the relationships are clear. If not clear, write “Uncertain: usage graph omitted because relationships are not sufficiently evidenced.”
## Boundary Notes
List what appears inside the RFAPorfolioTable boundary and what appears outside it, with citations.

change-plan.md format:
# Safe Change Plan
## Change Surface
List files likely to require edits for common changes.
## Before Changing
List checks a teammate should run or inspect first.
## Low-Risk Changes
List examples of likely safer changes and why.
## Higher-Risk Changes
List examples of risky changes and why.
## Suggested Validation
List relevant tests, type checks, snapshot checks, Prism checks, or manual inspections. If no tests are found, state that with evidence.
## Rollback Strategy
Explain how to keep changes reversible.

open-questions.md format:
# Open Questions
| Question | Why It Matters | Evidence Gap | Suggested Next Step |
| --- | --- | --- | --- |
Only include questions that remain after code and Prism evidence are reviewed.
Do not include questions answerable from the inspected files.

Deterministic formatting constraints:
- Use exact headings shown above.
- Use Markdown tables exactly where requested.
- Use relative repository paths in citations.
- Citation format must be path:line or path:line-line.
- Do not use vague citations like “see file” or “various files.”
- Do not include uncited architecture claims.
- Keep bullets short and specific.
- Do not include marketing language or generic architecture advice.
- Do not include more than one claim per evidence-ledger row.
- If a required source file or glob has no matches, record that in evidence-ledger.md and open-questions.md.

Anti-hallucination checks before writing:
- For each section, ask: “Which exact file and line proves this?”
- For each inferred relationship, ask: “Is this directly referenced in code, or only implied?”
- For each Prism claim, ask: “Does source code confirm, contradict, or not address it?”
- For each call site, ask: “Is this a real usage, a re-export, a test-only usage, or a dead reference?”
- Remove any claim that cannot be cited.

Acceptance checklist:
- All five output files exist under docs/prism/rfa-portfolio-table-analysis/.
- README.md contains all required sections with exact headings.
- evidence-ledger.md contains atomic claims with citations and confidence.
- dependency-map.md separates internal collaborators from external collaborators.
- change-plan.md gives practical safe-modification guidance tied to evidence.
- open-questions.md contains only unresolved evidence gaps.
- Every key claim has path:line or path:line-line citation.
- Any uncertainty is explicitly marked with “Uncertain:”.
- Any conflict between Prism output and source code is called out.
- No production/source code files were edited.
- Final response summarizes created files and notes any acceptance checklist item that could not be satisfied.
```


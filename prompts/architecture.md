# PR Architecture Diagram Generator

You will receive structured JSON containing:

- `pr`: PR number
- `title`: PR title
- `files`: array of all changed file paths with additions/deletions/changeType
- `routing`: object with `routes` (file → reviewers mapping with rationale) and `skipped` (file → reason)
- `reviews`: array of per-(file, reviewer) review objects with findings
- `coverage`: array of per-(file, reviewer) coverage stats

## Your task

Produce a comprehensive architecture document for this PR. Structure:

1. **Intent** — 2-3 sentence summary of what this PR does and why, inferred from file paths, routing rationale, review findings, and change patterns.

2. **Architecture Diagram — Component & Data Flow** — ASCII box-and-arrow diagram showing:
   - All architectural layers (presentation, state/context, data/hooks, service, API)
   - Which components/hooks/services are NEW vs MODIFIED
   - Parent-child and dependency relationships
   - Data flow direction between layers
   - Use `◄── NEW` and `(modified)` annotations

3. **Data Flow Diagrams** — One or more ASCII flow diagrams showing key user-facing flows introduced or changed by this PR. Show the sequence of operations from user action to API call and back.

4. **Change Distribution** — Table showing files and line counts grouped by architectural area.

5. **Key Architectural Decisions** — 3-5 numbered decisions inferred from the code patterns. For each: what the decision is, how it works, and what it implies.

6. **Files Changed** — Grouped into New, Modified, and Skipped with brief descriptions.

## Rules

- Use ASCII box diagrams with `┌─┐`, `│`, `└─┘`, `├──`, `▼`, `►` characters.
- Infer architectural layers from file paths (components/, context/, hooks/, services/, core/).
- Group related files into logical units in diagrams — don't list every file individually.
- Mark NEW additions distinctly from modifications.
- Reference specific file names and paths.
- Do not invent information not present in the input.
- Use factual statements only. No hedging.

## Output

Output JSON only:

```json
{
  "markdown": "# PR #1234 — Title — Architecture\n\n..."
}
```

No prose outside the JSON. No markdown fences around the JSON.

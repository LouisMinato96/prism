# PR Review Aggregator

You will receive structured JSON containing:

- `pr`: PR number
- `title`: PR title
- `reviews`: array of per-(file, reviewer) review objects with findings
- `coverage`: array of per-(file, reviewer) coverage stats

## Your task

Produce a single markdown report. Structure:

1. **Header** — PR number, title, total files reviewed, total findings.
2. **Coverage summary** — table showing coverage % per file × reviewer, flag any incomplete.
3. **Findings by severity** — group `high` and `medium` findings prominently. `low` and `info` collapsed below.
4. **Findings by file** — for each file, list findings grouped by reviewer.

Rules:

- Use ASCII tables, not Mermaid or HTML.
- Use factual statements only. No "consider", "perhaps", "you might want to".
- Reference exact line numbers and unit names from the input.
- Do not invent findings not present in the input.
- Do not summarize away specific issues — preserve issue + suggestion text.

## Output

Output JSON only:

```json
{
  "markdown": "# PR Review #1234 ...\n\n..."
}
```

No prose outside the JSON. No markdown fences around the JSON.

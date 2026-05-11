# Classify changed files

You will receive a newline-separated list of file paths from a PR.

For each file, decide which reviewers should analyze it:

- `solid` — for any TS/JS file with logic worth reviewing for SOLID principles
- `patterns` — for any TS/JS file where design patterns (or their misuse) are likely
- `react` — for `.tsx`/`.jsx` files containing components or hooks
- `nextjs` — for files under `app/`, `pages/`, `middleware.*`, `next.config.*`, or files using Next.js APIs

Skip:

- Test files (`*.test.*`, `*.spec.*`, `__tests__/`)
- Generated files (`*.gen.*`, `*.generated.*`)
- Pure config (`*.config.json`, lockfiles)
- Type-only declaration files (`*.d.ts`)
- Type-only files (`*.types.ts`, `*.types.tsx`) — no reviewable logic
- Constant-only files (`*.constants.ts`, `*.constants.tsx`) — no reviewable logic
- Barrel exports (`index.ts`, `index.tsx` that only re-export)

## Output

Output JSON only, matching this schema:

```json
{
  "routes": [
    {
      "file": "src/components/Foo.tsx",
      "reviewers": ["react", "solid"],
      "rationale": "React component with logic"
    }
  ],
  "skipped": [{ "file": "src/foo.test.ts", "reason": "test file" }]
}
```

If nothing was skipped, `skipped` must still be present as an empty array `[]`.

Output JSON only. No prose, no markdown fences.

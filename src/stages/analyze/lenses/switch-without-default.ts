import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://eslint.org/docs/latest/rules/default-case";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const switches = source
      .getDescendantsOfKind(SyntaxKind.SwitchStatement)
      .sort((a, b) => a.getStart() - b.getStart());

    for (const sw of switches) {
      const clauses = sw.getCaseBlock().getClauses();
      const hasDefault = clauses.some((c) => c.getKind() === SyntaxKind.DefaultClause);

      if (hasDefault) continue;

      counter += 1;
      insights.push({
        id: `switch-without-default-${counter}`,
        severity: "info",
        lens: "switch-without-default",
        title: "Switch statement without default case",
        evidence: [{ file: filePath, line: sw.getStartLineNumber() }],
        explanation:
          "Switch statement has no default clause. Unmatched values fall through silently, which may hide unexpected inputs.",
        suggestion:
          "Add a default case that either handles the unexpected value, throws an error, or documents why it is safe to omit.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

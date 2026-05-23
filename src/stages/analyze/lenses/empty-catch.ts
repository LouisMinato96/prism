import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/RSPEC-2486/";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const catches = source
      .getDescendantsOfKind(SyntaxKind.CatchClause)
      .sort((a, b) => a.getStart() - b.getStart());

    for (const catchClause of catches) {
      const block = catchClause.getBlock();
      const stmtCount = block.getStatements().length;

      if (stmtCount > 0) continue;

      const hasComments =
        block.getLeadingCommentRanges().length > 0 ||
        block.getTrailingCommentRanges().length > 0 ||
        block.getFullText().includes("//") ||
        block.getFullText().includes("/*");

      const severity = hasComments ? "low" : "medium";
      counter += 1;

      insights.push({
        id: `empty-catch-${counter}`,
        severity,
        lens: "empty-catch",
        title: hasComments ? "Catch block has only comments" : "Empty catch block",
        evidence: [{ file: filePath, line: catchClause.getStartLineNumber() }],
        explanation: hasComments
          ? "Catch block contains comments but no executable statements. The error is silently swallowed."
          : "Catch block is completely empty. The error is silently discarded with no logging or handling.",
        suggestion:
          "Log the error, rethrow, or add explicit handling. If intentional, assign to a variable and document why.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

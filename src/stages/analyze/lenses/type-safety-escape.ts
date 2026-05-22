import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://typescript-eslint.io/rules/no-explicit-any/";
const MEDIUM_DENSITY = 5;
const HIGH_DENSITY = 15;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let anyCount = 0;
    let asCount = 0;
    let nonNullCount = 0;

    for (const node of source.getDescendants()) {
      const kind = node.getKind();
      if (kind === SyntaxKind.AnyKeyword) anyCount += 1;
      else if (kind === SyntaxKind.AsExpression) asCount += 1;
      else if (kind === SyntaxKind.NonNullExpression) nonNullCount += 1;
      else if (Node.isTypeReference(node) && node.getTypeName().getText() === "any") {
        anyCount += 1;
      }
    }

    const total = anyCount + asCount + nonNullCount;
    if (total === 0) continue;

    const severity =
      total >= HIGH_DENSITY ? "medium" : total >= MEDIUM_DENSITY ? "low" : "info";

    counter += 1;
    insights.push({
      id: `type-safety-escape-${counter}`,
      severity,
      lens: "type-safety-escape",
      title: `Type-safety escapes in ${filePath}`,
      evidence: [
        {
          file: filePath,
          detail: `any=${anyCount}, as-casts=${asCount}, non-null=${nonNullCount}`,
        },
      ],
      explanation: `File uses ${total} type-safety escapes (any types: ${anyCount}, as casts: ${asCount}, non-null assertions: ${nonNullCount}).`,
      suggestion:
        "Replace `any` with concrete types, prefer type guards over `as`, validate inputs instead of `!`.",
      metric: { name: "escapes", value: total, threshold: MEDIUM_DENSITY },
      docsUrl: DOCS_URL,
    });
  }

  return insights;
}

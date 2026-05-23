import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const LINE_THRESHOLD = 300;
const LINE_MEDIUM_THRESHOLD = 500;
const DECLARATION_THRESHOLD = 15;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const lineCount = source.getEndLineNumber();

    if (lineCount >= LINE_THRESHOLD) {
      const severity = lineCount >= LINE_MEDIUM_THRESHOLD ? "medium" : "low";
      counter += 1;
      insights.push({
        id: `large-file-${counter}`,
        severity,
        lens: "large-file",
        title: `File has ${lineCount} lines`,
        evidence: [{ file: filePath, line: 1 }],
        explanation: `File exceeds ${LINE_THRESHOLD}-line threshold (${lineCount} lines). Large files are harder to navigate, understand, and maintain.`,
        suggestion:
          "Split into smaller modules by responsibility. Extract related functions into separate files.",
        metric: {
          name: "file-line-count",
          value: lineCount,
          threshold: LINE_THRESHOLD,
        },
      });
    }

    const declCount =
      source.getChildrenOfKind(SyntaxKind.FunctionDeclaration).length +
      source.getChildrenOfKind(SyntaxKind.ClassDeclaration).length +
      source
        .getChildrenOfKind(SyntaxKind.VariableStatement)
        .filter((vs) =>
          vs
            .getDeclarations()
            .some(
              (d) =>
                d.getInitializerIfKind(SyntaxKind.ArrowFunction) !== undefined ||
                d.getInitializerIfKind(SyntaxKind.FunctionExpression) !== undefined,
            ),
        ).length;

    if (declCount >= DECLARATION_THRESHOLD) {
      counter += 1;
      insights.push({
        id: `large-file-${counter}`,
        severity: "low",
        lens: "large-file",
        title: `File has ${declCount} top-level declarations`,
        evidence: [{ file: filePath, line: 1 }],
        explanation: `File has ${declCount} top-level function/class declarations. High declaration density signals the file may have too many responsibilities.`,
        suggestion:
          "Group related declarations into separate modules by domain or feature.",
        metric: {
          name: "declaration-count",
          value: declCount,
          threshold: DECLARATION_THRESHOLD,
        },
      });
    }
  }

  return insights;
}

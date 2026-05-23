import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/RSPEC-107/";

const PARAM_THRESHOLD = 5;
const MEDIUM_THRESHOLD = 7;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const functions = [
      ...source.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...source.getDescendantsOfKind(SyntaxKind.FunctionExpression),
      ...source.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...source.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ].sort((a, b) => a.getStart() - b.getStart());

    for (const fn of functions) {
      const params = fn.getParameters();
      const nonRestCount = params.filter((p) => !p.isRestParameter()).length;

      if (nonRestCount < PARAM_THRESHOLD) continue;

      const fnName = getFunctionName(fn) ?? "(anonymous)";
      const severity = nonRestCount >= MEDIUM_THRESHOLD ? "medium" : "low";
      counter += 1;

      insights.push({
        id: `long-parameter-list-${counter}`,
        severity,
        lens: "long-parameter-list",
        title: `${nonRestCount} parameters: ${fnName}`,
        evidence: [{ file: filePath, line: fn.getStartLineNumber() }],
        explanation: `Function "${fnName}" has ${nonRestCount} parameters. Long parameter lists reduce readability and often signal that the function has too many responsibilities.`,
        suggestion:
          "Group related parameters into an options object, extract sub-functions, or use the builder pattern.",
        docsUrl: DOCS_URL,
        metric: {
          name: "param-count",
          value: nonRestCount,
          threshold: PARAM_THRESHOLD,
        },
      });
    }
  }

  return insights;
}

function getFunctionName(fn: Node): string | undefined {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn)
  ) {
    return fn.getName();
  }
  if (Node.isArrowFunction(fn)) {
    const parent = fn.getParent();
    if (Node.isVariableDeclaration(parent)) {
      return parent.getName();
    }
  }
  return undefined;
}

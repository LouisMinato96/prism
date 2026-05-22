import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL =
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await";

const LOOP_KINDS = new Set<SyntaxKind>([
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const awaits = source.getDescendantsOfKind(SyntaxKind.AwaitExpression);
    for (const awaitExpr of awaits) {
      const enclosingFn = findEnclosingFunction(awaitExpr);
      const loopAncestor = findLoopAncestor(awaitExpr, enclosingFn);
      if (!loopAncestor) continue;

      counter += 1;
      const line = awaitExpr.getStartLineNumber();
      insights.push({
        id: `await-in-loop-${counter}`,
        severity: "medium",
        lens: "await-in-loop",
        title: "await inside loop",
        evidence: [
          {
            file: filePath,
            line,
            detail: `loop kind: ${SyntaxKind[loopAncestor.getKind()]}`,
          },
        ],
        explanation:
          "Awaiting inside a loop forces serial execution. If iterations are independent, fan them out with Promise.all instead.",
        suggestion:
          "Replace with `await Promise.all(items.map(async (item) => ...))` when iterations do not depend on each other.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

function findEnclosingFunction(node: Node): Node | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

function findLoopAncestor(node: Node, stopAt: Node | undefined): Node | undefined {
  let current: Node | undefined = node.getParent();
  while (current && current !== stopAt) {
    const kind = current.getKind();
    if (LOOP_KINDS.has(kind)) return current;
    if (kind === SyntaxKind.ForOfStatement) {
      if (Node.isForOfStatement(current) && current.getAwaitKeyword()) {
        // for-await-of is intentional serial; skip
        return undefined;
      }
      return current;
    }
    current = current.getParent();
  }
  return undefined;
}

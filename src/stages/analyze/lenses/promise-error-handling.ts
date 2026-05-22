import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL =
  "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/catch";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
      const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression)!;
      if (propAccess.getName() !== "then") continue;

      if (hasCatchInChain(call)) continue;

      counter += 1;
      insights.push({
        id: `promise-error-handling-${counter}`,
        severity: "medium",
        lens: "promise-error-handling",
        title: ".then() without .catch()",
        evidence: [{ file: filePath, line: call.getStartLineNumber() }],
        explanation:
          "Promise chain uses .then() without a .catch() handler. Unhandled rejections crash in Node and silently fail in browsers.",
        suggestion:
          "Add .catch() at the end of the chain, or use async/await with try/catch. If intentional fire-and-forget, add .catch(() => {}) explicitly.",
        docsUrl: DOCS_URL,
      });
    }

    for (const awaitExpr of source.getDescendantsOfKind(SyntaxKind.AwaitExpression)) {
      const stmt = findEnclosingStatement(awaitExpr);
      if (!stmt) continue;
      if (isInsideTryCatch(awaitExpr)) continue;
      if (isInsideReturnOrAssignment(awaitExpr)) continue;

      counter += 1;
      insights.push({
        id: `promise-error-handling-${counter}`,
        severity: "low",
        lens: "promise-error-handling",
        title: "await without try/catch",
        evidence: [{ file: filePath, line: awaitExpr.getStartLineNumber() }],
        explanation:
          "Await expression at statement level without surrounding try/catch. If the promise rejects, the error propagates unhandled.",
        suggestion:
          "Wrap in try/catch if rejection is possible, or let it propagate if the caller handles it.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

function hasCatchInChain(thenCall: Node): boolean {
  let current: Node | undefined = thenCall.getParent();
  while (current) {
    if (Node.isPropertyAccessExpression(current) && current.getName() === "catch") {
      return true;
    }
    if (Node.isCallExpression(current)) {
      const callee = current.getExpression();
      if (Node.isPropertyAccessExpression(callee) && callee.getName() === "catch") {
        return true;
      }
      if (
        Node.isPropertyAccessExpression(callee) &&
        (callee.getName() === "then" || callee.getName() === "finally")
      ) {
        current = current.getParent();
        continue;
      }
    }
    break;
  }

  const parent = thenCall.getParent();
  if (Node.isPropertyAccessExpression(parent)) {
    const grandParent = parent.getParent();
    if (Node.isCallExpression(grandParent)) {
      return hasCatchInChain(grandParent);
    }
  }

  return false;
}

function findEnclosingStatement(node: Node): Node | undefined {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isExpressionStatement(current)) return current;
    if (Node.isVariableStatement(current)) return current;
    if (Node.isReturnStatement(current)) return undefined;
    current = current.getParent();
  }
  return undefined;
}

function isInsideTryCatch(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isTryStatement(current)) return true;
    if (
      Node.isFunctionDeclaration(current) ||
      Node.isFunctionExpression(current) ||
      Node.isArrowFunction(current) ||
      Node.isMethodDeclaration(current)
    ) {
      return false;
    }
    current = current.getParent();
  }
  return false;
}

function isInsideReturnOrAssignment(node: Node): boolean {
  let current: Node | undefined = node.getParent();
  while (current) {
    if (Node.isReturnStatement(current)) return true;
    if (Node.isVariableDeclaration(current)) return true;
    if (Node.isBinaryExpression(current)) return true;
    if (Node.isExpressionStatement(current)) return false;
    current = current.getParent();
  }
  return false;
}

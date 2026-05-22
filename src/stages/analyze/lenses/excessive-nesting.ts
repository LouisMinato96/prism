import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/RSPEC-134/";

const NESTING_THRESHOLD = 5;

const CONTROL_FLOW_KINDS = new Set([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.SwitchStatement,
  SyntaxKind.TryStatement,
]);

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
      const maxDepth = findMaxNestingDepth(fn);
      if (maxDepth < NESTING_THRESHOLD) continue;

      const deepest = findDeepestPoint(fn);
      const fnName = getFunctionName(fn) ?? "(anonymous)";

      counter += 1;
      insights.push({
        id: `excessive-nesting-${counter}`,
        severity: maxDepth >= 7 ? "medium" : "low",
        lens: "excessive-nesting",
        title: `Nesting depth ${maxDepth} in ${fnName}`,
        evidence: [{ file: filePath, line: deepest ?? fn.getStartLineNumber() }],
        explanation: `Function "${fnName}" has control flow nested ${maxDepth} levels deep. Deep nesting makes logic hard to follow and test.`,
        suggestion:
          "Flatten with early returns, extract nested blocks into helper functions, or use guard clauses.",
        docsUrl: DOCS_URL,
        metric: {
          name: "max-nesting-depth",
          value: maxDepth,
          threshold: NESTING_THRESHOLD,
        },
      });
    }
  }

  return insights;
}

function findMaxNestingDepth(fn: Node): number {
  let max = 0;

  function walk(node: Node, depth: number): void {
    const current = CONTROL_FLOW_KINDS.has(node.getKind()) ? depth + 1 : depth;
    if (current > max) max = current;

    for (const child of node.getChildren()) {
      if (isFunctionBoundary(child)) continue;
      walk(child, current);
    }
  }

  for (const child of fn.getChildren()) {
    walk(child, 0);
  }

  return max;
}

function findDeepestPoint(fn: Node): number | undefined {
  let maxDepth = 0;
  let deepestLine: number | undefined;

  function walk(node: Node, depth: number): void {
    const current = CONTROL_FLOW_KINDS.has(node.getKind()) ? depth + 1 : depth;
    if (current > maxDepth) {
      maxDepth = current;
      deepestLine = node.getStartLineNumber();
    }

    for (const child of node.getChildren()) {
      if (isFunctionBoundary(child)) continue;
      walk(child, current);
    }
  }

  for (const child of fn.getChildren()) {
    walk(child, 0);
  }

  return deepestLine;
}

function isFunctionBoundary(node: Node): boolean {
  return (
    Node.isFunctionDeclaration(node) ||
    Node.isFunctionExpression(node) ||
    Node.isArrowFunction(node) ||
    Node.isMethodDeclaration(node)
  );
}

function getFunctionName(fn: Node): string | undefined {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getName();
  }
  if (Node.isFunctionExpression(fn)) {
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

import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://typescript-eslint.io/rules/explicit-function-return-type/";

const FILE_THRESHOLD = 3;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let fileCount = 0;

    const functions = [
      ...source.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
      ...source.getDescendantsOfKind(SyntaxKind.FunctionExpression),
      ...source.getDescendantsOfKind(SyntaxKind.ArrowFunction),
      ...source.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
    ].sort((a, b) => a.getStart() - b.getStart());

    for (const fn of functions) {
      if (fn.getReturnTypeNode()) continue;
      if (isExpressionArrow(fn)) continue;
      if (!hasReturnStatement(fn)) continue;

      const fnName = getFunctionName(fn) ?? "(anonymous)";

      fileCount += 1;
      counter += 1;
      insights.push({
        id: `implicit-any-return-${counter}`,
        severity: "info",
        lens: "implicit-any-return",
        title: `Missing return type: ${fnName}`,
        evidence: [{ file: filePath, line: fn.getStartLineNumber() }],
        explanation: `Function "${fnName}" has no explicit return type annotation. The return type is inferred, which may mask unintended type changes.`,
        suggestion:
          "Add an explicit return type to document intent and catch regressions at the declaration site.",
        docsUrl: DOCS_URL,
      });
    }

    if (fileCount >= FILE_THRESHOLD) {
      insights.push({
        id: `implicit-any-return-metric-${filePath}`,
        severity: "low",
        lens: "implicit-any-return",
        title: `Implicit return type density: ${fileCount} functions`,
        evidence: [{ file: filePath, line: 1 }],
        explanation: `File has ${fileCount} functions without explicit return types.`,
        suggestion:
          "Add return type annotations to improve type documentation across the file.",
        docsUrl: DOCS_URL,
        metric: {
          name: "implicit-return-count",
          value: fileCount,
          threshold: FILE_THRESHOLD,
        },
      });
    }
  }

  return insights;
}

function isExpressionArrow(fn: Node): boolean {
  if (!Node.isArrowFunction(fn)) return false;
  const body = fn.getBody();
  return !Node.isBlock(body);
}

function hasReturnStatement(fn: Node): boolean {
  if (
    Node.isFunctionDeclaration(fn) ||
    Node.isMethodDeclaration(fn) ||
    Node.isFunctionExpression(fn) ||
    Node.isArrowFunction(fn)
  ) {
    const body = Node.isArrowFunction(fn) ? fn.getBody() : fn.getBody();
    if (!body || !Node.isBlock(body)) return false;

    for (const descendant of body.getDescendantsOfKind(SyntaxKind.ReturnStatement)) {
      if (isDirectReturn(descendant, body)) {
        const expr = descendant.getExpression();
        if (expr) return true;
      }
    }
  }
  return false;
}

function isDirectReturn(returnStmt: Node, fnBody: Node): boolean {
  let current: Node | undefined = returnStmt.getParent();
  while (current && current !== fnBody) {
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
  return current === fnBody;
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

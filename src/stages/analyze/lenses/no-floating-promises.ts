import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://typescript-eslint.io/rules/no-floating-promises/";

const ASYNC_NAME_PREFIXES = [
  "fetch",
  "send",
  "post",
  "delete",
  "put",
  "patch",
  "load",
  "save",
  "submit",
];

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const stmt of source.getDescendantsOfKind(SyntaxKind.ExpressionStatement)) {
      const expr = stmt.getExpression();
      if (!Node.isCallExpression(expr)) continue;

      if (isHandled(expr)) continue;
      if (!looksAsync(expr)) continue;

      const name = getCallName(expr);
      const isDefinitelyAsync = isAsyncCallee(expr);

      counter += 1;
      insights.push({
        id: `no-floating-promises-${counter}`,
        severity: isDefinitelyAsync ? "medium" : "low",
        lens: "no-floating-promises",
        title: `Floating promise: ${name}()`,
        evidence: [{ file: filePath, line: stmt.getStartLineNumber() }],
        explanation: `Call to ${name}() returns a Promise but the result is not awaited, voided, or caught. The rejection will be unhandled.`,
        suggestion:
          "Add await, void, or .catch() to handle the promise. If fire-and-forget is intentional, prefix with void.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

function isHandled(call: Node): boolean {
  const parent = call.getParent();
  if (!parent) return false;

  if (Node.isAwaitExpression(parent)) return true;
  if (Node.isVoidExpression(parent)) return true;
  if (Node.isReturnStatement(parent)) return true;
  if (Node.isVariableDeclaration(parent)) return true;
  if (Node.isBinaryExpression(parent)) return true;

  if (Node.isPropertyAccessExpression(parent)) {
    const name = parent.getName();
    if (name === "then" || name === "catch" || name === "finally") return true;
  }

  return false;
}

function looksAsync(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;

  if (isAsyncCallee(call)) return true;

  const name = getCallName(call).toLowerCase();
  return ASYNC_NAME_PREFIXES.some((prefix) => name.startsWith(prefix));
}

function isAsyncCallee(call: Node): boolean {
  if (!Node.isCallExpression(call)) return false;
  const expr = call.getExpression();

  if (Node.isIdentifier(expr)) {
    const decls = expr.getDefinitionNodes();
    for (const decl of decls) {
      if (hasAsyncModifier(decl)) return true;
      if (hasPromiseReturnType(decl)) return true;
    }
  }

  if (Node.isPropertyAccessExpression(expr)) {
    const name = expr.getName();
    if (ASYNC_NAME_PREFIXES.some((prefix) => name.toLowerCase().startsWith(prefix))) {
      return false;
    }
  }

  return false;
}

function hasAsyncModifier(node: Node): boolean {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  ) {
    return node.isAsync();
  }
  if (Node.isVariableDeclaration(node)) {
    const init = node.getInitializer();
    if (init && (Node.isArrowFunction(init) || Node.isFunctionExpression(init))) {
      return init.isAsync();
    }
  }
  return false;
}

function hasPromiseReturnType(node: Node): boolean {
  if (
    Node.isFunctionDeclaration(node) ||
    Node.isMethodDeclaration(node) ||
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node)
  ) {
    const returnType = node.getReturnTypeNode();
    if (returnType && returnType.getText().includes("Promise")) return true;
  }
  return false;
}

function getCallName(call: Node): string {
  if (!Node.isCallExpression(call)) return "(unknown)";
  const expr = call.getExpression();
  if (Node.isIdentifier(expr)) return expr.getText();
  if (Node.isPropertyAccessExpression(expr)) return expr.getName();
  return "(anonymous)";
}

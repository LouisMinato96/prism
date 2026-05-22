import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/RSPEC-109/";

const SAFE_VALUES = new Set([0, 1, -1]);

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
      const magicNumbers: Array<{ value: number; line: number }> = [];

      for (const literal of fn.getDescendantsOfKind(SyntaxKind.NumericLiteral)) {
        const value = Number(literal.getLiteralValue());
        if (SAFE_VALUES.has(value)) continue;
        if (isExcluded(literal)) continue;

        magicNumbers.push({
          value,
          line: literal.getStartLineNumber(),
        });
      }

      for (const magic of magicNumbers) {
        counter += 1;
        insights.push({
          id: `magic-number-${counter}`,
          severity: magicNumbers.length >= 3 ? "low" : "info",
          lens: "magic-number",
          title: `Magic number: ${magic.value}`,
          evidence: [{ file: filePath, line: magic.line }],
          explanation: `Numeric literal ${magic.value} appears without a named constant. Makes intent unclear and changes error-prone.`,
          suggestion:
            "Extract to a named constant (const MAX_RETRIES = 3) to document intent.",
          docsUrl: DOCS_URL,
        });
      }

      if (magicNumbers.length >= 3) {
        const fnName = getFunctionName(fn) ?? "(anonymous)";
        insights.push({
          id: `magic-number-metric-${filePath}-${fn.getStartLineNumber()}`,
          severity: "low",
          lens: "magic-number",
          title: `Magic number density: ${magicNumbers.length} in ${fnName}`,
          evidence: [{ file: filePath, line: fn.getStartLineNumber() }],
          explanation: `Function "${fnName}" has ${magicNumbers.length} magic numbers.`,
          suggestion:
            "Extract numeric literals to named constants to improve readability.",
          docsUrl: DOCS_URL,
          metric: {
            name: "magic-number-count",
            value: magicNumbers.length,
            threshold: 3,
          },
        });
      }
    }
  }

  return insights;
}

function isExcluded(literal: Node): boolean {
  const parent = literal.getParent();
  if (!parent) return false;

  if (Node.isVariableDeclaration(parent)) {
    const statement = parent.getParent()?.getParent();
    if (Node.isVariableStatement(statement)) {
      const flags = statement.getDeclarationKind();
      if (flags === "const") return true;
    }
  }

  if (Node.isEnumMember(parent)) return true;

  if (Node.isPropertyAssignment(parent)) {
    const obj = parent.getParent();
    if (obj) {
      const objParent = obj.getParent();
      if (Node.isVariableDeclaration(objParent)) {
        const stmt = objParent.getParent()?.getParent();
        if (Node.isVariableStatement(stmt) && stmt.getDeclarationKind() === "const") {
          return true;
        }
      }
    }
  }

  if (Node.isElementAccessExpression(parent)) return true;

  if (Node.isPropertyDeclaration(parent) && parent.isReadonly()) return true;

  if (
    Node.isForStatement(parent) ||
    Node.isForInStatement(parent) ||
    Node.isForOfStatement(parent)
  ) {
    return true;
  }

  const grandParent = parent?.getParent();
  if (
    Node.isBinaryExpression(parent) &&
    grandParent &&
    (Node.isForStatement(grandParent) || Node.isForOfStatement(grandParent))
  ) {
    return true;
  }

  return false;
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

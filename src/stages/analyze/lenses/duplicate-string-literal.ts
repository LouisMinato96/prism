import { Node, SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/RSPEC-1192/";

const MIN_LENGTH = 3;
const MIN_OCCURRENCES = 3;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const occurrences = new Map<string, number[]>();

    for (const literal of source.getDescendantsOfKind(SyntaxKind.StringLiteral)) {
      const value = literal.getLiteralValue();
      if (value.length < MIN_LENGTH) continue;
      if (isExcluded(literal)) continue;

      const lines = occurrences.get(value) ?? [];
      lines.push(literal.getStartLineNumber());
      occurrences.set(value, lines);
    }

    for (const [value, lines] of [...occurrences.entries()].sort(([a], [b]) =>
      a.localeCompare(b),
    )) {
      if (lines.length < MIN_OCCURRENCES) continue;

      counter += 1;
      const truncated = value.length > 40 ? value.slice(0, 37) + "..." : value;
      insights.push({
        id: `duplicate-string-literal-${counter}`,
        severity: lines.length >= 5 ? "low" : "info",
        lens: "duplicate-string-literal",
        title: `Duplicate string: "${truncated}" (${lines.length}x)`,
        evidence: [{ file: filePath, line: lines[0]! }],
        explanation: `String literal "${truncated}" appears ${lines.length} times in this file. Duplicated strings are harder to change consistently and may signal a missing constant.`,
        suggestion:
          "Extract to a named constant to ensure consistency and make changes single-point.",
        docsUrl: DOCS_URL,
        metric: {
          name: "duplicate-count",
          value: lines.length,
          threshold: MIN_OCCURRENCES,
        },
      });
    }
  }

  return insights;
}

function isExcluded(literal: Node): boolean {
  const parent = literal.getParent();
  if (!parent) return false;

  if (Node.isImportDeclaration(parent)) return true;
  if (Node.isExportDeclaration(parent)) return true;

  if (Node.isCallExpression(parent)) {
    const callee = parent.getExpression();
    if (Node.isIdentifier(callee) && callee.getText() === "require") return true;
  }

  if (
    Node.isInterfaceDeclaration(parent) ||
    Node.isTypeAliasDeclaration(parent) ||
    Node.isPropertySignature(parent)
  ) {
    return true;
  }

  if (Node.isPropertyAssignment(parent) && literal === parent.getNameNode()) {
    return true;
  }

  if (Node.isEnumMember(parent)) return true;

  return false;
}

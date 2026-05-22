import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const CYCLOMATIC_THRESHOLD_LOW = 10;
const CYCLOMATIC_THRESHOLD_MEDIUM = 15;
const CYCLOMATIC_THRESHOLD_HIGH = 25;
const DOCS_URL = "https://www.sonarsource.com/resources/cognitive-complexity/";

const BRANCH_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ConditionalExpression,
  SyntaxKind.CaseClause,
  SyntaxKind.CatchClause,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
]);

const NESTING_KINDS = new Set<SyntaxKind>([
  SyntaxKind.IfStatement,
  SyntaxKind.ForStatement,
  SyntaxKind.ForInStatement,
  SyntaxKind.ForOfStatement,
  SyntaxKind.WhileStatement,
  SyntaxKind.DoStatement,
  SyntaxKind.CatchClause,
]);

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const fn of collectFunctions(source)) {
      const cyclomatic = computeCyclomatic(fn);
      const cognitive = computeCognitive(fn);
      const score = Math.max(cyclomatic, cognitive);
      if (score < CYCLOMATIC_THRESHOLD_LOW) continue;

      const severity =
        score >= CYCLOMATIC_THRESHOLD_HIGH
          ? "high"
          : score >= CYCLOMATIC_THRESHOLD_MEDIUM
            ? "medium"
            : "low";

      counter += 1;
      insights.push({
        id: `complexity-hotspot-${counter}`,
        severity,
        lens: "complexity-hotspot",
        title: `High complexity function: ${functionName(fn)}`,
        evidence: [
          {
            file: filePath,
            line: fn.getStartLineNumber(),
            symbol: functionName(fn),
            detail: `cyclomatic=${cyclomatic}, cognitive=${cognitive}`,
          },
        ],
        explanation: `Function "${functionName(fn)}" has cyclomatic complexity ${cyclomatic} and cognitive complexity ${cognitive} (threshold ${CYCLOMATIC_THRESHOLD_LOW}).`,
        suggestion:
          "Extract sub-functions, replace nested conditionals with early returns, or simplify the control flow.",
        metric: {
          name: "complexity",
          value: score,
          threshold: CYCLOMATIC_THRESHOLD_LOW,
        },
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

function collectFunctions(source: SourceFile): Node[] {
  return [
    ...source.getDescendantsOfKind(SyntaxKind.FunctionDeclaration),
    ...source.getDescendantsOfKind(SyntaxKind.FunctionExpression),
    ...source.getDescendantsOfKind(SyntaxKind.ArrowFunction),
    ...source.getDescendantsOfKind(SyntaxKind.MethodDeclaration),
  ];
}

function computeCyclomatic(fn: Node): number {
  let count = 1;
  for (const node of fn.getDescendants()) {
    if (BRANCH_KINDS.has(node.getKind())) {
      count += 1;
      continue;
    }
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) {
        count += 1;
      }
    }
  }
  return count;
}

function computeCognitive(fn: Node): number {
  let total = 0;
  const walk = (node: Node, nesting: number): void => {
    let nextNesting = nesting;
    const kind = node.getKind();
    if (BRANCH_KINDS.has(kind)) {
      total += 1 + nesting;
    }
    if (NESTING_KINDS.has(kind)) {
      nextNesting += 1;
    }
    if (Node.isBinaryExpression(node)) {
      const op = node.getOperatorToken().getKind();
      if (op === SyntaxKind.AmpersandAmpersandToken || op === SyntaxKind.BarBarToken) {
        total += 1;
      }
    }
    for (const child of node.getChildren()) {
      walk(child, nextNesting);
    }
  };
  walk(fn, 0);
  return total;
}

function functionName(fn: Node): string {
  if (Node.isFunctionDeclaration(fn) || Node.isMethodDeclaration(fn)) {
    return fn.getName() ?? "<anonymous>";
  }
  if (Node.isFunctionExpression(fn)) {
    return fn.getName() ?? "<anonymous>";
  }
  if (Node.isArrowFunction(fn)) {
    const parent = fn.getParent();
    if (parent && Node.isVariableDeclaration(parent)) return parent.getName();
    if (parent && Node.isPropertyAssignment(parent)) return parent.getName();
  }
  return "<anonymous>";
}

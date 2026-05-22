import { Node, SyntaxKind, type SourceFile } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const LONG_FILE_LOC = 500;
const LONG_FUNCTION_LOC = 50;
const LONG_PARAM_LIST = 4;
const LARGE_CLASS_METHODS = 20;
const DOCS_URL = "https://refactoring.guru/refactoring/smells/bloaters";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const loc = source.getEndLineNumber();
    if (loc > LONG_FILE_LOC) {
      counter += 1;
      insights.push({
        id: `bloater-${counter}`,
        severity: "low",
        lens: "bloater",
        title: `Long file: ${filePath}`,
        evidence: [{ file: filePath, detail: `${loc} lines` }],
        explanation: `File spans ${loc} lines (threshold ${LONG_FILE_LOC}). Long files concentrate too many responsibilities.`,
        suggestion: "Split into smaller modules grouped by responsibility.",
        metric: { name: "file-loc", value: loc, threshold: LONG_FILE_LOC },
        docsUrl: DOCS_URL,
      });
    }

    for (const fn of collectFunctions(source)) {
      const startLine = fn.getStartLineNumber();
      const endLine = fn.getEndLineNumber();
      const span = endLine - startLine + 1;
      const name = functionName(fn);

      if (span > LONG_FUNCTION_LOC) {
        counter += 1;
        insights.push({
          id: `bloater-${counter}`,
          severity: span > LONG_FUNCTION_LOC * 2 ? "medium" : "low",
          lens: "bloater",
          title: `Long function: ${name}`,
          evidence: [
            { file: filePath, line: startLine, symbol: name, detail: `${span} lines` },
          ],
          explanation: `Function "${name}" spans ${span} lines (threshold ${LONG_FUNCTION_LOC}).`,
          suggestion: "Extract sub-functions; one function should do one thing.",
          metric: { name: "function-loc", value: span, threshold: LONG_FUNCTION_LOC },
          docsUrl: DOCS_URL,
        });
      }

      const params =
        Node.isFunctionDeclaration(fn) ||
        Node.isFunctionExpression(fn) ||
        Node.isArrowFunction(fn) ||
        Node.isMethodDeclaration(fn)
          ? fn.getParameters().length
          : 0;
      if (params > LONG_PARAM_LIST) {
        counter += 1;
        insights.push({
          id: `bloater-${counter}`,
          severity: "low",
          lens: "bloater",
          title: `Long parameter list: ${name}`,
          evidence: [
            { file: filePath, line: startLine, symbol: name, detail: `${params} params` },
          ],
          explanation: `Function "${name}" takes ${params} parameters (threshold ${LONG_PARAM_LIST}).`,
          suggestion: "Group related params into an options object or domain type.",
          metric: { name: "param-count", value: params, threshold: LONG_PARAM_LIST },
          docsUrl: DOCS_URL,
        });
      }
    }

    for (const cls of source.getDescendantsOfKind(SyntaxKind.ClassDeclaration)) {
      const methods = cls.getMethods().length;
      if (methods > LARGE_CLASS_METHODS) {
        counter += 1;
        const name = cls.getName() ?? "<anonymous>";
        insights.push({
          id: `bloater-${counter}`,
          severity: "medium",
          lens: "bloater",
          title: `Large class: ${name}`,
          evidence: [
            {
              file: filePath,
              line: cls.getStartLineNumber(),
              symbol: name,
              detail: `${methods} methods`,
            },
          ],
          explanation: `Class "${name}" has ${methods} methods (threshold ${LARGE_CLASS_METHODS}).`,
          suggestion: "Apply Extract Class; split responsibilities into smaller classes.",
          metric: {
            name: "method-count",
            value: methods,
            threshold: LARGE_CLASS_METHODS,
          },
          docsUrl: DOCS_URL,
        });
      }
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

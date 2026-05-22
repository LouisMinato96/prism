import { Node, SyntaxKind, type CallExpression } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const HOOK_NAMES = new Set(["useEffect", "useCallback", "useMemo", "useLayoutEffect"]);
const DOCS_URL = "https://react.dev/reference/eslint-plugin-react-hooks";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const calls = source
      .getDescendantsOfKind(SyntaxKind.CallExpression)
      .filter((call) => isHookCall(call));

    for (const call of calls) {
      const hookName = call.getExpression().getText();
      const callback = call.getArguments()[0];
      const depsArg = call.getArguments()[1];
      if (!callback || !depsArg) continue;
      if (
        !Node.isArrowFunction(callback) &&
        !Node.isFunctionExpression(callback) &&
        !Node.isFunctionDeclaration(callback)
      ) {
        continue;
      }
      if (!Node.isArrayLiteralExpression(depsArg)) continue;

      const localNames = collectLocalNames(callback);
      const referenced = new Set<string>();
      for (const ident of callback.getDescendantsOfKind(SyntaxKind.Identifier)) {
        const name = ident.getText();
        if (localNames.has(name)) continue;
        if (BUILTIN_NAMES.has(name)) continue;
        const parent = ident.getParent();
        if (
          parent &&
          Node.isPropertyAccessExpression(parent) &&
          parent.getName() === name
        ) {
          continue;
        }
        if (parent && Node.isParameterDeclaration(parent)) continue;
        referenced.add(name);
      }

      const declaredDeps = new Set<string>();
      for (const element of depsArg.getElements()) {
        const text = element.getText();
        const root = text.split(/[.(\[]/)[0]?.trim() ?? "";
        if (root.length > 0) declaredDeps.add(root);
      }

      const missing = [...referenced]
        .filter((name) => !declaredDeps.has(name))
        .sort()
        .slice(0, 5);
      const extra = [...declaredDeps]
        .filter((name) => !referenced.has(name))
        .sort()
        .slice(0, 5);

      if (missing.length === 0 && extra.length === 0) continue;

      counter += 1;
      const line = call.getStartLineNumber();
      insights.push({
        id: `hook-deps-mismatch-${counter}`,
        severity: missing.length > 0 ? "medium" : "low",
        lens: "hook-deps-mismatch",
        title: `${hookName} dependency mismatch`,
        evidence: [{ file: filePath, line }],
        explanation: [
          missing.length > 0
            ? `Identifiers referenced inside ${hookName} but missing from deps: ${missing.join(", ")}.`
            : "",
          extra.length > 0
            ? `Identifiers in deps but not referenced in callback: ${extra.join(", ")}.`
            : "",
        ]
          .filter((line) => line.length > 0)
          .join(" "),
        suggestion:
          "Align the deps array with identifiers used in the callback, or restructure to avoid stale closure.",
        docsUrl: DOCS_URL,
      });
    }
  }

  return insights;
}

function isHookCall(call: CallExpression): boolean {
  const expr = call.getExpression();
  const name = Node.isPropertyAccessExpression(expr)
    ? expr.getName()
    : (expr.getText().split(".").pop() ?? expr.getText());
  return HOOK_NAMES.has(name);
}

function collectLocalNames(callback: Node): Set<string> {
  const locals = new Set<string>();
  if (
    Node.isArrowFunction(callback) ||
    Node.isFunctionExpression(callback) ||
    Node.isFunctionDeclaration(callback)
  ) {
    for (const param of callback.getParameters()) {
      const name = param.getName();
      if (name) locals.add(name);
    }
  }
  for (const decl of callback.getDescendantsOfKind(SyntaxKind.VariableDeclaration)) {
    const name = decl.getName();
    if (name) locals.add(name);
  }
  for (const fn of callback.getDescendantsOfKind(SyntaxKind.FunctionDeclaration)) {
    const name = fn.getName();
    if (name) locals.add(name);
  }
  return locals;
}

const BUILTIN_NAMES = new Set([
  "undefined",
  "null",
  "true",
  "false",
  "console",
  "window",
  "document",
  "globalThis",
  "Math",
  "JSON",
  "Object",
  "Array",
  "String",
  "Number",
  "Boolean",
  "Date",
  "Promise",
  "Map",
  "Set",
  "Symbol",
  "Error",
  "RegExp",
  "setTimeout",
  "clearTimeout",
  "setInterval",
  "clearInterval",
  "fetch",
  "URL",
  "URLSearchParams",
]);

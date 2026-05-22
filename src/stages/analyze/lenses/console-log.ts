import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://developer.mozilla.org/en-US/docs/Web/API/console";

const CONSOLE_METHODS = new Set(["log", "warn", "error", "debug"]);
const SEVERITY_MAP: Record<string, "info" | "low"> = {
  log: "info",
  debug: "info",
  warn: "low",
  error: "low",
};

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    let fileCount = 0;

    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const expr = call.getExpression();
      if (expr.getKind() !== SyntaxKind.PropertyAccessExpression) continue;
      const propAccess = expr.asKind(SyntaxKind.PropertyAccessExpression)!;
      const obj = propAccess.getExpression().getText();
      const method = propAccess.getName();
      if (obj !== "console" || !CONSOLE_METHODS.has(method)) continue;

      fileCount += 1;
      counter += 1;
      insights.push({
        id: `console-log-${counter}`,
        severity: SEVERITY_MAP[method] ?? "info",
        lens: "console-log",
        title: `console.${method}() call`,
        evidence: [{ file: filePath, line: call.getStartLineNumber() }],
        explanation: `console.${method}() left in production code. Debug output leaks internal state to browser console.`,
        suggestion:
          "Remove or replace with a structured logger that respects log-level configuration.",
        docsUrl: DOCS_URL,
      });
    }

    for (const stmt of source.getDescendantsOfKind(SyntaxKind.DebuggerStatement)) {
      fileCount += 1;
      counter += 1;
      insights.push({
        id: `console-log-${counter}`,
        severity: "medium",
        lens: "console-log",
        title: "debugger statement",
        evidence: [{ file: filePath, line: stmt.getStartLineNumber() }],
        explanation:
          "debugger statements halt execution in dev tools. Must not ship to production.",
        suggestion: "Remove the debugger statement.",
        docsUrl: DOCS_URL,
      });
    }

    if (fileCount >= 3) {
      insights.push({
        id: `console-log-metric-${filePath}`,
        severity: fileCount >= 10 ? "low" : "info",
        lens: "console-log",
        title: `Console usage density: ${fileCount} calls`,
        evidence: [{ file: filePath, line: 1 }],
        explanation: `File has ${fileCount} console/debugger usages.`,
        suggestion: "Audit and remove debug output before shipping.",
        docsUrl: DOCS_URL,
        metric: { name: "console-count", value: fileCount, threshold: 3 },
      });
    }
  }

  return insights;
}

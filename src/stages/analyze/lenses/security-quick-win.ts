import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://rules.sonarsource.com/typescript/type/vulnerability/";

const SECRET_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: "aws-access-key", regex: /\bAKIA[0-9A-Z]{16}\b/g },
  { name: "google-api-key", regex: /\bAIza[0-9A-Za-z\-_]{35}\b/g },
  { name: "github-pat", regex: /\bghp_[A-Za-z0-9]{36}\b/g },
  { name: "openai-api-key", regex: /\bsk-[A-Za-z0-9]{32,}\b/g },
];

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const attr of source.getDescendantsOfKind(SyntaxKind.JsxAttribute)) {
      if (attr.getNameNode().getText() === "dangerouslySetInnerHTML") {
        counter += 1;
        insights.push({
          id: `security-quick-win-${counter}`,
          severity: "high",
          lens: "security-quick-win",
          title: "dangerouslySetInnerHTML usage",
          evidence: [{ file: filePath, line: attr.getStartLineNumber() }],
          explanation:
            "dangerouslySetInnerHTML bypasses React's escape protection and can introduce XSS if input is untrusted.",
          suggestion:
            "Sanitize input with a vetted library (e.g. DOMPurify), or render content as text where possible.",
          docsUrl: DOCS_URL,
        });
      }
    }

    for (const call of source.getDescendantsOfKind(SyntaxKind.CallExpression)) {
      const callee = call.getExpression().getText();
      if (callee === "eval") {
        counter += 1;
        insights.push({
          id: `security-quick-win-${counter}`,
          severity: "high",
          lens: "security-quick-win",
          title: "eval() call",
          evidence: [{ file: filePath, line: call.getStartLineNumber() }],
          explanation:
            "eval() executes arbitrary strings as code, opening injection paths and breaking optimizer assumptions.",
          suggestion:
            "Replace eval() with safer constructs (JSON.parse, Function table, etc.).",
          docsUrl: DOCS_URL,
        });
      }
    }

    for (const expr of source.getDescendantsOfKind(SyntaxKind.NewExpression)) {
      if (expr.getExpression().getText() === "Function") {
        counter += 1;
        insights.push({
          id: `security-quick-win-${counter}`,
          severity: "high",
          lens: "security-quick-win",
          title: "new Function() call",
          evidence: [{ file: filePath, line: expr.getStartLineNumber() }],
          explanation:
            "new Function() builds a function from a string at runtime; equivalent to eval for security purposes.",
          suggestion:
            "Replace with statically defined functions or a strict allow-list lookup.",
          docsUrl: DOCS_URL,
        });
      }
    }

    const text = source.getFullText();
    const lineStarts = computeLineStarts(text);
    for (const pattern of SECRET_PATTERNS) {
      const regex = new RegExp(pattern.regex.source, pattern.regex.flags);
      let match: RegExpExecArray | null = regex.exec(text);
      const seen = new Set<number>();
      while (match !== null) {
        if (!seen.has(match.index)) {
          seen.add(match.index);
          counter += 1;
          insights.push({
            id: `security-quick-win-${counter}`,
            severity: "high",
            lens: "security-quick-win",
            title: `Hardcoded secret: ${pattern.name}`,
            evidence: [
              {
                file: filePath,
                line: offsetToLine(lineStarts, match.index),
                detail: `${pattern.name} pattern match`,
              },
            ],
            explanation: `String matches ${pattern.name} format. Hardcoded secrets risk exfiltration via VCS.`,
            suggestion: "Rotate the secret and load from environment / secret store.",
            docsUrl: DOCS_URL,
          });
        }
        match = regex.exec(text);
      }
    }
  }

  return insights;
}

function computeLineStarts(text: string): number[] {
  const starts: number[] = [0];
  for (let i = 0; i < text.length; i += 1) {
    if (text[i] === "\n") starts.push(i + 1);
  }
  return starts;
}

function offsetToLine(lineStarts: number[], offset: number): number {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= offset) low = mid + 1;
    else high = mid - 1;
  }
  return Math.max(1, low);
}

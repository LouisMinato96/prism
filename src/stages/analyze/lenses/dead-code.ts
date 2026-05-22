import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://refactoring.com/catalog/removeDeadCode.html";

export function detect(input: LensInput): AnalyzeInsight[] {
  const incoming = new Map<string, number>();
  for (const edge of input.graph.edges) {
    incoming.set(edge.to, (incoming.get(edge.to) ?? 0) + 1);
  }

  const entryFile = input.scope.entry;
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  const exportedSymbols = input.symbols.symbols
    .filter((symbol) => symbol.exported)
    .filter((symbol) => symbol.file !== entryFile)
    .sort((a, b) => a.file.localeCompare(b.file) || a.name.localeCompare(b.name));

  for (const symbol of exportedSymbols) {
    if ((incoming.get(symbol.id) ?? 0) > 0) continue;
    counter += 1;
    insights.push({
      id: `dead-code-${counter}`,
      severity: "low",
      lens: "dead-code",
      title: `Unused export: ${symbol.name}`,
      evidence: [
        {
          file: symbol.file,
          line: symbol.line,
          symbol: symbol.name,
          detail: `type=${symbol.type}`,
        },
      ],
      explanation: `Exported ${symbol.type} "${symbol.name}" has no incoming graph edges within the analyzed scope.`,
      suggestion:
        "Remove the export, or confirm it is consumed outside the analyzed scope.",
      docsUrl: DOCS_URL,
    });
  }

  return insights;
}

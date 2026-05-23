import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const HUB_THRESHOLD = 4;

const ARCHITECTURAL_TYPES = new Set([
  "renders",
  "calls",
  "uses_hook",
  "uses_context",
  "provides_context",
  "wraps",
]);

export function detect(input: LensInput): AnalyzeInsight[] {
  const nodes = new Map(input.graph.nodes.map((n) => [n.id, n]));
  const architectural = input.graph.edges.filter((e) => ARCHITECTURAL_TYPES.has(e.type));

  const counts = new Map<string, { in: number; out: number }>();
  for (const edge of architectural) {
    counts.set(edge.from, {
      in: counts.get(edge.from)?.in ?? 0,
      out: (counts.get(edge.from)?.out ?? 0) + 1,
    });
    counts.set(edge.to, {
      in: (counts.get(edge.to)?.in ?? 0) + 1,
      out: counts.get(edge.to)?.out ?? 0,
    });
  }

  const insights: AnalyzeInsight[] = [];
  for (const [nodeId, count] of counts) {
    const node = nodes.get(nodeId);
    if (!node || node.type === "file") continue;

    if (count.out >= HUB_THRESHOLD) {
      insights.push({
        id: `hub-out-${insights.length + 1}`,
        severity: "low",
        lens: "coupling-hub",
        title: "High fan-out symbol",
        evidence: [{ node: nodeId }],
        explanation: `${node.type} "${node.name}" points to ${count.out} other symbols.`,
        suggestion:
          "Check whether this symbol is accumulating too many responsibilities.",
      });
    }

    if (count.in >= HUB_THRESHOLD) {
      insights.push({
        id: `hub-in-${insights.length + 1}`,
        severity: "info",
        lens: "coupling-hub",
        title: "High fan-in symbol",
        evidence: [{ node: nodeId }],
        explanation: `${node.type} "${node.name}" is referenced by ${count.in} graph edges.`,
        suggestion: "Treat this symbol as a central dependency when changing the slice.",
      });
    }
  }

  return insights;
}

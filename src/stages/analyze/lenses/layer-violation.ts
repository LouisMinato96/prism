import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

export function detect(input: LensInput): AnalyzeInsight[] {
  const nodes = new Map(input.graph.nodes.map((n) => [n.id, n]));

  return input.graph.edges
    .filter((edge) => edge.type === "calls")
    .filter((edge) => nodes.get(edge.from)?.type === "component")
    .filter((edge) => nodes.get(edge.to)?.type === "service")
    .map((edge, index) => ({
      id: `layer-leak-${index + 1}`,
      severity: "medium" as const,
      lens: "layering",
      title: "Component calls service directly",
      evidence: [{ edge: edge.id, from: edge.from, to: edge.to }],
      explanation:
        "A presentation component directly calls service-like code, which can mix UI and integration responsibilities.",
      suggestion:
        "Route the service call through a custom hook or explicit data boundary.",
    }));
}

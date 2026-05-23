import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

export function detect(input: LensInput): AnalyzeInsight[] {
  const nodes = new Map(input.graph.nodes.map((n) => [n.id, n]));

  return input.graph.edges
    .filter((edge) => {
      const from = nodes.get(edge.from);
      const to = nodes.get(edge.to);
      return (
        from?.type === "hook" &&
        to?.type === "component" &&
        (edge.type === "calls" || edge.type === "renders")
      );
    })
    .map((edge, index) => ({
      id: `direction-violation-${index + 1}`,
      severity: "high" as const,
      lens: "react",
      title: "Hook depends on component",
      evidence: [{ edge: edge.id, from: edge.from, to: edge.to }],
      explanation:
        "A hook depending on a component reverses the expected React dependency direction.",
      suggestion:
        "Keep hooks below components by moving shared logic into a hook or utility.",
    }));
}

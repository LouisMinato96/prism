import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

export function detect(input: LensInput): AnalyzeInsight[] {
  return input.diagrams
    .filter((diagram) => diagram.edgeCount === 0)
    .map((diagram, index) => ({
      id: `empty-diagram-${index + 1}`,
      severity: "info" as const,
      lens: "diagrams",
      title: "Diagram has no edges",
      evidence: [{ diagram: diagram.name }],
      explanation: `${diagram.title} did not find matching graph edges in this slice.`,
      suggestion:
        "If this was expected to be populated, improve graph extraction for this relationship.",
    }));
}

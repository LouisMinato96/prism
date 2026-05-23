import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

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

  const adjacency = new Map<string, string[]>();
  for (const edge of architectural) {
    if (!nodes.has(edge.from) || !nodes.has(edge.to)) continue;
    const targets = adjacency.get(edge.from) ?? [];
    targets.push(edge.to);
    adjacency.set(edge.from, targets);
  }

  const cycles = new Set<string>();
  for (const node of adjacency.keys()) {
    visitCycle(node, node, adjacency, [], cycles);
  }

  return [...cycles].sort().map((cycle, index) => {
    const ids = cycle.split(" -> ");
    return {
      id: `cycle-${index + 1}`,
      severity: "high" as const,
      lens: "coupling-cycle",
      title: "Cycle detected in architecture graph",
      evidence: ids.map((id) => ({ node: id })),
      explanation:
        "A dependency cycle makes the slice harder to reason about and change safely.",
      suggestion:
        "Break the cycle by moving shared behavior behind a lower-level boundary.",
    };
  });
}

function visitCycle(
  start: string,
  current: string,
  adjacency: Map<string, string[]>,
  path: string[],
  cycles: Set<string>,
): void {
  if (path.includes(current)) return;
  const nextPath = [...path, current];

  for (const next of adjacency.get(current) ?? []) {
    if (next === start && nextPath.length > 1) {
      cycles.add(canonicalCycle([...nextPath, start]));
      continue;
    }
    visitCycle(start, next, adjacency, nextPath, cycles);
  }
}

function canonicalCycle(cycle: string[]): string {
  const withoutRepeat = cycle.slice(0, -1);
  const rotations = withoutRepeat.map((_, index) => [
    ...withoutRepeat.slice(index),
    ...withoutRepeat.slice(0, index),
  ]);
  const best = rotations
    .map((rotation) => [...rotation, rotation[0]].join(" -> "))
    .sort()[0];
  return best ?? cycle.join(" -> ");
}

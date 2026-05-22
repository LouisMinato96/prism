import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SourceFile } from "ts-morph";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeInsightsSchema,
  type AnalyzeEdge,
  type AnalyzeGraph,
  type AnalyzeInsight,
  type AnalyzeInsights,
  type AnalyzeNode,
  type AnalyzeScope,
  type AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import type { AnalyzeDiagram } from "./diagrams.ts";
import { createAnalyzeProject, toAbsolutePath } from "./utils.ts";
import { runLenses } from "./lenses/index.ts";

const HUB_THRESHOLD = 4;

export async function runAnalyzeInsights(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
  opts: { force?: boolean } = {},
): Promise<AnalyzeInsights> {
  const stage = "analyze:insights";

  if (!opts.force && existsSync(wd.insightsFile())) {
    log.done("cached", stage);
    return AnalyzeInsightsSchema.parse(await Bun.file(wd.insightsFile()).json());
  }

  log.step("running deterministic lenses", stage);

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const project = createAnalyzeProject();
  const sourceFiles = new Map<string, SourceFile>();
  for (const file of scope.files) {
    try {
      const source = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
      sourceFiles.set(file.path, source);
    } catch {
      // skip files that cannot be parsed (lens detectors handle absence)
    }
  }

  const legacyInsights = [
    ...findLayerLeaks(graph.edges, nodes),
    ...findDirectionViolations(graph.edges, nodes),
    ...findCycles(graph.edges, nodes),
    ...findHubs(graph.edges, nodes),
    ...findEmptyDiagrams(diagrams),
  ];

  const lensInsights = runLenses({
    entry: graph.entry,
    scope,
    symbols,
    graph,
    diagrams,
    sourceFiles,
  });

  for (const file of sourceFiles.values()) {
    project.removeSourceFile(file);
  }

  const insights = [...legacyInsights, ...lensInsights].sort((a, b) =>
    a.id.localeCompare(b.id),
  );

  const result: AnalyzeInsights = {
    entry: graph.entry,
    generatedFrom: "graph.json",
    insights,
  };

  await writeFile(wd.insightsFile(), JSON.stringify(result, null, 2));
  log.done(`${insights.length} insights`, stage);
  return result;
}

function findLayerLeaks(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): AnalyzeInsight[] {
  return edges
    .filter((edge) => edge.type === "calls")
    .filter((edge) => nodes.get(edge.from)?.type === "component")
    .filter((edge) => nodes.get(edge.to)?.type === "service")
    .map((edge, index) => ({
      id: `layer-leak-${index + 1}`,
      severity: "medium" as const,
      lens: "layering",
      title: "Component calls service directly",
      evidence: [edgeEvidence(edge)],
      explanation:
        "A presentation component directly calls service-like code, which can mix UI and integration responsibilities.",
      suggestion:
        "Route the service call through a custom hook or explicit data boundary.",
    }));
}

function findDirectionViolations(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): AnalyzeInsight[] {
  return edges
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
      evidence: [edgeEvidence(edge)],
      explanation:
        "A hook depending on a component reverses the expected React dependency direction.",
      suggestion:
        "Keep hooks below components by moving shared logic into a hook or utility.",
    }));
}

function findCycles(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): AnalyzeInsight[] {
  const adjacency = new Map<string, string[]>();
  for (const edge of architecturalEdges(edges)) {
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
      lens: "coupling",
      title: "Cycle detected in architecture graph",
      evidence: ids.map((id) => ({ node: id })),
      explanation:
        "A dependency cycle makes the slice harder to reason about and change safely.",
      suggestion:
        "Break the cycle by moving shared behavior behind a lower-level boundary.",
    };
  });
}

function findHubs(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): AnalyzeInsight[] {
  const counts = new Map<string, { in: number; out: number }>();
  for (const edge of architecturalEdges(edges)) {
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
        lens: "coupling",
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
        lens: "coupling",
        title: "High fan-in symbol",
        evidence: [{ node: nodeId }],
        explanation: `${node.type} "${node.name}" is referenced by ${count.in} graph edges.`,
        suggestion: "Treat this symbol as a central dependency when changing the slice.",
      });
    }
  }

  return insights;
}

function findEmptyDiagrams(diagrams: AnalyzeDiagram[]): AnalyzeInsight[] {
  return diagrams
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

function architecturalEdges(edges: AnalyzeEdge[]): AnalyzeEdge[] {
  return edges.filter((edge) =>
    [
      "renders",
      "calls",
      "uses_hook",
      "uses_context",
      "provides_context",
      "wraps",
    ].includes(edge.type),
  );
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

function edgeEvidence(edge: AnalyzeEdge) {
  return {
    edge: edge.id,
    from: edge.from,
    to: edge.to,
  };
}

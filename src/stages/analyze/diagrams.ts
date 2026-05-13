import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import type {
  AnalyzeEdge,
  AnalyzeGraph,
  AnalyzeNode,
  AnalyzeNodeType,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";

export interface AnalyzeDiagram {
  name: string;
  title: string;
  path: string;
  edgeCount: number;
}

interface DiagramSpec {
  name: string;
  title: string;
  description: string;
  include: (edge: AnalyzeEdge, nodes: Map<string, AnalyzeNode>) => boolean;
}

const DIAGRAM_SPECS: DiagramSpec[] = [
  {
    name: "component-tree",
    title: "Component Tree",
    description: "React component render relationships discovered from JSX.",
    include: (edge) => edge.type === "renders",
  },
  {
    name: "provider-stack",
    title: "Provider Stack",
    description: "JSX wrapper and provider nesting relationships.",
    include: (edge) => edge.type === "wraps",
  },
  {
    name: "hook-flow",
    title: "Hook Flow",
    description: "Components and hooks connected through hook calls.",
    include: (edge, nodes) =>
      edge.type === "uses_hook" ||
      (edge.type === "calls" && touchesType(edge, nodes, new Set(["hook"]))),
  },
  {
    name: "service-flow",
    title: "Service Flow",
    description: "Calls into service-like functions and modules.",
    include: (edge, nodes) =>
      edge.type === "calls" && touchesType(edge, nodes, new Set(["service"])),
  },
  {
    name: "state-store-map",
    title: "State Store Map",
    description: "Zustand-style store subscriptions, snapshots, and mutation calls.",
    include: (edge) =>
      edge.type === "uses_store" ||
      edge.type === "reads_store" ||
      edge.type === "writes_store",
  },
  {
    name: "store-surface",
    title: "Store Surface",
    description: "Store state fields, getters, actions, and consumer action use.",
    include: (edge) =>
      edge.type === "store_has_state" ||
      edge.type === "store_has_getter" ||
      edge.type === "store_has_action" ||
      edge.type === "invokes_store_action",
  },
  {
    name: "context-boundaries",
    title: "Context Boundaries",
    description: "React context provider and consumer relationships.",
    include: (edge) => edge.type === "provides_context" || edge.type === "uses_context",
  },
  {
    name: "route-map",
    title: "Route Map",
    description:
      "Object-map selections, routed component targets, and deterministic fallback branches.",
    include: (edge) =>
      edge.type === "selects_by" ||
      edge.type === "routes_to" ||
      edge.type === "fallback_routes_to",
  },
  {
    name: "import-map",
    title: "Import Map",
    description: "Relative file imports inside the bounded analysis scope.",
    include: (edge) => edge.type === "imports",
  },
];

export async function runAnalyzeDiagrams(
  wd: AnalyzeWorkdir,
  graph: AnalyzeGraph,
  opts: { force?: boolean } = {},
): Promise<AnalyzeDiagram[]> {
  const stage = "analyze:diagrams";

  if (!opts.force && existsSync(wd.diagramManifestFile())) {
    const cached = (await Bun.file(wd.diagramManifestFile()).json()) as AnalyzeDiagram[];
    if (cached.every((diagram) => existsSync(diagram.path))) {
      log.done("cached", stage);
      return cached;
    }
  }

  log.step(`rendering ${DIAGRAM_SPECS.length} diagrams`, stage);

  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  const diagrams: AnalyzeDiagram[] = [];

  for (const spec of DIAGRAM_SPECS) {
    const edges = graph.edges
      .filter((edge) => spec.include(edge, nodes))
      .sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)));
    const path = wd.diagramFile(spec.name);
    await writeFile(path, renderDiagram(spec, edges, nodes));
    diagrams.push({
      name: spec.name,
      title: spec.title,
      path,
      edgeCount: edges.length,
    });
  }

  await writeFile(wd.diagramManifestFile(), JSON.stringify(diagrams, null, 2));
  log.done(`${diagrams.length} diagrams`, stage);
  return diagrams;
}

function renderDiagram(
  spec: DiagramSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): string {
  const lines = [
    `# ${spec.title}`,
    "",
    spec.description,
    "",
    "```mermaid",
    "flowchart TD",
  ];

  if (edges.length === 0) {
    lines.push(`  Empty["No ${spec.title.toLowerCase()} edges found"]`);
  } else {
    const aliases = new Map<string, string>();
    for (const edge of edges) {
      const from = aliasFor(edge.from, aliases);
      const to = aliasFor(edge.to, aliases);
      lines.push(`  ${from}["${labelFor(edge.from, nodes)}"]`);
      lines.push(`  ${to}["${labelFor(edge.to, nodes)}"]`);
      lines.push(`  ${from} -->|"${edgeLabel(edge)}"| ${to}`);
    }
  }

  lines.push("```", "");
  return lines.join("\n");
}

function aliasFor(id: string, aliases: Map<string, string>): string {
  const existing = aliases.get(id);
  if (existing) return existing;
  const alias = `n${aliases.size}`;
  aliases.set(id, alias);
  return alias;
}

function labelFor(id: string, nodes: Map<string, AnalyzeNode>): string {
  const node = nodes.get(id);
  if (!node) return escapeMermaidLabel(id);
  if (node.type === "file") return escapeMermaidLabel(node.name);
  return escapeMermaidLabel(`${node.type}: ${node.name}`);
}

function edgeLabel(edge: AnalyzeEdge): string {
  return escapeMermaidLabel(edge.label ? `${edge.type}: ${edge.label}` : edge.type);
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function touchesType(
  edge: AnalyzeEdge,
  nodes: Map<string, AnalyzeNode>,
  types: Set<AnalyzeNodeType>,
): boolean {
  const from = nodes.get(edge.from);
  const to = nodes.get(edge.to);
  return (
    (from !== undefined && types.has(from.type)) ||
    (to !== undefined && types.has(to.type))
  );
}

function edgeSortKey(edge: AnalyzeEdge): string {
  return `${edge.file ?? ""}:${edge.line ?? 0}:${edge.type}:${edge.from}:${edge.to}`;
}

import { mkdir, rm, writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { relative } from "node:path";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import type {
  AnalyzeEdge,
  AnalyzeGraph,
  AnalyzeInsight,
  AnalyzeInsights,
  AnalyzeNode,
  AnalyzeNodeType,
  AnalyzeScope,
  AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import type { AnalyzeDiagram } from "./diagrams.ts";

const PREVIEW_EDGE_LIMIT = 12;
const LARGE_DIAGRAM_EDGE_THRESHOLD = 50;

interface LayerPageSpec {
  file: string;
  title: string;
  purpose: string;
  diagramName: string;
  include: (edge: AnalyzeEdge, nodes: Map<string, AnalyzeNode>) => boolean;
}

const LAYER_PAGES: LayerPageSpec[] = [
  {
    file: "01-entry-provider-stack.md",
    title: "Entry Provider Stack",
    purpose: "Read this to see what the entry component wraps around the main body.",
    diagramName: "provider-stack",
    include: (edge) => edge.type === "wraps",
  },
  {
    file: "02-route-map.md",
    title: "Route Map",
    purpose:
      "Read this to understand object-map based view selection and fallback rendering.",
    diagramName: "route-map",
    include: (edge) =>
      edge.type === "selects_by" ||
      edge.type === "routes_to" ||
      edge.type === "fallback_routes_to",
  },
  {
    file: "03-context-boundaries.md",
    title: "Context Boundaries",
    purpose: "Read this to see where React context is provided and consumed.",
    diagramName: "context-boundaries",
    include: (edge) => edge.type === "provides_context" || edge.type === "uses_context",
  },
  {
    file: "04-hook-flow.md",
    title: "Hook Flow",
    purpose:
      "Read this to follow hook orchestration before dropping into raw call graphs.",
    diagramName: "hook-flow",
    include: (edge, nodes) =>
      edge.type === "uses_hook" ||
      (edge.type === "calls" && touchesType(edge, nodes, new Set(["hook"]))),
  },
  {
    file: "05-state-store-map.md",
    title: "State Store Map",
    purpose: "Read this to see store subscriptions, snapshots, and mutation calls.",
    diagramName: "state-store-map",
    include: (edge) =>
      edge.type === "uses_store" ||
      edge.type === "reads_store" ||
      edge.type === "writes_store",
  },
  {
    file: "06-store-surface.md",
    title: "Store Surface",
    purpose: "Read this to understand store state fields, getters, and actions.",
    diagramName: "store-surface",
    include: (edge) =>
      edge.type === "store_has_state" ||
      edge.type === "store_has_getter" ||
      edge.type === "store_has_action" ||
      edge.type === "invokes_store_action",
  },
  {
    file: "08-service-flow.md",
    title: "Service Flow",
    purpose: "Read this to find calls into service-like or integration code.",
    diagramName: "service-flow",
    include: (edge, nodes) =>
      edge.type === "calls" && touchesType(edge, nodes, new Set(["service"])),
  },
];

export async function runAnalyzeReport(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
  insights: AnalyzeInsights,
  opts: { force?: boolean } = {},
): Promise<string> {
  const stage = "analyze:report";

  if (!opts.force && expectedReportFiles(wd).every((file) => existsSync(file))) {
    log.done("cached", stage);
    return await readFile(wd.finalReport(), "utf8");
  }

  log.step("writing analysis report", stage);
  await rm(wd.finalPages(), { recursive: true, force: true });
  await mkdir(wd.finalPages(), { recursive: true });

  const report = renderDetailedReport(
    wd,
    scope,
    symbols,
    graph,
    diagrams,
    insights.insights,
  );
  await writeFile(wd.finalReport(), report);
  await writeFile(
    wd.finalIndexReport(),
    renderIndexReport(wd, scope, symbols, graph, diagrams, insights.insights),
  );
  await writeFile(
    wd.finalPage("00-entry-overview.md"),
    renderEntryOverviewPage(wd, scope, symbols, graph),
  );
  for (const spec of LAYER_PAGES) {
    await writeFile(wd.finalPage(spec.file), renderLayerPage(wd, spec, graph, diagrams));
  }
  await writeFile(
    wd.finalPage("07-extraction-gaps.md"),
    renderExtractionGapsPage(wd, scope, graph, diagrams),
  );
  await writeFile(
    wd.finalPage("09-debug-artifacts.md"),
    renderDebugArtifactsPage(wd, diagrams),
  );
  await writeFile(
    wd.finalPage("10-interpretation-guide.md"),
    renderInterpretationGuidePage(wd),
  );

  log.done(wd.finalIndexReport(), stage);
  return report;
}

function expectedReportFiles(wd: AnalyzeWorkdir): string[] {
  return [
    wd.finalReport(),
    wd.finalIndexReport(),
    wd.finalPage("00-entry-overview.md"),
    ...LAYER_PAGES.map((page) => wd.finalPage(page.file)),
    wd.finalPage("07-extraction-gaps.md"),
    wd.finalPage("09-debug-artifacts.md"),
    wd.finalPage("10-interpretation-guide.md"),
  ];
}

function renderIndexReport(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
  insights: AnalyzeInsight[],
): string {
  const debugStep = LAYER_PAGES.length + 2;
  const servicePage = LAYER_PAGES.find((page) => page.diagramName === "service-flow");
  const preGapPages = LAYER_PAGES.filter((page) => page.diagramName !== "service-flow");
  const lines: string[] = [
    "# Static Analysis",
    "",
    `Entry: \`${scope.entry}\``,
    `Depth: \`${scope.depth}\``,
    "",
    "## Start Here",
    "",
    "This report is organized for reading first and debugging second. Start with the layered pages, then open raw artifacts only when you need proof or detail.",
    `New to Prism static analysis? Read the [Interpretation Guide](${relative(wd.final(), wd.finalPage("10-interpretation-guide.md"))}) first.`,
    "",
    "```mermaid",
    "flowchart TD",
    '  Start["Start here"] --> Entry["0. Entry overview"]',
    '  Entry --> Provider["1. Entry provider stack"]',
    '  Provider --> Route["2. Route map"]',
    '  Route --> Context["3. Context boundaries"]',
    '  Context --> Hooks["4. Hook flow"]',
    '  Hooks --> State["5. State store map"]',
    '  State --> Surface["6. Store surface"]',
    '  Surface --> Gaps["7. Extraction gaps"]',
    '  Gaps --> Services["8. Service flow"]',
    `  Services --> Debug["${debugStep}. Debug artifacts"]`,
    "```",
    "",
    "## Snapshot",
    "",
    `- Files: ${scope.files.length}`,
    `- Symbols: ${symbols.symbols.length}`,
    `- Graph nodes: ${graph.nodes.length}`,
    `- Graph edges: ${graph.edges.length}`,
    `- Deterministic insights: ${insights.length}`,
    "",
    "## Reading Order",
    "",
    `0. [Entry Overview](${relative(wd.final(), wd.finalPage("00-entry-overview.md"))})`,
    ...preGapPages.map(
      (page, index) =>
        `${index + 1}. [${page.title}](${relative(wd.final(), wd.finalPage(page.file))})`,
    ),
    `7. [Extraction Gaps](${relative(wd.final(), wd.finalPage("07-extraction-gaps.md"))})`,
    servicePage
      ? `8. [${servicePage.title}](${relative(wd.final(), wd.finalPage(servicePage.file))})`
      : `8. [Service Flow](${relative(wd.final(), wd.finalPage("08-service-flow.md"))})`,
    `${debugStep}. [Debug Artifacts](${relative(wd.final(), wd.finalPage("09-debug-artifacts.md"))})`,
    `${debugStep + 1}. [Interpretation Guide](${relative(wd.final(), wd.finalPage("10-interpretation-guide.md"))})`,
    "",
    "## Diagram Size Guide",
    "",
    "| Diagram | Edges | Read as |",
    "| --- | ---: | --- |",
    ...diagrams.map(
      (diagram) =>
        `| [${diagram.title}](${relative(wd.final(), diagram.path)}) | ${diagram.edgeCount} | ${diagramAdvice(diagram)} |`,
    ),
    "",
    "## Top Insights",
    "",
    ...renderTopInsights(insights),
    "",
    "## Full Detail",
    "",
    `- [Full deterministic report](${relative(wd.final(), wd.finalReport())})`,
    `- [Raw artifact guide](${relative(wd.final(), wd.finalPage("09-debug-artifacts.md"))})`,
    `- [Interpretation guide](${relative(wd.final(), wd.finalPage("10-interpretation-guide.md"))})`,
    "",
  ];

  return lines.join("\n");
}

function renderEntryOverviewPage(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
): string {
  const depthCounts = countBy(scope.files.map((file) => String(file.depth))).sort(
    ([a], [b]) => Number(a) - Number(b),
  );
  const firstFileLines = scope.files
    .slice(0, 20)
    .map((file) => `- \`${file.path}\` depth=${file.depth}`);
  if (scope.files.length > 20) {
    firstFileLines.push(`- ... ${scope.files.length - 20} more files`);
  }

  const lines: string[] = [
    "# Entry Overview",
    "",
    "Purpose: establish the bounded slice before reading any relationship diagram.",
    "",
    "```mermaid",
    "flowchart LR",
    '  Entry["Entry file"] --> Scope["Scoped files"]',
    '  Scope --> Symbols["AST symbols"]',
    '  Symbols --> Graph["Architecture graph"]',
    '  Graph --> Layers["Layered report"]',
    "```",
    "",
    "## Counts",
    "",
    `- Entry: \`${scope.entry}\``,
    `- Depth: \`${scope.depth}\``,
    `- Files: ${scope.files.length}`,
    `- Symbols: ${symbols.symbols.length}`,
    `- Nodes: ${graph.nodes.length}`,
    `- Edges: ${graph.edges.length}`,
    "",
    "## Scope Depth",
    "",
    "| Depth | Files |",
    "| ---: | ---: |",
    ...depthCounts.map(([depth, count]) => `| ${depth} | ${count} |`),
    "",
    "## First Files",
    "",
    ...firstFileLines,
    "",
    "## Next",
    "",
    `Continue to [Entry Provider Stack](${relative(wd.finalPages(), wd.finalPage("01-entry-provider-stack.md"))}).`,
    "",
  ];

  return lines.join("\n");
}

function renderLayerPage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
): string {
  const nodes = new Map(graph.nodes.map((node) => [node.id, node]));
  let edges = graph.edges
    .filter((edge) => spec.include(edge, nodes))
    .sort((a, b) => edgeSortKey(a).localeCompare(edgeSortKey(b)));
  if (spec.diagramName === "provider-stack") {
    edges = edges.filter((edge) => edge.file === graph.entry);
  }
  const diagram = diagrams.find((item) => item.name === spec.diagramName);
  if (spec.diagramName === "context-boundaries") {
    return renderContextBoundariesPage(wd, spec, edges, nodes, diagram);
  }
  if (spec.diagramName === "hook-flow") {
    return renderHookFlowPage(wd, spec, edges, nodes, diagram);
  }
  if (spec.diagramName === "state-store-map") {
    return renderStateStoreMapPage(wd, spec, edges, nodes, diagram);
  }
  if (spec.diagramName === "store-surface") {
    return renderStoreSurfacePage(wd, spec, edges, nodes, diagram);
  }
  if (spec.diagramName === "service-flow") {
    return renderServiceFlowPage(wd, spec, edges, nodes, diagram);
  }

  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Preview",
    "",
    ...renderEdgePreview(edges, nodes),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

function renderStoreSurfacePage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
  diagram: AnalyzeDiagram | undefined,
): string {
  const summaries = buildStoreSurfaceSummaries(edges, nodes);
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Surface Summary",
    "",
    ...renderStoreSurfaceSummaryTable(summaries),
    "",
    "## State Fields",
    "",
    ...renderStoreSurfaceMemberTable(summaries, "state"),
    "",
    "## Getters",
    "",
    ...renderStoreSurfaceMemberTable(summaries, "getter"),
    "",
    "## Actions",
    "",
    ...renderStoreSurfaceMemberTable(summaries, "action"),
    "",
    "## Action Consumers",
    "",
    ...renderStoreActionConsumersTable(summaries),
    "",
    "## Preview",
    "",
    ...renderEdgePreview(edges, nodes),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

interface StoreSurfaceSummary {
  store: AnalyzeNode;
  state: AnalyzeNode[];
  getters: AnalyzeNode[];
  actions: AnalyzeNode[];
  actionConsumers: Map<string, AnalyzeNode[]>;
}

function buildStoreSurfaceSummaries(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): StoreSurfaceSummary[] {
  const summaries = new Map<string, StoreSurfaceSummary>();
  const actionToStore = new Map<string, string>();

  for (const edge of edges) {
    const store = nodes.get(edge.from);
    const member = nodes.get(edge.to);
    if (!store || store.type !== "store" || !member) continue;
    if (!isStoreSurfaceEdge(edge)) continue;

    const summary = getStoreSurfaceSummary(summaries, store);
    if (edge.type === "store_has_state") pushUniqueNode(summary.state, member);
    if (edge.type === "store_has_getter") pushUniqueNode(summary.getters, member);
    if (edge.type === "store_has_action") {
      pushUniqueNode(summary.actions, member);
      actionToStore.set(member.id, store.id);
    }
  }

  for (const edge of edges.filter((item) => item.type === "invokes_store_action")) {
    const storeId = actionToStore.get(edge.to);
    const consumer = nodes.get(edge.from);
    if (!storeId || !consumer) continue;
    const summary = summaries.get(storeId);
    if (!summary) continue;
    const consumers = summary.actionConsumers.get(edge.to) ?? [];
    pushUniqueNode(consumers, consumer);
    summary.actionConsumers.set(edge.to, consumers);
  }

  for (const summary of summaries.values()) {
    summary.state.sort(compareNodesByName);
    summary.getters.sort(compareNodesByName);
    summary.actions.sort(compareNodesByName);
  }

  return [...summaries.values()].sort((a, b) =>
    displayNodeName(a.store).localeCompare(displayNodeName(b.store)),
  );
}

function getStoreSurfaceSummary(
  summaries: Map<string, StoreSurfaceSummary>,
  store: AnalyzeNode,
): StoreSurfaceSummary {
  const existing = summaries.get(store.id);
  if (existing) return existing;

  const summary: StoreSurfaceSummary = {
    store,
    state: [],
    getters: [],
    actions: [],
    actionConsumers: new Map(),
  };
  summaries.set(store.id, summary);
  return summary;
}

function renderStoreSurfaceSummaryTable(summaries: StoreSurfaceSummary[]): string[] {
  if (summaries.length === 0) return ["No store surface facts found."];

  return [
    "| Store | Source | State | Getters | Actions | Invoked Actions |",
    "| --- | --- | ---: | ---: | ---: | ---: |",
    ...summaries.map(
      (summary) =>
        `| \`${displayNodeName(summary.store)}\` | ${formatSourceRef(summary.store.file, summary.store.line)} | ${summary.state.length} | ${summary.getters.length} | ${summary.actions.length} | ${summary.actionConsumers.size} |`,
    ),
  ];
}

function renderStoreSurfaceMemberTable(
  summaries: StoreSurfaceSummary[],
  kind: "state" | "getter" | "action",
): string[] {
  const rows = summaries.flatMap((summary) => {
    const members =
      kind === "state"
        ? summary.state
        : kind === "getter"
          ? summary.getters
          : summary.actions;
    return members.map((member) => ({ store: summary.store, member }));
  });
  if (rows.length === 0) return [`No store ${kind} entries found.`];

  return [
    "| Store | Name | Source |",
    "| --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${displayNodeName(row.store)}\` | \`${displayNodeName(row.member)}\` | ${formatSourceRef(row.member.file, row.member.line)} |`,
    ),
  ];
}

function renderStoreActionConsumersTable(summaries: StoreSurfaceSummary[]): string[] {
  const rows = summaries.flatMap((summary) =>
    summary.actions
      .map((action) => ({
        store: summary.store,
        action,
        consumers: summary.actionConsumers.get(action.id) ?? [],
      }))
      .filter((row) => row.consumers.length > 0),
  );
  if (rows.length === 0) return ["No action consumer edges found."];

  return [
    "| Store | Action | Consumers | Source |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${displayNodeName(row.store)}\` | \`${displayNodeName(row.action)}\` | ${inlineNodeList(row.consumers, 6)} | ${formatSourceRef(row.action.file, row.action.line)} |`,
    ),
  ];
}

function isStoreSurfaceEdge(edge: AnalyzeEdge): boolean {
  return (
    edge.type === "store_has_state" ||
    edge.type === "store_has_getter" ||
    edge.type === "store_has_action"
  );
}

function renderStateStoreMapPage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
  diagram: AnalyzeDiagram | undefined,
): string {
  const summaries = buildStoreSummaries(edges, nodes);
  const accesses = buildStoreAccessRows(edges, nodes);
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Store Access Summary",
    "",
    ...renderStoreSummaryTable(summaries),
    "",
    "## Reactive Reads",
    "",
    ...renderStoreAccessTable(
      accesses.filter((access) => access.type === "uses_store"),
      "No reactive store reads found.",
    ),
    "",
    "## Snapshot Reads",
    "",
    ...renderStoreAccessTable(
      accesses.filter((access) => access.type === "reads_store"),
      "No store snapshot reads found.",
    ),
    "",
    "## Mutations",
    "",
    ...renderStoreAccessTable(
      accesses.filter((access) => access.type === "writes_store"),
      "No store mutation calls found.",
    ),
    "",
    "## Preview",
    "",
    ...renderEdgePreview(edges, nodes),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

interface StoreSummary {
  store: AnalyzeNode;
  consumers: AnalyzeNode[];
  labels: string[];
  reactive: number;
  snapshots: number;
  mutations: number;
}

interface StoreAccessRow {
  type: Extract<AnalyzeEdge["type"], "uses_store" | "reads_store" | "writes_store">;
  store: AnalyzeNode;
  consumer: AnalyzeNode;
  label: string;
  sourceFile?: string;
  sourceLine?: number;
}

function buildStoreSummaries(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): StoreSummary[] {
  const summaries = new Map<string, StoreSummary>();

  for (const edge of edges) {
    const store = nodes.get(edge.to);
    const consumer = nodes.get(edge.from);
    if (!store || store.type !== "store" || !consumer) continue;

    const summary =
      summaries.get(store.id) ??
      ({
        store,
        consumers: [],
        labels: [],
        reactive: 0,
        snapshots: 0,
        mutations: 0,
      } satisfies StoreSummary);

    pushUniqueNode(summary.consumers, consumer);
    if (edge.label && !summary.labels.includes(edge.label))
      summary.labels.push(edge.label);
    if (edge.type === "uses_store") summary.reactive += 1;
    if (edge.type === "reads_store") summary.snapshots += 1;
    if (edge.type === "writes_store") summary.mutations += 1;

    summaries.set(store.id, summary);
  }

  return [...summaries.values()].sort((a, b) =>
    displayNodeName(a.store).localeCompare(displayNodeName(b.store)),
  );
}

function renderStoreSummaryTable(summaries: StoreSummary[]): string[] {
  if (summaries.length === 0) return ["No store access edges found."];

  return [
    "| Store | Source | Reactive | Snapshots | Mutations | Consumers | Selected / Called |",
    "| --- | --- | ---: | ---: | ---: | --- | --- |",
    ...summaries.map(
      (summary) =>
        `| \`${displayNodeName(summary.store)}\` | ${formatSourceRef(summary.store.file, summary.store.line)} | ${summary.reactive} | ${summary.snapshots} | ${summary.mutations} | ${inlineNodeList(summary.consumers, 5)} | ${inlineLabelList(summary.labels, 6)} |`,
    ),
  ];
}

function buildStoreAccessRows(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): StoreAccessRow[] {
  return edges
    .flatMap((edge): StoreAccessRow[] => {
      if (!isStoreAccessEdge(edge)) return [];

      const store = nodes.get(edge.to);
      const consumer = nodes.get(edge.from);
      if (!store || store.type !== "store" || !consumer) return [];

      return [
        {
          type: edge.type,
          store,
          consumer,
          label: edge.label ?? "-",
          sourceFile: edge.file,
          sourceLine: edge.line,
        },
      ];
    })
    .sort(
      (a, b) =>
        displayNodeName(a.store).localeCompare(displayNodeName(b.store)) ||
        displayNodeName(a.consumer).localeCompare(displayNodeName(b.consumer)) ||
        a.label.localeCompare(b.label),
    );
}

function renderStoreAccessTable(rows: StoreAccessRow[], emptyText: string): string[] {
  if (rows.length === 0) return [emptyText];

  return [
    "| Store | Consumer | Selected / Called | Source |",
    "| --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${displayNodeName(row.store)}\` | \`${displayNodeName(row.consumer)}\` | ${inlineLabel(row.label)} | ${formatSourceRef(row.sourceFile, row.sourceLine)} |`,
    ),
  ];
}

function isStoreAccessEdge(edge: AnalyzeEdge): edge is AnalyzeEdge & {
  type: "uses_store" | "reads_store" | "writes_store";
} {
  return (
    edge.type === "uses_store" ||
    edge.type === "reads_store" ||
    edge.type === "writes_store"
  );
}

function inlineLabelList(labels: string[], limit: number): string {
  if (labels.length === 0) return "-";
  const shown = labels.slice(0, limit).map((label) => inlineLabel(label));
  if (labels.length > limit) shown.push(`+${labels.length - limit} more`);
  return shown.join(", ");
}

function inlineLabel(label: string): string {
  return `\`${label.replace(/\s+/g, " ").replace(/\|/g, "\\|")}\``;
}

function renderHookFlowPage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
  diagram: AnalyzeDiagram | undefined,
): string {
  const hooks = buildHookSummaries(edges, nodes);
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Hook Orchestration",
    "",
    ...renderHookSummaryTable(hooks),
    "",
    "## Preview",
    "",
    ...renderEdgePreview(edges, nodes),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

interface HookSummary {
  hook: AnalyzeNode;
  sourceFile?: string;
  sourceLine?: number;
  category: string;
  usedBy: AnalyzeNode[];
  calls: AnalyzeNode[];
}

function buildHookSummaries(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): HookSummary[] {
  const summaries = new Map<string, HookSummary>();

  for (const edge of edges) {
    const from = nodes.get(edge.from);
    const to = nodes.get(edge.to);
    if (!from || !to) continue;

    if (to.type === "hook") {
      const summary = getHookSummary(summaries, to);
      pushUniqueNode(summary.usedBy, from);
      assignSourceRef(summary, edge.file, edge.line);
    }

    if (from.type === "hook") {
      const summary = getHookSummary(summaries, from);
      pushUniqueNode(summary.calls, to);
      assignSourceRef(summary, edge.file, edge.line);
    }
  }

  for (const summary of summaries.values()) {
    summary.category = inferHookCategory(summary);
  }

  return [...summaries.values()].sort((a, b) =>
    displayNodeName(a.hook).localeCompare(displayNodeName(b.hook)),
  );
}

function getHookSummary(
  summaries: Map<string, HookSummary>,
  hook: AnalyzeNode,
): HookSummary {
  const existing = summaries.get(hook.id);
  if (existing) return existing;

  const summary: HookSummary = {
    hook,
    category: "logic",
    usedBy: [],
    calls: [],
  };
  summaries.set(hook.id, summary);
  return summary;
}

function renderHookSummaryTable(summaries: HookSummary[]): string[] {
  if (summaries.length === 0) return ["No hook orchestration edges found."];

  return [
    "| Hook | Category | Used by | Calls | Source |",
    "| --- | --- | --- | --- | --- |",
    ...summaries.map(
      (summary) =>
        `| \`${displayNodeName(summary.hook)}\` | ${summary.category} | ${inlineNodeList(summary.usedBy, 4)} | ${inlineNodeList(summary.calls, 4)} | ${formatPreferredSourceRef(summary.sourceFile, summary.sourceLine, summary.hook.file, summary.hook.line)} |`,
    ),
  ];
}

function inferHookCategory(summary: HookSummary): string {
  const name = displayNodeName(summary.hook).toLowerCase();
  const file = summary.hook.file?.toLowerCase() ?? "";
  const calledTypes = new Set(summary.calls.map((node) => node.type));

  if (name.includes("context") || calledTypes.has("context")) return "context";
  if (/(socket|sync|live|prefetch|subscribe)/.test(`${name} ${file}`)) return "sync";
  if (/(fetch|load|query|mutation|data)/.test(`${name} ${file}`)) return "data";
  if (calledTypes.has("service")) return "service";
  if (/(scroll|dimension|modal|tab|dropdown|layout|state)/.test(`${name} ${file}`)) {
    return "ui";
  }
  return "logic";
}

function renderContextBoundariesPage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
  diagram: AnalyzeDiagram | undefined,
): string {
  const ownership = buildContextOwnership(edges, nodes);
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Context Ownership",
    "",
    ...renderContextOwnershipTable(ownership),
    "",
    "## Preview",
    "",
    ...renderContextOwnershipMermaid(ownership),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

interface ContextOwnership {
  context: AnalyzeNode;
  providers: AnalyzeNode[];
  consumers: AnalyzeNode[];
  sourceFile?: string;
  sourceLine?: number;
}

function buildContextOwnership(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): ContextOwnership[] {
  const groups = new Map<string, ContextOwnership>();

  for (const edge of edges) {
    const context = nodes.get(edge.to);
    const participant = nodes.get(edge.from);
    if (!context || !participant) continue;

    const group =
      groups.get(context.id) ??
      ({
        context,
        providers: [],
        consumers: [],
      } satisfies ContextOwnership);

    if (edge.type === "provides_context") {
      pushUniqueNode(group.providers, participant);
    } else if (edge.type === "uses_context") {
      pushUniqueNode(group.consumers, participant);
    }
    assignSourceRef(group, edge.file, edge.line);

    groups.set(context.id, group);
  }

  return [...groups.values()].sort((a, b) =>
    displayNodeName(a.context).localeCompare(displayNodeName(b.context)),
  );
}

function renderContextOwnershipTable(groups: ContextOwnership[]): string[] {
  if (groups.length === 0) return ["No context ownership edges found."];

  return [
    "| Context | Providers | Consumers | Source |",
    "| --- | --- | --- | --- |",
    ...groups.map(
      (group) =>
        `| \`${displayNodeName(group.context)}\` | ${inlineNodeList(group.providers)} | ${inlineNodeList(group.consumers)} | ${formatPreferredSourceRef(group.sourceFile, group.sourceLine, group.context.file, group.context.line)} |`,
    ),
  ];
}

interface ServiceFlowRow {
  caller: AnalyzeNode;
  callee: AnalyzeNode;
  edgeType: AnalyzeEdge["type"];
  label: string;
  sourceFile?: string;
  sourceLine?: number;
}

function renderServiceFlowPage(
  wd: AnalyzeWorkdir,
  spec: LayerPageSpec,
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
  diagram: AnalyzeDiagram | undefined,
): string {
  const rows = buildServiceFlowRows(edges, nodes);
  const lines: string[] = [
    `# ${spec.title}`,
    "",
    `Purpose: ${spec.purpose}`,
    "",
    "## How To Read",
    "",
    ...renderLayerAdvice(spec.diagramName, edges.length),
    "",
    "## Service Calls",
    "",
    ...renderServiceFlowTable(rows),
    "",
    "## Preview",
    "",
    ...renderEdgePreview(edges, nodes),
    "",
    "## Full Diagram",
    "",
    diagram
      ? `- [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) - ${diagram.edgeCount} edges`
      : "- Full diagram was not generated.",
    "",
  ];

  return lines.join("\n");
}

function buildServiceFlowRows(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): ServiceFlowRow[] {
  return edges
    .flatMap((edge): ServiceFlowRow[] => {
      const caller = nodes.get(edge.from);
      const callee = nodes.get(edge.to);
      if (!caller || !callee) return [];

      return [
        {
          caller,
          callee,
          edgeType: edge.type,
          label: edge.label ?? "-",
          sourceFile: edge.file,
          sourceLine: edge.line,
        },
      ];
    })
    .sort(
      (a, b) =>
        displayNodeName(a.caller).localeCompare(displayNodeName(b.caller)) ||
        displayNodeName(a.callee).localeCompare(displayNodeName(b.callee)) ||
        a.edgeType.localeCompare(b.edgeType) ||
        a.label.localeCompare(b.label),
    );
}

function renderServiceFlowTable(rows: ServiceFlowRow[]): string[] {
  if (rows.length === 0) return ["No service flow edges found."];

  return [
    "| Caller | Service / Target | Edge | Selected / Called | Source |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| \`${displayNodeName(row.caller)}\` | \`${displayNodeName(row.callee)}\` | \`${row.edgeType}\` | ${inlineLabel(row.label)} | ${formatSourceRef(row.sourceFile, row.sourceLine)} |`,
    ),
  ];
}

function renderContextOwnershipMermaid(groups: ContextOwnership[]): string[] {
  if (groups.length === 0) return ["No preview available."];

  const lines = ["```mermaid", "flowchart TD"];
  const aliases = new Map<string, string>();
  const nodeLines = new Map<string, string>();
  const edgeLines: string[] = [];

  for (const group of groups.slice(0, PREVIEW_EDGE_LIMIT)) {
    const contextAlias = aliasFor(group.context.id, aliases);
    nodeLines.set(contextAlias, mermaidNodeLine(contextAlias, group.context));

    for (const provider of group.providers) {
      const providerAlias = aliasFor(provider.id, aliases);
      nodeLines.set(providerAlias, mermaidNodeLine(providerAlias, provider));
      edgeLines.push(`  ${providerAlias} -->|"provides"| ${contextAlias}`);
    }

    for (const consumer of group.consumers) {
      const consumerAlias = aliasFor(consumer.id, aliases);
      nodeLines.set(consumerAlias, mermaidNodeLine(consumerAlias, consumer));
      edgeLines.push(`  ${contextAlias} -->|"consumed by"| ${consumerAlias}`);
    }
  }

  lines.push(...nodeLines.values(), ...edgeLines, "```");
  return lines;
}

function mermaidNodeLine(alias: string, node: AnalyzeNode): string {
  return `  ${alias}["${escapeMermaidLabel(`${node.type}: ${node.name}`)}"]`;
}

function inlineNodeList(nodes: AnalyzeNode[], limit = 8): string {
  if (nodes.length === 0) return "-";
  const shown = nodes.slice(0, limit).map((node) => `\`${displayNodeName(node)}\``);
  if (nodes.length > limit) shown.push(`+${nodes.length - limit} more`);
  return shown.join(", ");
}

function displayNodeName(node: AnalyzeNode): string {
  return node.name.replace(/\|/g, "\\|");
}

function pushUniqueNode(nodes: AnalyzeNode[], node: AnalyzeNode): void {
  if (nodes.some((existing) => existing.id === node.id)) return;
  nodes.push(node);
}

function compareNodesByName(a: AnalyzeNode, b: AnalyzeNode): number {
  return displayNodeName(a).localeCompare(displayNodeName(b));
}

function renderDebugArtifactsPage(
  wd: AnalyzeWorkdir,
  diagrams: AnalyzeDiagram[],
): string {
  const lines: string[] = [
    "# Debug Artifacts",
    "",
    "Use this page when a layered page needs proof, line-level facts, or a full graph traversal.",
    "",
    "## Raw Diagrams",
    "",
    "| Diagram | Edges | Advice |",
    "| --- | ---: | --- |",
    ...diagrams.map(
      (diagram) =>
        `| [${diagram.title}](${relative(wd.finalPages(), diagram.path)}) | ${diagram.edgeCount} | ${diagramAdvice(diagram)} |`,
    ),
    "",
    "## JSON Artifacts",
    "",
    `- Graph: \`${relative(wd.finalPages(), wd.graphFile())}\``,
    `- Symbols: \`${relative(wd.finalPages(), wd.symbolsFile())}\``,
    `- Scope: \`${relative(wd.finalPages(), wd.scopeFile())}\``,
    `- Insights: \`${relative(wd.finalPages(), wd.insightsFile())}\``,
    "",
    "## Full Report",
    "",
    `- [Full deterministic report](${relative(wd.finalPages(), wd.finalReport())})`,
    "",
  ];

  return lines.join("\n");
}

function renderExtractionGapsPage(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
): string {
  const gaps = collectExtractionGaps(scope, graph, diagrams);
  const lines: string[] = [
    "# Extraction Gaps",
    "",
    "Purpose: identify deterministic extraction blind spots before trusting downstream architecture conclusions.",
    "",
    "## Summary",
    "",
    ...renderExtractionGapSummaryTable(gaps),
    "",
    "## How To Read This",
    "",
    "Unresolved imports usually mean Prism could not map an import specifier to a file in the bounded scope. Empty diagrams mean the graph has no edges for that layer. Unscoped or unresolved nodes are referenced symbols that Prism can see, but cannot fully ground inside the analyzed slice; external UI components commonly appear here.",
    "",
    "## Unresolved Imports",
    "",
    ...renderUnresolvedImportsTable(gaps.unresolvedImports),
    "",
    "## Empty Diagrams",
    "",
    ...renderEmptyDiagramsTable(wd, gaps.emptyDiagrams),
    "",
    "## Unscoped / Unresolved Nodes",
    "",
    ...renderNodeGapTypeTable(gaps.unscopedOrUnresolvedNodes),
    "",
    "## Node Preview",
    "",
    ...renderNodeGapPreviewTable(gaps.unscopedOrUnresolvedNodes),
    "",
    "## Next",
    "",
    `Continue to [Service Flow](${relative(wd.finalPages(), wd.finalPage("08-service-flow.md"))}).`,
    "",
  ];

  return lines.join("\n");
}

function renderInterpretationGuidePage(wd: AnalyzeWorkdir): string {
  const lines: string[] = [
    "# Interpretation Guide",
    "",
    "Purpose: explain what deterministic static-analysis output can support, and where uncertainty remains.",
    "",
    "## What This Report Can Prove",
    "",
    "- The bounded slice that was analyzed (entry, depth, and scoped files).",
    "- Extracted symbols and deterministic graph edges between those symbols.",
    "- Repeatable counts, diagrams, and insight checks derived from the same artifacts.",
    "",
    "## How To Read Source References",
    "",
    "- Table cells like `src/path/file.ts:42` point to the source file and line Prism grounded for that fact.",
    "- `(not grounded)` means the fact is present in the graph but has no precise file:line source in the extracted slice.",
    "- Prefer grounded rows when validating a claim or preparing a code change.",
    "",
    "## How To Read Extraction Gaps",
    "",
    "- Unresolved imports indicate specifiers Prism could not map into the analyzed scope.",
    "- Empty diagrams indicate no matching edges for that deterministic layer in this run.",
    "- Unscoped or unresolved nodes indicate referenced symbols that Prism could not fully ground inside scope.",
    `- Review [Extraction Gaps](${relative(wd.finalPages(), wd.finalPage("07-extraction-gaps.md"))}) before drawing broad architecture conclusions.`,
    "",
    "## What Not To Conclude",
    "",
    "- Do not treat missing edges as proof that runtime behavior is impossible.",
    "- Do not assume dependency safety, performance, or correctness from structure alone.",
    "- Do not infer intent for unresolved or external nodes without reading source directly.",
    "",
    "## Suggested Reading Paths",
    "",
    `- Orientation: [Entry Overview](${relative(wd.finalPages(), wd.finalPage("00-entry-overview.md"))}) -> [Route Map](${relative(wd.finalPages(), wd.finalPage("02-route-map.md"))}) -> [State Store Map](${relative(wd.finalPages(), wd.finalPage("05-state-store-map.md"))}).`,
    `- Integration risk: [Extraction Gaps](${relative(wd.finalPages(), wd.finalPage("07-extraction-gaps.md"))}) -> [Service Flow](${relative(wd.finalPages(), wd.finalPage("08-service-flow.md"))}) -> [Debug Artifacts](${relative(wd.finalPages(), wd.finalPage("09-debug-artifacts.md"))}).`,
    `- Full traceability: [Static Analysis Index](${relative(wd.finalPages(), wd.finalIndexReport())}) -> [Full deterministic report](${relative(wd.finalPages(), wd.finalReport())}) -> JSON artifacts from [Debug Artifacts](${relative(wd.finalPages(), wd.finalPage("09-debug-artifacts.md"))}).`,
    "",
  ];

  return lines.join("\n");
}

function renderDetailedReport(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
  insights: AnalyzeInsight[],
): string {
  const lines: string[] = [
    "# Static Analysis Detail",
    "",
    `Start with [index.md](${relative(wd.final(), wd.finalIndexReport())}) for the guided reading order.`,
    "",
    `Entry: \`${scope.entry}\``,
    `Depth: \`${scope.depth}\``,
    "",
    "## Scope",
    "",
    `Files analyzed: ${scope.files.length}`,
    "",
    ...scope.files.map((file) => `- \`${file.path}\` depth=${file.depth}`),
    "",
    "## Symbol Summary",
    "",
    `Symbols: ${symbols.symbols.length}`,
    "",
    "| Symbol type | Count |",
    "| --- | ---: |",
    ...countBy(symbols.symbols.map((symbol) => symbol.type)).map(
      ([type, count]) => `| \`${type}\` | ${count} |`,
    ),
    "",
    "## Graph Summary",
    "",
    `Nodes: ${graph.nodes.length}`,
    `Edges: ${graph.edges.length}`,
    "",
    "| Node type | Count |",
    "| --- | ---: |",
    ...countBy(graph.nodes.map((node) => node.type)).map(
      ([type, count]) => `| \`${type}\` | ${count} |`,
    ),
    "",
    "| Edge type | Count |",
    "| --- | ---: |",
    ...countBy(graph.edges.map((edge) => edge.type)).map(
      ([type, count]) => `| \`${type}\` | ${count} |`,
    ),
    "",
    "## Diagrams",
    "",
    ...diagrams.map(
      (diagram) =>
        `- [${diagram.title}](${relative(wd.final(), diagram.path)}) - ${diagram.edgeCount} edges`,
    ),
    "",
    "## Insights",
    "",
    ...renderInsights(insights),
    "",
    "## Extraction Gaps",
    "",
    ...renderExtractionGapBullets(scope, graph, diagrams),
    "",
    "## Artifacts",
    "",
    `- Guided index: \`${relative(wd.final(), wd.finalIndexReport())}\``,
    `- Graph: \`${relative(wd.final(), wd.graphFile())}\``,
    `- Insights: \`${relative(wd.final(), wd.insightsFile())}\``,
    `- Symbols: \`${relative(wd.final(), wd.symbolsFile())}\``,
    "",
  ];

  return lines.join("\n");
}

function renderLayerAdvice(diagramName: string, edgeCount: number): string[] {
  if (edgeCount === 0) {
    return ["No matching edges were found for this layer."];
  }

  const prefix =
    edgeCount > PREVIEW_EDGE_LIMIT
      ? `The preview shows up to ${PREVIEW_EDGE_LIMIT} representative edges from ${edgeCount} total edges.`
      : `The preview shows all ${edgeCount} edges.`;

  if (diagramName === "route-map") {
    return [
      `${prefix} Read \`selects_by\` first, then \`routes_to\`, then \`fallback_routes_to\`.`,
    ];
  }

  if (diagramName === "provider-stack") {
    return [
      `${prefix} Read from the entry component down through wrappers toward the rendered body.`,
    ];
  }

  if (diagramName === "context-boundaries") {
    return [`${prefix} Provider edges define ownership; consumer edges show reach.`];
  }

  if (diagramName === "hook-flow") {
    return [
      `${prefix} Start at components, then follow hook-to-hook or hook-to-service calls.`,
    ];
  }

  if (diagramName === "state-store-map") {
    return [
      `${prefix} Reactive subscriptions show render coupling; snapshots and mutations show imperative store coupling.`,
    ];
  }

  if (diagramName === "store-surface") {
    return [
      `${prefix} Start with state fields, then getters, then actions and their consumers.`,
    ];
  }

  return [`${prefix} Treat service edges as integration or IO boundaries.`];
}

function renderEdgePreview(
  edges: AnalyzeEdge[],
  nodes: Map<string, AnalyzeNode>,
): string[] {
  if (edges.length === 0) return ["No preview available."];

  return renderMermaid(uniquePreviewEdges(edges).slice(0, PREVIEW_EDGE_LIMIT), nodes);
}

function uniquePreviewEdges(edges: AnalyzeEdge[]): AnalyzeEdge[] {
  const seen = new Set<string>();
  const unique: AnalyzeEdge[] = [];

  for (const edge of edges) {
    const key = `${edge.type}:${edge.from}:${edge.to}:${edge.label ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(edge);
  }

  return unique;
}

function renderMermaid(edges: AnalyzeEdge[], nodes: Map<string, AnalyzeNode>): string[] {
  const lines = ["```mermaid", "flowchart TD"];
  const aliases = new Map<string, string>();
  const nodeLines = new Map<string, string>();
  const edgeLines: string[] = [];

  for (const edge of edges) {
    const from = aliasFor(edge.from, aliases);
    const to = aliasFor(edge.to, aliases);
    nodeLines.set(from, `  ${from}["${labelFor(edge.from, nodes)}"]`);
    nodeLines.set(to, `  ${to}["${labelFor(edge.to, nodes)}"]`);
    edgeLines.push(`  ${from} -->|"${edgeLabel(edge)}"| ${to}`);
  }

  lines.push(...nodeLines.values(), ...edgeLines);
  lines.push("```");
  return lines;
}

function renderTopInsights(insights: AnalyzeInsight[]): string[] {
  if (insights.length === 0) return ["No deterministic insights found."];

  return groupInsights(insights)
    .slice(0, 5)
    .map((group) => {
      const count = group.items.length;
      const suffix = count > 1 ? ` x${count}` : "";
      return `- **${group.title}**${suffix} (${group.severity}, ${group.lens}): ${group.explanation}`;
    });
}

interface InsightGroup {
  key: string;
  severity: AnalyzeInsight["severity"];
  lens: string;
  title: string;
  explanation: string;
  items: AnalyzeInsight[];
}

function groupInsights(insights: AnalyzeInsight[]): InsightGroup[] {
  const groups = new Map<string, InsightGroup>();

  for (const insight of insights) {
    const key = `${insight.severity}:${insight.lens}:${insight.title}`;
    const group = groups.get(key);
    if (group) {
      group.items.push(insight);
      continue;
    }

    groups.set(key, {
      key,
      severity: insight.severity,
      lens: insight.lens,
      title: insight.title,
      explanation: insight.explanation,
      items: [insight],
    });
  }

  return [...groups.values()].sort(
    (a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      b.items.length - a.items.length ||
      a.key.localeCompare(b.key),
  );
}

function renderInsights(insights: AnalyzeInsight[]): string[] {
  if (insights.length === 0) return ["No deterministic insights found."];

  const severityOrder = ["high", "medium", "low", "info"];
  const lines: string[] = [];
  for (const severity of severityOrder) {
    const matching = insights.filter((insight) => insight.severity === severity);
    if (matching.length === 0) continue;
    lines.push(`### ${titleCase(severity)}`, "");
    for (const insight of matching) {
      lines.push(`- **${insight.title}** (${insight.lens}, \`${insight.id}\`)`);
      lines.push(`  ${insight.explanation}`);
      if (insight.suggestion) lines.push(`  Suggestion: ${insight.suggestion}`);
    }
    lines.push("");
  }
  return lines;
}

interface ExtractionGaps {
  unresolvedImports: AnalyzeScope["unresolvedImports"];
  emptyDiagrams: AnalyzeDiagram[];
  unscopedOrUnresolvedNodes: AnalyzeNode[];
}

function collectExtractionGaps(
  scope: AnalyzeScope,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
): ExtractionGaps {
  return {
    unresolvedImports: scope.unresolvedImports,
    emptyDiagrams: diagrams.filter((item) => item.edgeCount === 0),
    unscopedOrUnresolvedNodes: graph.nodes
      .filter((node) => /\((unscoped|unresolved)\)/.test(node.name))
      .sort((a, b) => displayNodeName(a).localeCompare(displayNodeName(b))),
  };
}

function renderExtractionGapSummaryTable(gaps: ExtractionGaps): string[] {
  return [
    "| Gap type | Count |",
    "| --- | ---: |",
    `| Unresolved imports | ${gaps.unresolvedImports.length} |`,
    `| Empty diagrams | ${gaps.emptyDiagrams.length} |`,
    `| Unscoped / unresolved nodes | ${gaps.unscopedOrUnresolvedNodes.length} |`,
  ];
}

function renderUnresolvedImportsTable(
  unresolvedImports: AnalyzeScope["unresolvedImports"],
): string[] {
  if (unresolvedImports.length === 0) return ["No unresolved imports recorded in scope."];

  return [
    "| File | Line | Source | Specifier | Reason |",
    "| --- | ---: | --- | --- | --- |",
    ...unresolvedImports.map(
      (item) =>
        `| \`${item.from}\` | ${item.line} | ${formatSourceRef(item.from, item.line)} | \`${item.specifier}\` | ${item.reason} |`,
    ),
  ];
}

function renderEmptyDiagramsTable(
  wd: AnalyzeWorkdir,
  emptyDiagrams: AnalyzeDiagram[],
): string[] {
  if (emptyDiagrams.length === 0) return ["No empty diagrams found."];

  return [
    "| Diagram | Title |",
    "| --- | --- |",
    ...emptyDiagrams.map(
      (diagram) =>
        `| [\`${diagram.name}\`](${relative(wd.finalPages(), diagram.path)}) | ${diagram.title} |`,
    ),
  ];
}

function renderNodeGapTypeTable(nodes: AnalyzeNode[]): string[] {
  if (nodes.length === 0) return ["No unscoped or unresolved nodes detected."];

  return [
    "| Node type | Count |",
    "| --- | ---: |",
    ...countBy(nodes.map((node) => node.type)).map(
      ([type, count]) => `| \`${type}\` | ${count} |`,
    ),
  ];
}

function renderNodeGapPreviewTable(nodes: AnalyzeNode[]): string[] {
  if (nodes.length === 0) return ["No node gaps to preview."];

  const lines = [
    "| Node type | Name | Source |",
    "| --- | --- | --- |",
    ...nodes
      .slice(0, 25)
      .map(
        (node) =>
          `| \`${node.type}\` | \`${displayNodeName(node)}\` | ${formatSourceRef(node.file, node.line)} |`,
      ),
  ];

  if (nodes.length > 25) {
    lines.push("", `Showing first 25 of ${nodes.length} nodes.`);
  }

  return lines;
}

function renderExtractionGapBullets(
  scope: AnalyzeScope,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
): string[] {
  const gaps = collectExtractionGaps(scope, graph, diagrams);
  const lines: string[] = [];
  for (const unresolved of gaps.unresolvedImports) {
    lines.push(
      `- Unresolved import \`${unresolved.specifier}\` from \`${unresolved.from}\` line ${unresolved.line}: ${unresolved.reason}`,
    );
  }
  for (const diagram of gaps.emptyDiagrams) {
    lines.push(`- \`${diagram.name}\` has no edges.`);
  }
  for (const node of gaps.unscopedOrUnresolvedNodes.slice(0, 10)) {
    lines.push(
      `- \`${node.type}\` node \`${node.name}\` indicates extraction uncertainty.`,
    );
  }
  if (gaps.unscopedOrUnresolvedNodes.length > 10) {
    lines.push(
      `- ... ${gaps.unscopedOrUnresolvedNodes.length - 10} more unscoped/unresolved nodes listed on the Extraction Gaps page.`,
    );
  }
  if (lines.length === 0) return ["No extraction gaps detected by v0."];
  return lines;
}

function diagramAdvice(diagram: AnalyzeDiagram): string {
  if (diagram.edgeCount === 0) return "Empty: useful as an extraction gap.";
  if (diagram.name === "import-map") {
    return "Debug: usually too large; use for traversal proof.";
  }
  if (diagram.edgeCount > LARGE_DIAGRAM_EDGE_THRESHOLD) {
    return "Large: read the layered preview first.";
  }
  if (diagram.edgeCount > PREVIEW_EDGE_LIMIT) {
    return "Medium: preview page shows the first edges.";
  }
  return "Small: safe to read directly.";
}

function countBy(values: string[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const value of values) {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()].sort(([a], [b]) => a.localeCompare(b));
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

function formatSourceRef(file?: string, line?: number): string {
  if (!file) return "(not grounded)";
  const suffix = line && line > 0 ? `:${line}` : "";
  const escaped = `${file}${suffix}`.replace(/\|/g, "\\|");
  return `\`${escaped}\``;
}

function formatPreferredSourceRef(
  primaryFile?: string,
  primaryLine?: number,
  fallbackFile?: string,
  fallbackLine?: number,
): string {
  if (primaryFile) return formatSourceRef(primaryFile, primaryLine);
  return formatSourceRef(fallbackFile, fallbackLine);
}

function assignSourceRef(
  target: { sourceFile?: string; sourceLine?: number },
  file?: string,
  line?: number,
): void {
  if (!file) return;
  if (!target.sourceFile) {
    target.sourceFile = file;
    target.sourceLine = line;
    return;
  }
  const currentKey = `${target.sourceFile}:${target.sourceLine ?? 0}`;
  const nextKey = `${file}:${line ?? 0}`;
  if (nextKey.localeCompare(currentKey) < 0) {
    target.sourceFile = file;
    target.sourceLine = line;
  }
}

function edgeLabel(edge: AnalyzeEdge): string {
  return escapeMermaidLabel(edge.label ? `${edge.type}: ${edge.label}` : edge.type);
}

function escapeMermaidLabel(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

function edgeSortKey(edge: AnalyzeEdge): string {
  return `${edge.file ?? ""}:${edge.line ?? 0}:${edge.type}:${edge.from}:${edge.to}`;
}

function severityRank(severity: AnalyzeInsight["severity"]): number {
  return { high: 0, medium: 1, low: 2, info: 3 }[severity];
}

function titleCase(value: string): string {
  return `${value[0]?.toUpperCase() ?? ""}${value.slice(1)}`;
}

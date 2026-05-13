import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalyzeWorkdir } from "../src/lib/analyze-workdir.ts";
import {
  loadAnalyzeConfig,
  parseAnalyzeConfigObject,
  resolveAnalyzeInput,
} from "../src/lib/analyze-config.ts";
import { runAnalyzeDiagrams } from "../src/stages/analyze/diagrams.ts";
import { matchesGlob, parsePatternList } from "../src/stages/analyze/filters.ts";
import { runAnalyzeGraph } from "../src/stages/analyze/graph.ts";
import { runAnalyzeInsights } from "../src/stages/analyze/insights.ts";
import { runAnalyzeReport } from "../src/stages/analyze/report.ts";
import { runAnalyzeScope } from "../src/stages/analyze/scope.ts";
import { runAnalyzeSymbols } from "../src/stages/analyze/symbols.ts";

test("analyze stages produce a bounded TSX graph from an entry file", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, graph, diagrams, { force: true });
    const report = await runAnalyzeReport(wd, scope, symbols, graph, diagrams, insights, {
      force: true,
    });

    expect(scope.files.map((file) => file.path).sort()).toEqual([
      "src/app/page.tsx",
      "src/components/Chart.tsx",
      "src/components/Dashboard.tsx",
      "src/hooks/useMetrics.ts",
      "src/services/metrics.ts",
    ]);

    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "Dashboard", type: "component" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "useMetrics", type: "hook" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "fetchMetrics", type: "service" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "METRICS_ENDPOINT", type: "constant" }),
    );

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "renders",
        label: "Dashboard",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "renders",
        label: "Chart",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "uses_hook",
        label: "useMetrics",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "calls",
        label: "fetchMetrics",
      }),
    );

    expect(diagrams.map((diagram) => diagram.name).sort()).toEqual([
      "component-tree",
      "context-boundaries",
      "hook-flow",
      "import-map",
      "provider-stack",
      "route-map",
      "service-flow",
      "state-store-map",
      "store-surface",
    ]);
    await expect(readFile(wd.diagramFile("component-tree"), "utf8")).resolves.toContain(
      'component: Dashboard',
    );
    await expect(readFile(wd.diagramFile("hook-flow"), "utf8")).resolves.toContain(
      'uses_hook',
    );
    await expect(readFile(wd.diagramFile("service-flow"), "utf8")).resolves.toContain(
      'service: fetchMetrics',
    );
    expect(insights.insights).toContainEqual(
      expect.objectContaining({
        lens: "diagrams",
        title: "Diagram has no edges",
      }),
    );
    expect(report).toContain("# Static Analysis");
    expect(report).toContain("## Diagrams");
    expect(report).toContain("Component calls service directly");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze graph detects component route maps and fallback branches", async () => {
  const baseDir = await createRouteMapFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/routes/Entry.tsx", 1, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "selects_by",
        label: "VIEW_COMPONENTS[viewType]",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "routes_to",
        label: "generic",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "routes_to",
        label: "asset",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "fallback_routes_to",
        label: "comparison ? true",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "fallback_routes_to",
        label: "comparison ? false",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "wraps",
        label: "root",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "wraps",
        label: "OuterProvider",
      }),
    );
    expect(
      graph.edges.some((edge) => edge.label?.includes("CONFIG_BY_WIDGET")),
    ).toBe(false);
    expect(
      graph.edges.some((edge) => edge.label?.includes("DEFAULT_WIDGET_CONFIG")),
    ).toBe(false);

    const routeMap = diagrams.find((diagram) => diagram.name === "route-map");
    expect(routeMap?.edgeCount).toBe(5);
    await expect(readFile(wd.diagramFile("route-map"), "utf8")).resolves.toContain(
      "routes_to: generic",
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze graph detects Zustand-style store access", async () => {
  const baseDir = await createStoreFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/Entry.tsx", 1, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, graph, diagrams, { force: true });
    await runAnalyzeReport(wd, scope, symbols, graph, diagrams, insights, {
      force: true,
    });

    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "useWidgetStore", type: "store" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "uses_store",
        label: "selector: count",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "uses_store",
        label: "useZustandPerformantStore: name, setCount",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "reads_store",
        label: "getState",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "writes_store",
        label: "getState().setCount",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "store_has_state",
        label: "state",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "store_has_getter",
        label: "getter",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "store_has_action",
        label: "action",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "invokes_store_action",
        label: "setCount",
      }),
    );
    expect(
      graph.nodes.some(
        (node) => node.type === "store" && node.name.includes("useZustandPerformantStore"),
      ),
    ).toBe(false);

    const stateStoreMap = diagrams.find(
      (diagram) => diagram.name === "state-store-map",
    );
    expect(stateStoreMap?.edgeCount).toBe(4);
    await expect(readFile(wd.diagramFile("state-store-map"), "utf8")).resolves.toContain(
      "store: useWidgetStore",
    );
    const stateStorePage = await readFile(wd.finalPage("05-state-store-map.md"), "utf8");
    expect(stateStorePage).toContain("## Store Access Summary");
    expect(stateStorePage).toContain("## Reactive Reads");
    expect(stateStorePage).toContain("## Snapshot Reads");
    expect(stateStorePage).toContain("## Mutations");
    expect(stateStorePage).toContain("| Store | Source | Reactive |");
    expect(stateStorePage).toContain("| Store | Consumer | Selected / Called | Source |");
    expect(stateStorePage).toMatch(/`src\/[^`]+:\d+`/);
    expect(stateStorePage).toContain("`selector: count`");
    expect(stateStorePage).toContain("`getState().setCount`");
    const storeSurfacePage = await readFile(wd.finalPage("06-store-surface.md"), "utf8");
    expect(storeSurfacePage).toContain("## Surface Summary");
    expect(storeSurfacePage).toContain("## State Fields");
    expect(storeSurfacePage).toContain("## Getters");
    expect(storeSurfacePage).toContain("## Actions");
    expect(storeSurfacePage).toContain("## Action Consumers");
    expect(storeSurfacePage).toContain("| Store | Source | State |");
    expect(storeSurfacePage).toContain("| Store | Name | Source |");
    expect(storeSurfacePage).toContain("| Store | Action | Consumers | Source |");
    expect(storeSurfacePage).toMatch(/`src\/[^`]+:\d+`/);
    expect(storeSurfacePage).toContain("`count`");
    expect(storeSurfacePage).toContain("`setCount`");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze symbols and graph handle wrapped and default-exported components", async () => {
  const baseDir = await createWrappedComponentFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 2, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });

    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "PageShell", type: "component" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "InnerCard", type: "component" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "ForwardInput", type: "component" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "DefaultPanel", type: "component" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "DefaultMemo", type: "component" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "renders",
        label: "PageShell",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "renders",
        label: "DefaultPanel",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "renders",
        label: "DefaultMemo",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "wraps",
        label: "fragment",
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze graph captures hook orchestration through barrel exports", async () => {
  const baseDir = await createHookBarrelFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/hooks/useDashboard.ts", 2, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });

    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "useDashboard", type: "hook" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "useMetrics", type: "hook" }),
    );
    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "fetchMetricsService", type: "service" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "uses_hook",
        label: "useMetrics",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "calls",
        label: "fetchMetricsService",
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze graph captures Zustand selectors, shallow reads, and getState actions", async () => {
  const baseDir = await createStoreVariantsFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/Entry.tsx", 2, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });

    expect(symbols.symbols).toContainEqual(
      expect.objectContaining({ name: "useSessionStore", type: "store" }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "uses_store",
        label: "selector: count, setCount",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "reads_store",
        label: "getState: count, setCount",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "writes_store",
        label: "getState().setCount",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "invokes_store_action",
        label: "setCount",
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze graph captures route-map lookup with nullish fallback component", async () => {
  const baseDir = await createNullishRouteMapFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/routes/Entry.tsx", 2, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });

    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "selects_by",
        label: "ROUTE_COMPONENTS[mode]",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "routes_to",
        label: "table",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "routes_to",
        label: "chart",
      }),
    );
    expect(graph.edges).toContainEqual(
      expect.objectContaining({
        type: "fallback_routes_to",
        label: "??",
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze report stitches artifacts and skips cached output unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, graph, diagrams, { force: true });
    const first = await runAnalyzeReport(wd, scope, symbols, graph, diagrams, insights, {
      force: true,
    });

    expect(first).toContain("Files analyzed: 5");
    expect(first).toContain("Graph Summary");
    expect(first).toContain("Extraction Gaps");

    await writeFile(wd.finalReport(), "cached report");
    const cached = await runAnalyzeReport(wd, scope, symbols, graph, diagrams, insights);
    expect(cached).toBe("cached report");
    await expect(readFile(wd.finalPage("10-interpretation-guide.md"), "utf8")).resolves.toContain(
      "# Interpretation Guide",
    );

    const forced = await runAnalyzeReport(
      wd,
      scope,
      symbols,
      graph,
      diagrams.map((diagram) =>
        diagram.name === "hook-flow" ? { ...diagram, edgeCount: 99 } : diagram,
      ),
      insights,
      {
        force: true,
      },
    );
    expect(forced).toContain("# Static Analysis");
    await expect(readFile(wd.finalIndexReport(), "utf8")).resolves.toContain(
      "## Start Here",
    );
    await expect(readFile(wd.finalIndexReport(), "utf8")).resolves.toContain(
      "Large: read the layered preview first.",
    );
    await expect(readFile(wd.finalIndexReport(), "utf8")).resolves.toContain(
      "High fan-out symbol",
    );
    const indexPage = await readFile(wd.finalIndexReport(), "utf8");
    expect(indexPage).toContain("[Interpretation Guide](pages/10-interpretation-guide.md)");
    expect(indexPage).toContain("[Interpretation guide](pages/10-interpretation-guide.md)");
    await expect(
      readFile(wd.finalPage("01-entry-provider-stack.md"), "utf8"),
    ).resolves.toContain("# Entry Provider Stack");
    await expect(
      readFile(wd.finalPage("03-context-boundaries.md"), "utf8"),
    ).resolves.toContain("## Context Ownership");
    const contextBoundariesPage = await readFile(
      wd.finalPage("03-context-boundaries.md"),
      "utf8",
    );
    if (contextBoundariesPage.includes("No context ownership edges found.")) {
      expect(contextBoundariesPage).toContain("No context ownership edges found.");
    } else {
      expect(contextBoundariesPage).toContain(
        "| Context | Providers | Consumers | Source |",
      );
      expect(contextBoundariesPage).toMatch(/`src\/[^`]+:\d+`|\(not grounded\)/);
    }
    const hookFlowPage = await readFile(wd.finalPage("04-hook-flow.md"), "utf8");
    expect(hookFlowPage).toContain("## Hook Orchestration");
    if (hookFlowPage.includes("No hook orchestration edges found.")) {
      expect(hookFlowPage).toContain("No hook orchestration edges found.");
    } else {
      expect(hookFlowPage).toContain("| Hook | Category | Used by | Calls | Source |");
      expect(hookFlowPage).toMatch(/`src\/[^`]+:\d+`|\(not grounded\)/);
    }
    await expect(
      readFile(wd.finalPage("05-state-store-map.md"), "utf8"),
    ).resolves.toContain("# State Store Map");
    await expect(
      readFile(wd.finalPage("06-store-surface.md"), "utf8"),
    ).resolves.toContain("# Store Surface");
    await expect(
      readFile(wd.finalPage("07-extraction-gaps.md"), "utf8"),
    ).resolves.toContain("# Extraction Gaps");
    const extractionGapsPage = await readFile(
      wd.finalPage("07-extraction-gaps.md"),
      "utf8",
    );
    expect(extractionGapsPage).toContain("## Unresolved Imports");
    if (!extractionGapsPage.includes("No unresolved imports recorded in scope.")) {
      expect(extractionGapsPage).toContain(
        "| File | Line | Source | Specifier | Reason |",
      );
    }
    await expect(
      readFile(wd.finalPage("07-extraction-gaps.md"), "utf8"),
    ).resolves.toContain("## Empty Diagrams");
    expect(extractionGapsPage).toContain("## Unscoped / Unresolved Nodes");
    if (!extractionGapsPage.includes("No node gaps to preview.")) {
      expect(extractionGapsPage).toContain("| Node type | Name | Source |");
    }
    const serviceFlowPage = await readFile(wd.finalPage("08-service-flow.md"), "utf8");
    expect(serviceFlowPage).toContain("# Service Flow");
    expect(serviceFlowPage).toContain("## Service Calls");
    if (serviceFlowPage.includes("No service flow edges found.")) {
      expect(serviceFlowPage).toContain("No service flow edges found.");
    } else {
      expect(serviceFlowPage).toContain(
        "| Caller | Service / Target | Edge | Selected / Called | Source |",
      );
      expect(serviceFlowPage).toMatch(/`src\/[^`]+:\d+`|\(not grounded\)/);
    }
    await expect(readFile(wd.finalPage("02-route-map.md"), "utf8")).resolves.toContain(
      "## Preview",
    );
    const interpretationGuidePage = await readFile(
      wd.finalPage("10-interpretation-guide.md"),
      "utf8",
    );
    expect(interpretationGuidePage).toContain("# Interpretation Guide");
    expect(interpretationGuidePage).toContain("## What This Report Can Prove");
    expect(interpretationGuidePage).toContain("## How To Read Source References");
    expect(interpretationGuidePage).toContain("## How To Read Extraction Gaps");
    expect(interpretationGuidePage).toContain("## What Not To Conclude");
    expect(interpretationGuidePage).toContain("## Suggested Reading Paths");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze insights flag deterministic architecture issues", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, graph, diagrams, { force: true });

    expect(insights.insights).toContainEqual(
      expect.objectContaining({
        lens: "layering",
        title: "Component calls service directly",
      }),
    );
    expect(insights.insights).toContainEqual(
      expect.objectContaining({
        lens: "diagrams",
        title: "Diagram has no edges",
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze insights skip cached output unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    await runAnalyzeInsights(wd, graph, diagrams, { force: true });

    await writeFile(
      wd.insightsFile(),
      JSON.stringify({ entry: "cached", generatedFrom: "cached", insights: [] }),
    );

    const cached = await runAnalyzeInsights(wd, graph, diagrams);
    expect(cached.entry).toBe("cached");

    const forced = await runAnalyzeInsights(wd, graph, diagrams, { force: true });
    expect(forced.entry).toBe("src/app/page.tsx");
    expect(forced.insights.length).toBeGreaterThan(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze diagrams skip cached output unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    await runAnalyzeDiagrams(wd, graph, { force: true });

    await writeFile(wd.diagramFile("component-tree"), "cached diagram");
    await runAnalyzeDiagrams(wd, graph);
    await expect(readFile(wd.diagramFile("component-tree"), "utf8")).resolves.toBe(
      "cached diagram",
    );

    await runAnalyzeDiagrams(wd, graph, { force: true });
    await expect(readFile(wd.diagramFile("component-tree"), "utf8")).resolves.toContain(
      "flowchart TD",
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze scope skips cached output unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 1, baseDir);
    await wd.ensureAll();

    const first = await runAnalyzeScope(wd, { force: true });
    expect(first.files.map((file) => file.path).sort()).toEqual([
      "src/app/page.tsx",
      "src/components/Dashboard.tsx",
    ]);

    await writeFile(
      join(baseDir, "src/app/page.tsx"),
      `
import { Dashboard } from "../components/Dashboard";
import { Extra } from "../components/Extra";

export default function Page() {
  return (
    <>
      <Dashboard />
      <Extra />
    </>
  );
}
`,
    );
    await writeFile(
      join(baseDir, "src/components/Extra.tsx"),
      `
export function Extra() {
  return <aside>extra</aside>;
}
`,
    );

    const cached = await runAnalyzeScope(wd);
    expect(cached.files.map((file) => file.path).sort()).toEqual([
      "src/app/page.tsx",
      "src/components/Dashboard.tsx",
    ]);

    const forced = await runAnalyzeScope(wd, { force: true });
    expect(forced.files.map((file) => file.path).sort()).toEqual([
      "src/app/page.tsx",
      "src/components/Dashboard.tsx",
      "src/components/Extra.tsx",
    ]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze scope resolves compound sidecars and tsconfig path aliases", async () => {
  const baseDir = await createFixtureProject();
  try {
    await mkdir(join(baseDir, "src/helpers"), { recursive: true });
    await writeFile(
      join(baseDir, "tsconfig.json"),
      JSON.stringify(
        {
          compilerOptions: {
            baseUrl: "src",
            paths: {
              "helpers/*": ["helpers/*"],
            },
          },
        },
        null,
        2,
      ),
    );
    await writeFile(
      join(baseDir, "src/featureEntry.tsx"),
      `
import type { FeatureConfig } from "./featureConfig.types";
import { styles } from "./feature.styles";
import { formatTitle } from "helpers/formatTitle";

export function FeatureEntry() {
  const config: FeatureConfig = { title: formatTitle("hello") };
  return <section className={styles.root}>{config.title}</section>;
}
`,
    );
    await writeFile(
      join(baseDir, "src/featureConfig.types.ts"),
      `
export interface FeatureConfig {
  title: string;
}
`,
    );
    await writeFile(
      join(baseDir, "src/feature.styles.ts"),
      `
export const styles = {
  root: "root",
};
`,
    );
    await writeFile(
      join(baseDir, "src/helpers/formatTitle.ts"),
      `
export function formatTitle(value: string) {
  return value.toUpperCase();
}
`,
    );

    const wd = new AnalyzeWorkdir("src/featureEntry.tsx", 1, baseDir);
    await wd.ensureAll();
    const scope = await runAnalyzeScope(wd, { force: true });

    expect(scope.unresolvedImports).toEqual([]);
    expect(scope.files.map((file) => file.path).sort()).toEqual([
      "src/feature.styles.ts",
      "src/featureConfig.types.ts",
      "src/featureEntry.tsx",
      "src/helpers/formatTitle.ts",
    ]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze scope filters bound traversal with include and exclude globs", async () => {
  const baseDir = await createFixtureProject();
  try {
    await mkdir(join(baseDir, "src/feature/internal"), { recursive: true });
    await mkdir(join(baseDir, "src/feature/generated"), { recursive: true });
    await mkdir(join(baseDir, "src/outside"), { recursive: true });
    await writeFile(
      join(baseDir, "src/feature/Entry.tsx"),
      `
import { keep } from "./internal/keep";
import { skipGenerated } from "./generated/skipGenerated";
import { skipOutside } from "../outside/skipOutside";

export function Entry() {
  return <section>{keep()}{skipGenerated()}{skipOutside()}</section>;
}
`,
    );
    await writeFile(
      join(baseDir, "src/feature/internal/keep.ts"),
      `
export function keep() {
  return "keep";
}
`,
    );
    await writeFile(
      join(baseDir, "src/feature/generated/skipGenerated.ts"),
      `
export function skipGenerated() {
  return "skip";
}
`,
    );
    await writeFile(
      join(baseDir, "src/outside/skipOutside.ts"),
      `
export function skipOutside() {
  return "outside";
}
`,
    );

    const wd = new AnalyzeWorkdir("src/feature/Entry.tsx", 2, baseDir);
    await wd.ensureAll();
    const scope = await runAnalyzeScope(wd, {
      force: true,
      filters: {
        include: ["src/feature/**"],
        exclude: ["src/feature/generated/**"],
      },
    });

    expect(scope.include).toEqual(["src/feature/**"]);
    expect(scope.exclude).toEqual(["src/feature/generated/**"]);
    expect(scope.files.map((file) => file.path).sort()).toEqual([
      "src/feature/Entry.tsx",
      "src/feature/internal/keep.ts",
    ]);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze filter glob helpers parse and match expected patterns", () => {
  expect(parsePatternList("src/app/**, src/components/*.tsx ,,")).toEqual([
    "src/app/**",
    "src/components/*.tsx",
  ]);
  expect(matchesGlob("src/app/page.tsx", "src/app/**")).toBe(true);
  expect(matchesGlob("src/components/Button.tsx", "src/components/*.tsx")).toBe(true);
  expect(matchesGlob("src/components/nested/Button.tsx", "src/components/*.tsx")).toBe(
    false,
  );
});

test("analyze config object supports include/exclude as arrays or strings", () => {
  expect(
    parseAnalyzeConfigObject({
      entry: "src/app/page.tsx",
      depth: 3,
      include: ["src/app/**", "src/components/**"],
      exclude: "generated/**,dist/**",
    }),
  ).toEqual({
    entry: "src/app/page.tsx",
    depth: 3,
    include: "src/app/**,src/components/**",
    exclude: "generated/**,dist/**",
  });
});

test("analyze config resolver applies config defaults and preserves CLI overrides", () => {
  const config = parseAnalyzeConfigObject({
    entry: "src/app/page.tsx",
    depth: 3,
    include: ["src/app/**", "src/components/**"],
    exclude: ["generated/**"],
  });

  expect(resolveAnalyzeInput({}, config)).toEqual({
    entry: "src/app/page.tsx",
    depth: "3",
    include: "src/app/**,src/components/**",
    exclude: "generated/**",
  });

  expect(
    resolveAnalyzeInput(
      {
        entry: "src/override.tsx",
        depth: "1",
        include: "src/override/**",
        exclude: "src/override/generated/**",
      },
      config,
    ),
  ).toEqual({
    entry: "src/override.tsx",
    depth: "1",
    include: "src/override/**",
    exclude: "src/override/generated/**",
  });
});

test("analyze config loader fails clearly on missing or invalid config", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-config-"));
  try {
    await expect(loadAnalyzeConfig("missing.json", baseDir)).rejects.toThrow(
      "unable to read analyze config",
    );

    const malformed = join(baseDir, "malformed.json");
    await writeFile(malformed, "{");
    await expect(loadAnalyzeConfig(malformed, baseDir)).rejects.toThrow(
      "invalid analyze config JSON",
    );

    const invalidShape = join(baseDir, "invalid-shape.json");
    await writeFile(
      invalidShape,
      JSON.stringify({
        entry: "",
        depth: -1,
      }),
    );
    await expect(loadAnalyzeConfig(invalidShape, baseDir)).rejects.toThrow(
      '"entry" must be a non-empty string',
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze config object rejects unknown keys", () => {
  expect(() =>
    parseAnalyzeConfigObject({
      entry: "src/app/page.tsx",
      includes: ["src/app/**"],
    }),
  ).toThrow('unknown key "includes"');
});

async function createRouteMapFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-routes-"));
  await mkdir(join(baseDir, "src/routes"), { recursive: true });

  await writeFile(
    join(baseDir, "src/routes/Entry.tsx"),
    `
import { AssetView } from "./AssetView";
import { ComparisonView } from "./ComparisonView";
import { GenericView } from "./GenericView";
import { PortfolioView } from "./PortfolioView";

const VIEW_COMPONENTS = {
  generic: <GenericView />,
  asset: <AssetView />,
};

const DEFAULT_WIDGET_CONFIG = {
  enabled: true,
};

const CONFIG_BY_WIDGET = {
  generic: DEFAULT_WIDGET_CONFIG,
};

function OuterProvider({ children }: { children: unknown }) {
  return <>{children}</>;
}

function InnerProvider({ children }: { children: unknown }) {
  return <>{children}</>;
}

export function Shell() {
  return (
    <OuterProvider>
      <InnerProvider>
        <RoutedPanel viewType="generic" comparison={false} />
      </InnerProvider>
    </OuterProvider>
  );
}

export function RoutedPanel({
  viewType,
  comparison,
}: {
  viewType: "generic" | "asset";
  comparison: boolean;
}) {
  const view = VIEW_COMPONENTS[viewType];
  if (view) return view;
  return comparison ? <ComparisonView /> : <PortfolioView />;
}

export function getConfig(viewType: "generic") {
  return CONFIG_BY_WIDGET[viewType] ?? DEFAULT_WIDGET_CONFIG;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/GenericView.tsx"),
    `
export function GenericView() {
  return <section>generic</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/AssetView.tsx"),
    `
export function AssetView() {
  return <section>asset</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/ComparisonView.tsx"),
    `
export function ComparisonView() {
  return <section>comparison</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/PortfolioView.tsx"),
    `
export function PortfolioView() {
  return <section>portfolio</section>;
}
`,
  );

  return baseDir;
}

async function createWrappedComponentFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-wrapped-components-"));
  await mkdir(join(baseDir, "src/app"), { recursive: true });
  await mkdir(join(baseDir, "src/components"), { recursive: true });

  await writeFile(
    join(baseDir, "src/app/page.tsx"),
    `
import PageShell from "../components/PageShell";
import DefaultPanel from "../components/DefaultPanel";
import DefaultMemo from "../components/DefaultMemo";

export default function Page() {
  return (
    <>
      <PageShell />
      <DefaultPanel />
      <DefaultMemo />
    </>
  );
}
`,
  );
  await writeFile(
    join(baseDir, "src/components/PageShell.tsx"),
    `
import { memo, forwardRef } from "react";

const InnerCard = memo(function InnerCard() {
  return <section>card</section>;
});

const ForwardInput = forwardRef<HTMLInputElement, { value: string }>(function ForwardInput(
  props,
  ref,
) {
  return <input ref={ref} value={props.value} readOnly />;
});

const PageShell = memo(function PageShell() {
  return (
    <>
      <InnerCard />
      <ForwardInput value="ok" />
    </>
  );
});

export default PageShell;
`,
  );
  await writeFile(
    join(baseDir, "src/components/DefaultPanel.tsx"),
    `
export default function DefaultPanel() {
  return <aside>panel</aside>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/components/DefaultMemo.tsx"),
    `
import { memo } from "react";

export default memo(function DefaultMemo() {
  return <aside>memo</aside>;
});
`,
  );

  return baseDir;
}

async function createHookBarrelFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-hook-barrel-"));
  await mkdir(join(baseDir, "src/hooks"), { recursive: true });
  await mkdir(join(baseDir, "src/services"), { recursive: true });
  await mkdir(join(baseDir, "src/domain"), { recursive: true });

  await writeFile(
    join(baseDir, "src/hooks/useDashboard.ts"),
    `
import { fetchMetricsService, useMetrics } from "../domain";

export function useDashboard() {
  const metrics = useMetrics();
  const detail = fetchMetricsService();
  return { metrics, detail };
}
`,
  );
  await writeFile(
    join(baseDir, "src/hooks/useMetrics.ts"),
    `
export function useMetrics() {
  return { count: 1 };
}
`,
  );
  await writeFile(
    join(baseDir, "src/services/metrics.ts"),
    `
export function fetchMetricsService() {
  return { detail: "ok" };
}
`,
  );
  await writeFile(
    join(baseDir, "src/domain/index.ts"),
    `
export { useMetrics } from "../hooks/useMetrics";
export { fetchMetricsService } from "../services/metrics";
`,
  );

  return baseDir;
}

async function createStoreVariantsFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-store-variants-"));
  await mkdir(join(baseDir, "src/app"), { recursive: true });
  await mkdir(join(baseDir, "src/stores"), { recursive: true });
  await mkdir(join(baseDir, "src/lib"), { recursive: true });

  await writeFile(
    join(baseDir, "src/app/Entry.tsx"),
    `
import { shallow } from "../lib/shallow";
import { useSessionStore } from "../stores/useSessionStore";

export function Entry() {
  const selection = useSessionStore(
    (state) => ({ count: state.count, setCount: state.setCount }),
    shallow,
  );
  const { count, setCount } = useSessionStore.getState();
  useSessionStore.getState().setCount(selection.count + count);
  setCount(count + 1);
  return <section>{selection.count}</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/stores/useSessionStore.ts"),
    `
import { create } from "zustand";

interface SessionState {
  count: number;
  setCount: (count: number) => void;
}

export const useSessionStore = create<SessionState>()((set) => ({
  count: 0,
  setCount: (count) => set({ count }),
}));
`,
  );
  await writeFile(
    join(baseDir, "src/lib/shallow.ts"),
    `
export const shallow = (...values: unknown[]) => values;
`,
  );

  return baseDir;
}

async function createNullishRouteMapFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-nullish-routes-"));
  await mkdir(join(baseDir, "src/routes"), { recursive: true });

  await writeFile(
    join(baseDir, "src/routes/Entry.tsx"),
    `
import { ChartPanel } from "./ChartPanel";
import { FallbackPanel } from "./FallbackPanel";
import { TablePanel } from "./TablePanel";

const ROUTE_COMPONENTS = {
  table: <TablePanel />,
  chart: <ChartPanel />,
};

export function Entry({ mode }: { mode: "table" | "chart" | "none" }) {
  const view = ROUTE_COMPONENTS[mode] ?? <FallbackPanel />;
  return view;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/TablePanel.tsx"),
    `
export function TablePanel() {
  return <section>table</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/ChartPanel.tsx"),
    `
export function ChartPanel() {
  return <section>chart</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/routes/FallbackPanel.tsx"),
    `
export function FallbackPanel() {
  return <section>fallback</section>;
}
`,
  );

  return baseDir;
}

async function createStoreFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-store-"));
  await mkdir(join(baseDir, "src/app"), { recursive: true });
  await mkdir(join(baseDir, "src/stores"), { recursive: true });

  await writeFile(
    join(baseDir, "src/app/Entry.tsx"),
    `
import { useWidgetStore } from "../stores/useWidgetStore";
import { useZustandPerformantStore } from "../stores/useZustandPerformantStore";

export function Entry() {
  const count = useWidgetStore((state) => state.count);
  const [name] = useZustandPerformantStore({
    store: useWidgetStore,
    variables: ["name", (state) => state.setCount],
  });
  useWidgetStore.getState().setCount(count + 1);
  return <section>{name}</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/stores/useWidgetStore.ts"),
    `
import { create } from "zustand";

interface WidgetState {
  count: number;
  name: string;
  getDouble: () => number;
  setCount: (count: number) => void;
}

const createInitialState = () => ({
  count: 0,
  name: "widget",
});

export const useWidgetStore = create<WidgetState>()((set) => ({
  ...createInitialState(),
  getDouble: () => 2,
  setCount: (count) => set({ count }),
}));
`,
  );
  await writeFile(
    join(baseDir, "src/stores/useZustandPerformantStore.ts"),
    `
export function useZustandPerformantStore({
  variables,
}: {
  store: unknown;
  variables: unknown[];
}) {
  return variables;
}
`,
  );

  return baseDir;
}

async function createFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-"));
  await mkdir(join(baseDir, "src/app"), { recursive: true });
  await mkdir(join(baseDir, "src/components"), { recursive: true });
  await mkdir(join(baseDir, "src/hooks"), { recursive: true });
  await mkdir(join(baseDir, "src/services"), { recursive: true });

  await writeFile(
    join(baseDir, "src/app/page.tsx"),
    `
import { Dashboard } from "../components/Dashboard";

export default function Page() {
  return <Dashboard />;
}
`,
  );
  await writeFile(
    join(baseDir, "src/components/Dashboard.tsx"),
    `
import { Chart } from "./Chart";
import { useMetrics } from "../hooks/useMetrics";
import { fetchMetrics } from "../services/metrics";

export function Dashboard() {
  const metrics = useMetrics();
  fetchMetrics();
  return <Chart data={metrics} />;
}
`,
  );
  await writeFile(
    join(baseDir, "src/components/Chart.tsx"),
    `
export function Chart() {
  return <section>chart</section>;
}
`,
  );
  await writeFile(
    join(baseDir, "src/hooks/useMetrics.ts"),
    `
import { fetchMetrics } from "../services/metrics";

export function useMetrics() {
  return fetchMetrics();
}
`,
  );
  await writeFile(
    join(baseDir, "src/services/metrics.ts"),
    `
export const METRICS_ENDPOINT = "/api/metrics";

export async function fetchMetrics() {
  const response = await fetch(METRICS_ENDPOINT);
  return response.json();
}
`,
  );

  return baseDir;
}

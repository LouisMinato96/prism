import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AnalyzeWorkdir } from "../src/lib/analyze-workdir.ts";
import { config as prismConfig } from "../src/config.ts";
import {
  loadAnalyzeConfig,
  parseAnalyzeConfigObject,
  resolveAnalyzeInput,
} from "../src/lib/analyze-config.ts";
import {
  createAnalyzeInputDigest,
  runAnalyzeEntry,
  runAnalyzeMulti,
} from "../src/stages/analyze/run.ts";
import { runAnalyzeDiagrams } from "../src/stages/analyze/diagrams.ts";
import { matchesGlob, parsePatternList } from "../src/stages/analyze/filters.ts";
import { runAnalyzeGraph } from "../src/stages/analyze/graph.ts";
import { runAnalyzeInsights } from "../src/stages/analyze/insights.ts";
import { runAnalyzeReport } from "../src/stages/analyze/report.ts";
import { runAnalyzeRepoIndex } from "../src/stages/analyze/repo-index.ts";
import { runAnalyzeScope } from "../src/stages/analyze/scope.ts";
import { runAnalyzeSymbols } from "../src/stages/analyze/symbols.ts";
import type { AnalyzeRepoIndex } from "../src/schemas/index.ts";

test("analyze stages produce a bounded TSX graph from an entry file", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });
    const report = await runAnalyzeReport(
      wd,
      scope,
      symbols,
      repoIndex,
      graph,
      diagrams,
      insights,
      {
        force: true,
      },
    );

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
    expect(repoIndex.fileCount).toBe(5);
    expect(repoIndex.symbolCount).toBe(symbols.symbols.length);
    expect(repoIndex.files.map((file) => file.path)).toEqual([
      "src/app/page.tsx",
      "src/components/Chart.tsx",
      "src/components/Dashboard.tsx",
      "src/hooks/useMetrics.ts",
      "src/services/metrics.ts",
    ]);
    expect(repoIndex.entryFileSymbols).toEqual(
      expect.arrayContaining([expect.objectContaining({ name: "Page", type: "component" })]),
    );
    expect(repoIndex.files).toContainEqual(
      expect.objectContaining({
        path: "src/components/Dashboard.tsx",
        symbolCount: 1,
        exportedSymbols: ["Dashboard"],
      }),
    );
    expect(repoIndex.files).toContainEqual(
      expect.objectContaining({
        path: "src/services/metrics.ts",
        symbolCount: 2,
        exportedSymbols: ["METRICS_ENDPOINT", "fetchMetrics"],
      }),
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
    expect(report).toContain("# Static Analysis Detail");
    expect(await readFile(wd.finalPage("11-symbol-directory.md"), "utf8")).toContain(
      "# Symbol Directory",
    );
    expect(await readFile(wd.finalIndexReport(), "utf8")).toContain(
      "[Symbol Directory](pages/11-symbol-directory.md)",
    );
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

test("analyze repo-index summarizes files, exported symbols, and entry symbols deterministically", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });

    expect(repoIndex.typeCounts.component).toBe(3);
    expect(repoIndex.typeCounts.hook).toBe(1);
    expect(repoIndex.typeCounts.service).toBe(1);
    expect(repoIndex.generatedFrom).toEqual({
      scope: "../scope/scope.json",
      symbols: "../symbols/symbols.json",
    });
    expect(repoIndex.entryFileExportedSymbols).toEqual(["Page"]);
    expect(repoIndex.files.map((file) => file.path)).toEqual([
      "src/app/page.tsx",
      "src/components/Chart.tsx",
      "src/components/Dashboard.tsx",
      "src/hooks/useMetrics.ts",
      "src/services/metrics.ts",
    ]);
    expect(repoIndex.files[2]).toMatchObject({
      path: "src/components/Dashboard.tsx",
      symbolCount: 1,
      exportedSymbolCount: 1,
      exportedSymbols: ["Dashboard"],
    });
    expect(repoIndex.files[4]).toMatchObject({
      path: "src/services/metrics.ts",
      symbolCount: 2,
      exportedSymbols: ["METRICS_ENDPOINT", "fetchMetrics"],
    });
    await expect(readFile(wd.repoIndexFile(), "utf8")).resolves.toContain(
      '"entryFileExportedSymbols": [\n    "Page"\n  ]',
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze repo-index skips cached output unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const first = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    await writeFile(
      wd.repoIndexFile(),
      JSON.stringify(
        {
          entry: "cached",
          generatedFrom: { scope: "cached", symbols: "cached" },
          fileCount: 0,
          symbolCount: 0,
          typeCounts: {
            component: 0,
            hook: 0,
            context: 0,
            function: 0,
            constant: 0,
            store: 0,
            store_state: 0,
            store_getter: 0,
            store_action: 0,
            class: 0,
            method: 0,
            type: 0,
            service: 0,
          },
          files: [],
          entryFileSymbols: [],
          entryFileExportedSymbols: [],
        },
        null,
        2,
      ),
    );
    const cachedStat = await stat(wd.repoIndexFile());

    const cached = await runAnalyzeRepoIndex(wd, scope, symbols);
    expect(cached.entry).toBe("cached");
    expect(cached.fileCount).toBe(0);
    expect((await stat(wd.repoIndexFile())).mtimeMs).toBe(cachedStat.mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const forced = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    expect(forced.entry).toBe("src/app/page.tsx");
    expect(forced.fileCount).toBe(first.fileCount);
    expect((await stat(wd.repoIndexFile())).mtimeMs).toBeGreaterThan(cachedStat.mtimeMs);
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
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });
    await runAnalyzeReport(wd, scope, symbols, repoIndex, graph, diagrams, insights, {
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
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const first = await runAnalyzeReport(
      wd,
      scope,
      symbols,
      repoIndex,
      graph,
      diagrams,
      insights,
      {
        force: true,
      },
    );

    expect(first).toContain("Files analyzed: 5");
    expect(first).toContain("Graph Summary");
    expect(first).toContain("Extraction Gaps");
    expect(first).toContain("Repo index");

    await writeFile(wd.finalReport(), "cached report");
    const cached = await runAnalyzeReport(wd, scope, symbols, repoIndex, graph, diagrams, insights);
    expect(cached).toBe("cached report");
    await expect(readFile(wd.finalPage("10-interpretation-guide.md"), "utf8")).resolves.toContain(
      "# Interpretation Guide",
    );
    await expect(readFile(wd.finalPage("12-module-directory.md"), "utf8")).resolves.toContain(
      "# Module Directory",
    );

    const forced = await runAnalyzeReport(
      wd,
      scope,
      symbols,
      repoIndex,
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
    expect(indexPage).toContain("[Symbol Directory](pages/11-symbol-directory.md)");
    expect(indexPage).toContain("[Module Directory](pages/12-module-directory.md)");
    await expect(
      readFile(wd.finalPage("09-debug-artifacts.md"), "utf8"),
    ).resolves.toContain("Repo index");
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
    expect(interpretationGuidePage).toContain(
      "[Symbol Directory](11-symbol-directory.md) -> [Module Directory](12-module-directory.md)",
    );
    expect(interpretationGuidePage).toContain(
      "[Static Analysis Index](../index.md) -> [Symbol Directory](11-symbol-directory.md) -> [Module Directory](12-module-directory.md)",
    );
    const moduleDirectoryPage = await readFile(wd.finalPage("12-module-directory.md"), "utf8");
    expect(moduleDirectoryPage).toContain("# Module Directory");
    expect(moduleDirectoryPage).toContain("## Entry Folder Summary");
    expect(moduleDirectoryPage).toContain("## Top Parent Folders by File Count");
    expect(moduleDirectoryPage).toContain("## Top Parent Folders by Symbol Count");
    expect(moduleDirectoryPage).toContain("## Domain Folder Type Mix");
    expect(moduleDirectoryPage).toContain("## Export Density by Folder");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("symbol directory truncates dense, exported, and type previews deterministically", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });

    const paddedRepoIndex: AnalyzeRepoIndex = {
      ...repoIndex,
      fileCount: repoIndex.fileCount + 30,
      symbolCount: repoIndex.symbolCount + 30,
      typeCounts: {
        ...repoIndex.typeCounts,
        function: (repoIndex.typeCounts.function ?? 0) + 30,
      },
      files: [
        ...repoIndex.files,
        ...Array.from({ length: 30 }, (_, index) => {
          const path = `src/extra/extra-${String(index + 1).padStart(2, "0")}.ts`;
          const symbolName = `extraSymbol${index + 1}`;
          return {
            path,
            symbolCount: 1,
            exportedSymbolCount: 1,
            typeCounts: {
              component: 0,
              hook: 0,
              context: 0,
              function: 1,
              constant: 0,
              store: 0,
              store_state: 0,
              store_getter: 0,
              store_action: 0,
              class: 0,
              method: 0,
              type: 0,
              service: 0,
            },
            symbols: [
              {
                id: `extra:${index + 1}`,
                type: "function" as const,
                name: symbolName,
                line: 1,
                exported: true,
              },
            ],
            exportedSymbols: [symbolName],
          };
        }),
      ],
    };

    await runAnalyzeReport(
      wd,
      scope,
      symbols,
      paddedRepoIndex,
      graph,
      diagrams,
      insights,
      {
        force: true,
      },
    );

    const symbolDirectoryPage = await readFile(wd.finalPage("11-symbol-directory.md"), "utf8");
    const exportedSymbolCount = paddedRepoIndex.files.flatMap((file) =>
      file.symbols.filter((symbol) => symbol.exported),
    ).length;
    expect(symbolDirectoryPage).toContain("## Top Dense Files");
    expect(symbolDirectoryPage).toContain("Showing first 20 of 35 files.");
    expect(symbolDirectoryPage).toContain("## Exported Symbols");
    expect(symbolDirectoryPage).toContain(
      `Showing first 20 of ${exportedSymbolCount} exported symbols.`,
    );
    expect(symbolDirectoryPage).toContain("## Preview By Type");
    expect(symbolDirectoryPage).toContain(
      `Showing first 25 of ${paddedRepoIndex.typeCounts.function} function symbols.`,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("module directory summarizes folders and deterministic notes", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });

    const extraFiles = [
      ...Array.from({ length: 10 }, (_, index) => ({
        path: `src/app/extra-${String(index + 1).padStart(2, "0")}.ts`,
        type: index < 4 ? ("component" as const) : ("function" as const),
        exported: true,
        symbolName: `appExtra${index + 1}`,
      })),
      ...Array.from({ length: 6 }, (_, index) => ({
        path: `src/components/organisms/chartTabsV2/tab-${String(index + 1).padStart(2, "0")}.tsx`,
        type: "component" as const,
        exported: true,
        symbolName: `ChartTabs${index + 1}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        path: `src/config/config-${String(index + 1).padStart(2, "0")}.ts`,
        type: index % 2 === 0 ? ("constant" as const) : ("type" as const),
        exported: true,
        symbolName: `CONFIG_${index + 1}`,
      })),
      ...Array.from({ length: 5 }, (_, index) => ({
        path: `src/helpers/helper-${String(index + 1).padStart(2, "0")}.ts`,
        type: "function" as const,
        exported: true,
        symbolName: `helper${index + 1}`,
      })),
      ...Array.from({ length: 16 }, (_, index) => ({
        path: `src/extra/domain-${String(index + 1).padStart(2, "0")}/file.ts`,
        type: "function" as const,
        exported: true,
        symbolName: `extraDomain${index + 1}`,
      })),
    ];

    const extraTypeCounts = {
      component: 0,
      hook: 0,
      context: 0,
      function: 0,
      constant: 0,
      store: 0,
      store_state: 0,
      store_getter: 0,
      store_action: 0,
      class: 0,
      method: 0,
      type: 0,
      service: 0,
    } satisfies Record<keyof AnalyzeRepoIndex["typeCounts"], number>;
    for (const file of extraFiles) {
      extraTypeCounts[file.type] += 1;
    }

    const paddedRepoIndex: AnalyzeRepoIndex = {
      ...repoIndex,
      fileCount: repoIndex.fileCount + extraFiles.length,
      symbolCount: repoIndex.symbolCount + extraFiles.length,
      typeCounts: {
        ...repoIndex.typeCounts,
        component: (repoIndex.typeCounts.component ?? 0) + extraTypeCounts.component,
        hook: (repoIndex.typeCounts.hook ?? 0) + extraTypeCounts.hook,
        context: (repoIndex.typeCounts.context ?? 0) + extraTypeCounts.context,
        function: (repoIndex.typeCounts.function ?? 0) + extraTypeCounts.function,
        constant: (repoIndex.typeCounts.constant ?? 0) + extraTypeCounts.constant,
        store: (repoIndex.typeCounts.store ?? 0) + extraTypeCounts.store,
        store_state: (repoIndex.typeCounts.store_state ?? 0) + extraTypeCounts.store_state,
        store_getter: (repoIndex.typeCounts.store_getter ?? 0) + extraTypeCounts.store_getter,
        store_action: (repoIndex.typeCounts.store_action ?? 0) + extraTypeCounts.store_action,
        class: (repoIndex.typeCounts.class ?? 0) + extraTypeCounts.class,
        method: (repoIndex.typeCounts.method ?? 0) + extraTypeCounts.method,
        type: (repoIndex.typeCounts.type ?? 0) + extraTypeCounts.type,
        service: (repoIndex.typeCounts.service ?? 0) + extraTypeCounts.service,
      },
      files: [
        ...repoIndex.files,
        ...extraFiles.map((file, index) => ({
          path: file.path,
          symbolCount: 1,
          exportedSymbolCount: 1,
          typeCounts: {
            component: file.type === "component" ? 1 : 0,
            hook: 0,
            context: 0,
            function: file.type === "function" ? 1 : 0,
            constant: file.type === "constant" ? 1 : 0,
            store: 0,
            store_state: 0,
            store_getter: 0,
            store_action: 0,
            class: 0,
            method: 0,
            type: file.type === "type" ? 1 : 0,
            service: 0,
          },
          symbols: [
            {
              id: `extra-${index + 1}`,
              type: file.type,
              name: file.symbolName,
              line: 1,
              exported: file.exported,
            },
          ],
          exportedSymbols: [file.symbolName],
        })),
      ],
    };

    await runAnalyzeReport(
      wd,
      scope,
      symbols,
      paddedRepoIndex,
      graph,
      diagrams,
      insights,
      { force: true },
    );

    const moduleDirectoryPage = await readFile(wd.finalPage("12-module-directory.md"), "utf8");
    expect(moduleDirectoryPage).toContain("## Entry Folder Summary");
    expect(moduleDirectoryPage).toContain("## Top Parent Folders by File Count");
    expect(moduleDirectoryPage).toContain("## Top Parent Folders by Symbol Count");
    expect(moduleDirectoryPage).toContain("## Domain Folder Type Mix");
    expect(moduleDirectoryPage).toContain("## Export Density by Folder");
    expect(moduleDirectoryPage).toContain("Showing first 20 of");
    expect(moduleDirectoryPage).toContain("Entry folder `src/app` has");
    expect(moduleDirectoryPage).toContain("high symbol concentration");
    expect(moduleDirectoryPage).toContain(
      `high symbol concentration: 11 of ${paddedRepoIndex.symbolCount} symbols in this analyzed slice`,
    );
    expect(moduleDirectoryPage).toContain("component-heavy");
    expect(moduleDirectoryPage).toContain("export-heavy for constants and types");
    expect(moduleDirectoryPage).toContain("helper/function heavy");
    expect(moduleDirectoryPage).toContain("src/components/organisms/chartTabsV2");
    expect(moduleDirectoryPage).toContain("src/config");
    expect(moduleDirectoryPage).toContain("src/helpers");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("module directory groups repeated widget constants notes and caps note output", async () => {
  const baseDir = await createFixtureProject();
  try {
    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    await wd.ensureAll();

    const scope = await runAnalyzeScope(wd, { force: true });
    const symbols = await runAnalyzeSymbols(wd, scope, { force: true });
    const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, { force: true });
    const graph = await runAnalyzeGraph(wd, scope, symbols, { force: true });
    const diagrams = await runAnalyzeDiagrams(wd, graph, { force: true });
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });

    const zeroTypeCounts = {
      component: 0,
      hook: 0,
      context: 0,
      function: 0,
      constant: 0,
      store: 0,
      store_state: 0,
      store_getter: 0,
      store_action: 0,
      class: 0,
      method: 0,
      type: 0,
      service: 0,
    } satisfies Record<keyof AnalyzeRepoIndex["typeCounts"], number>;

    const componentHeavyFiles = Array.from({ length: 13 }, (_, index) => {
      const folder = `src/sections/section-${String(index + 1).padStart(2, "0")}`;
      const symbolPrefix = `Section${index + 1}`;
      return {
        path: `${folder}/index.tsx`,
        symbolCount: 3,
        exportedSymbolCount: 3,
        typeCounts: {
          ...zeroTypeCounts,
          component: 3,
        },
        symbols: Array.from({ length: 3 }, (__unused, symbolIndex) => ({
          id: `section:${index + 1}:${symbolIndex + 1}`,
          type: "component" as const,
          name: `${symbolPrefix}${symbolIndex + 1}`,
          line: symbolIndex + 1,
          exported: true,
        })),
        exportedSymbols: Array.from({ length: 3 }, (__unused, symbolIndex) =>
          `${symbolPrefix}${symbolIndex + 1}`,
        ),
      };
    });

    const widgetConstantsFiles = Array.from({ length: 15 }, (_, index) => {
      const widgetName = `widget-${String(index + 1).padStart(2, "0")}`;
      const folder = `src/widgetRegistry/widgets/${widgetName}/constants`;
      return {
        path: `${folder}/index.ts`,
        symbolCount: 4,
        exportedSymbolCount: 4,
        typeCounts: {
          ...zeroTypeCounts,
          constant: 2,
          type: 2,
        },
        symbols: [
          {
            id: `widget:${index + 1}:constant:1`,
            type: "constant" as const,
            name: `${widgetName.toUpperCase()}_A`,
            line: 1,
            exported: true,
          },
          {
            id: `widget:${index + 1}:constant:2`,
            type: "constant" as const,
            name: `${widgetName.toUpperCase()}_B`,
            line: 2,
            exported: true,
          },
          {
            id: `widget:${index + 1}:type:1`,
            type: "type" as const,
            name: `${widgetName}TypeA`,
            line: 3,
            exported: true,
          },
          {
            id: `widget:${index + 1}:type:2`,
            type: "type" as const,
            name: `${widgetName}TypeB`,
            line: 4,
            exported: true,
          },
        ],
        exportedSymbols: [
          `${widgetName.toUpperCase()}_A`,
          `${widgetName.toUpperCase()}_B`,
          `${widgetName}TypeA`,
          `${widgetName}TypeB`,
        ],
      };
    });

    const extraFiles = [...componentHeavyFiles, ...widgetConstantsFiles];
    const extraTypeCounts = extraFiles.reduce(
      (counts, file) => {
        for (const [type, count] of Object.entries(file.typeCounts)) {
          counts[type as keyof typeof counts] += count;
        }
        return counts;
      },
      { ...zeroTypeCounts },
    );

    const paddedRepoIndex: AnalyzeRepoIndex = {
      ...repoIndex,
      fileCount: repoIndex.fileCount + extraFiles.length,
      symbolCount:
        repoIndex.symbolCount +
        extraFiles.reduce((sum, file) => sum + file.symbolCount, 0),
      typeCounts: {
        ...repoIndex.typeCounts,
        component: (repoIndex.typeCounts.component ?? 0) + extraTypeCounts.component,
        hook: (repoIndex.typeCounts.hook ?? 0) + extraTypeCounts.hook,
        context: (repoIndex.typeCounts.context ?? 0) + extraTypeCounts.context,
        function: (repoIndex.typeCounts.function ?? 0) + extraTypeCounts.function,
        constant: (repoIndex.typeCounts.constant ?? 0) + extraTypeCounts.constant,
        store: (repoIndex.typeCounts.store ?? 0) + extraTypeCounts.store,
        store_state: (repoIndex.typeCounts.store_state ?? 0) + extraTypeCounts.store_state,
        store_getter: (repoIndex.typeCounts.store_getter ?? 0) + extraTypeCounts.store_getter,
        store_action: (repoIndex.typeCounts.store_action ?? 0) + extraTypeCounts.store_action,
        class: (repoIndex.typeCounts.class ?? 0) + extraTypeCounts.class,
        method: (repoIndex.typeCounts.method ?? 0) + extraTypeCounts.method,
        type: (repoIndex.typeCounts.type ?? 0) + extraTypeCounts.type,
        service: (repoIndex.typeCounts.service ?? 0) + extraTypeCounts.service,
      },
      files: [...repoIndex.files, ...extraFiles],
    };

    await runAnalyzeReport(
      wd,
      scope,
      symbols,
      paddedRepoIndex,
      graph,
      diagrams,
      insights,
      { force: true },
    );

    const moduleDirectoryPage = await readFile(wd.finalPage("12-module-directory.md"), "utf8");
    expect(moduleDirectoryPage).toContain(
      "Widget constants/types folders under `src/widgetRegistry/widgets/*/{constants,types}`",
    );
    expect(moduleDirectoryPage).toContain("15 folders");
    expect(moduleDirectoryPage).toContain("60 exported constants/types");
    expect(moduleDirectoryPage).toContain("`widget-01`, `widget-02`, `widget-03`");
    expect(moduleDirectoryPage).toContain("- ... 2 more deterministic notes");
    expect(moduleDirectoryPage.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(
      13,
    );
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
    const insights = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });

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
    await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });

    await writeFile(
      wd.insightsFile(),
      JSON.stringify({ entry: "cached", generatedFrom: "cached", insights: [] }),
    );

    const cached = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams);
    expect(cached.entry).toBe("cached");

    const forced = await runAnalyzeInsights(wd, scope, symbols, graph, diagrams, { force: true });
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
      maxFiles: 1500,
      include: ["src/app/**", "src/components/**"],
      exclude: "generated/**,dist/**",
    }),
  ).toEqual({
    entry: "src/app/page.tsx",
    depth: 3,
    maxFiles: 1500,
    include: "src/app/**,src/components/**",
    exclude: "generated/**,dist/**",
  });
});

test("analyze config object supports entries as strings and object entries", () => {
  expect(
    parseAnalyzeConfigObject({
      entries: ["src/app/page.tsx", "src/routes/Entry.tsx"],
    }),
  ).toEqual({
    entries: [
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      { path: "src/routes/Entry.tsx", name: "src-routes-entry-tsx" },
    ],
  });

  expect(
    parseAnalyzeConfigObject({
      entries: [
        { path: "src/app/page.tsx" },
        { path: "src/routes/Entry.tsx", name: "routes-entry" },
      ],
    }),
  ).toEqual({
    entries: [
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      { path: "src/routes/Entry.tsx", name: "routes-entry" },
    ],
  });
});

test("analyze config resolver applies config defaults and preserves CLI overrides", () => {
  const config = parseAnalyzeConfigObject({
    entry: "src/app/page.tsx",
    depth: 3,
    maxFiles: 2222,
    include: ["src/app/**", "src/components/**"],
    exclude: ["generated/**"],
  });

  expect(resolveAnalyzeInput({}, config)).toEqual({
    entry: "src/app/page.tsx",
    entries: [{ path: "src/app/page.tsx", name: "src-app-page-tsx" }],
    depth: "3",
    maxFiles: "2222",
    include: "src/app/**,src/components/**",
    exclude: "generated/**",
  });

  expect(
    resolveAnalyzeInput(
      {
        entry: "src/override.tsx",
        depth: "1",
        maxFiles: "19",
        include: "src/override/**",
        exclude: "src/override/generated/**",
      },
      config,
    ),
  ).toEqual({
    entry: "src/override.tsx",
    entries: [{ path: "src/override.tsx", name: "src-override-tsx" }],
    depth: "1",
    maxFiles: "19",
    include: "src/override/**",
    exclude: "src/override/generated/**",
  });
});

test("analyze config resolver uses config entries when entry override is absent", () => {
  const config = parseAnalyzeConfigObject({
    entries: ["src/app/page.tsx", { path: "src/routes/Entry.tsx", name: "route-entry" }],
    depth: 2,
  });

  expect(resolveAnalyzeInput({}, config)).toEqual({
    entry: undefined,
    entries: [
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      { path: "src/routes/Entry.tsx", name: "route-entry" },
    ],
    depth: "2",
    maxFiles: undefined,
    include: undefined,
    exclude: undefined,
  });
});

test("analyze multi orchestration writes deterministic manifest and preserves per-entry workdirs", async () => {
  const baseDir = await createFixtureProject();
  try {
    await mkdir(join(baseDir, "src/routes"), { recursive: true });
    await writeFile(
      join(baseDir, "src/routes/Entry.tsx"),
      `
import DashboardPage from "../app/page";

export function Entry() {
  return <DashboardPage />;
}
`,
    );

    const analyzeInput = resolveAnalyzeInput(
      {},
      parseAnalyzeConfigObject({
        entries: [
          { path: "src/app/page.tsx", name: "app-page" },
          { path: "src/routes/Entry.tsx", name: "route-entry" },
        ],
        depth: 2,
        include: ["src/**"],
      }),
    );

    const manifest = await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 2,
      force: { forceAll: true },
    });

    const manifestPath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      manifest.configDigest,
      "manifest.json",
    );
    const fromDisk = JSON.parse(await readFile(manifestPath, "utf8"));
    expect(fromDisk).toEqual(manifest);
    const indexPath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      manifest.configDigest,
      "index.md",
    );
    const architecturePath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      manifest.configDigest,
      "architecture.md",
    );
    const index = await readFile(indexPath, "utf8");
    const architecture = await readFile(architecturePath, "utf8");
    expect(manifest.configDigest).toBe(createAnalyzeInputDigest(analyzeInput, 2));
    expect(manifest.entries.map((entry) => entry.name)).toEqual([
      "app-page",
      "route-entry",
    ]);
    expect(manifest.entries.every((entry) => entry.status === "success")).toBe(true);
    expect(index).toContain("- entries: 2");
    expect(index).toContain("- succeeded: 2");
    expect(index).toContain("- failed: 0");
    expect(index).toContain("- depth: 2");
    expect(index).toContain("- max files: 1000");
    expect(index).toContain("- include: `src/**`");
    expect(index).toContain("| app-page | success |");
    expect(index).toContain("| route-entry | success |");
    expect(index).toContain("# Static Analysis Multi-Entry Index");
    expect(index).toContain(
      "[Open deterministic multi-entry architecture overview](architecture.md)",
    );
    expect(index).toMatch(
      /\[report\]\(\.\.\/\.\.\/src__app__page\.tsx-d2-[a-f0-9]{8}\/final\/index\.md\)/,
    );
    expect(index).toMatch(
      /\[detail\]\(\.\.\/\.\.\/src__app__page\.tsx-d2-[a-f0-9]{8}\/final\/analysis\.md\)/,
    );
    expect(index).toMatch(
      /\[repo-index\]\(\.\.\/\.\.\/src__app__page\.tsx-d2-[a-f0-9]{8}\/repo-index\/repo-index\.json\)/,
    );
    expect(index).toMatch(
      /\[graph\]\(\.\.\/\.\.\/src__routes__Entry\.tsx-d2-[a-f0-9]{8}\/graph\/graph\.json\)/,
    );
    for (const entry of manifest.entries) {
      expect(entry.workdir).toContain(`${prismConfig.workdirRoot}/analyze/`);
      expect(entry.workdir).toContain("-d2-");
      expect(entry.artifacts.scope).toContain(`${prismConfig.workdirRoot}/analyze/`);
      expect(entry.artifacts.repoIndex).toContain(`${prismConfig.workdirRoot}/analyze/`);
      expect(entry.counts).toBeDefined();
    }
    expect(architecture).toContain("# Static Analysis Multi-Entry Architecture");
    expect(architecture).toContain("- successful entries: 2");
    expect(architecture).toContain("- skipped failed entries: 0");
    expect(architecture).toContain("## Entry Cards");
    expect(architecture).toContain("- Dominant types:");
    expect(architecture).toContain("- Largest domain:");
    expect(architecture).toContain("## Relative Size");
    expect(architecture).toContain("- Symbols:");
    expect(architecture).toContain("## Entry Comparison");
    expect(architecture).toContain("| app-page | success |");
    expect(architecture).toContain("| route-entry | success |");
    expect(architecture).toContain("## Domain Groups");
    expect(architecture).toContain("## Top Modules Per Entry");
    expect(architecture).toContain("### app-page");
    expect(architecture).toContain("`src/components`");
    expect(architecture).toContain("## Shared Folder Prefixes");
    expect(architecture).toContain("`src/app`");
    expect(architecture).toContain("## Architecture Notes");
    expect(architecture).toContain("Largest analyzed slice:");
    expect(architecture).toContain("Strongest shared prefix:");
    expect(architecture).toMatch(
      /\[symbols\]\(\.\.\/\.\.\/src__app__page\.tsx-d2-[a-f0-9]{8}\/final\/pages\/11-symbol-directory\.md\)/,
    );
    expect(architecture).toMatch(
      /\[modules\]\(\.\.\/\.\.\/src__routes__Entry\.tsx-d2-[a-f0-9]{8}\/final\/pages\/12-module-directory\.md\)/,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze multi architecture filters broad shared component roots", async () => {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-analyze-multi-domains-"));
  try {
    await mkdir(join(baseDir, "src/components/alpha"), { recursive: true });
    await mkdir(join(baseDir, "src/components/beta"), { recursive: true });
    await writeFile(
      join(baseDir, "src/components/alpha/Entry.tsx"),
      `
import { AlphaPanel } from "./AlphaPanel";

export function AlphaEntry() {
  return <AlphaPanel />;
}
`,
    );
    await writeFile(
      join(baseDir, "src/components/alpha/AlphaPanel.tsx"),
      `
export function AlphaPanel() {
  return <section>alpha</section>;
}
`,
    );
    await writeFile(
      join(baseDir, "src/components/beta/Entry.tsx"),
      `
import { BetaPanel } from "./BetaPanel";

export function BetaEntry() {
  return <BetaPanel />;
}
`,
    );
    await writeFile(
      join(baseDir, "src/components/beta/BetaPanel.tsx"),
      `
export function BetaPanel() {
  return <section>beta</section>;
}
`,
    );

    const analyzeInput = resolveAnalyzeInput(
      {},
      parseAnalyzeConfigObject({
        entries: [
          { path: "src/components/alpha/Entry.tsx", name: "alpha-entry" },
          { path: "src/components/beta/Entry.tsx", name: "beta-entry" },
        ],
        depth: 1,
        include: ["src/components/**"],
      }),
    );

    const manifest = await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 1,
      force: { forceAll: true },
    });
    const architecture = await readFile(
      join(
        baseDir,
        prismConfig.workdirRoot,
        "analyze",
        "multi",
        manifest.configDigest,
        "architecture.md",
      ),
      "utf8",
    );

    expect(architecture).toContain("## Domain Groups");
    expect(architecture).toContain("`src/components/alpha`");
    expect(architecture).toContain("`src/components/beta`");
    expect(architecture).toContain(
      "No shared folder prefixes were found across successful entries.",
    );
    expect(architecture).toContain(
      "No meaningful shared folder prefix was found after filtering broad roots.",
    );
    const differentDomainsSection =
      architecture.split("## Different Domains")[1]?.split("## Architecture Notes")[0] ??
      "";
    expect(differentDomainsSection).toContain(
      "All domain groups are unique after broad-root filtering. See Domain Groups above.",
    );
    expect(differentDomainsSection).not.toContain("### alpha-entry");
    expect(differentDomainsSection).not.toContain("| `src/components/alpha` |");
    expect(architecture).not.toContain("| `src/components` |");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze multi orchestration records failures and continues entries", async () => {
  const baseDir = await createFixtureProject();
  try {
    const analyzeInput = resolveAnalyzeInput(
      {},
      parseAnalyzeConfigObject({
        entries: [
          { path: "src/missing/Nope.tsx", name: "missing-entry" },
          { path: "src/app/page.tsx", name: "app-page" },
        ],
      }),
    );

    const manifest = await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 1,
      force: { forceAll: true },
    });
    const indexPath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      manifest.configDigest,
      "index.md",
    );
    const architecturePath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      manifest.configDigest,
      "architecture.md",
    );
    const index = await readFile(indexPath, "utf8");
    const architecture = await readFile(architecturePath, "utf8");

    expect(manifest.entries.map((entry) => entry.status)).toEqual(["failed", "success"]);
    expect(manifest.entries[0]?.error).toContain("analyze entry not found");
    expect(manifest.entries[1]?.counts?.files).toBeGreaterThan(0);
    expect(index).toContain("| missing-entry | failed | - | - | - | - | - |");
    expect(index).toContain("| app-page | success |");
    expect(index).toContain("## Failures");
    expect(index).toContain("- missing-entry: analyze entry not found");
    expect(architecture).toContain("- successful entries: 1");
    expect(architecture).toContain("- skipped failed entries: 1");
    expect(architecture).toContain("| missing-entry | failed | - | - | - | - |");
    expect(architecture).toContain("| app-page | success |");
    expect(architecture).toContain("## Skipped Entries");
    expect(architecture).toContain("- missing-entry: analyze entry not found");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze multi index is not rewritten when unchanged unless forced", async () => {
  const baseDir = await createFixtureProject();
  try {
    const analyzeInput = resolveAnalyzeInput(
      {},
      parseAnalyzeConfigObject({
        entries: [{ path: "src/app/page.tsx", name: "app-page" }],
        depth: 2,
      }),
    );

    const first = await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 2,
      force: { forceAll: true },
    });
    const indexPath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      first.configDigest,
      "index.md",
    );
    const architecturePath = join(
      baseDir,
      prismConfig.workdirRoot,
      "analyze",
      "multi",
      first.configDigest,
      "architecture.md",
    );
    const firstStat = await stat(indexPath);
    const firstArchitectureStat = await stat(architecturePath);
    await new Promise((resolve) => setTimeout(resolve, 20));

    await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 2,
      force: { forceAll: false },
    });
    const secondStat = await stat(indexPath);
    const secondArchitectureStat = await stat(architecturePath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);
    expect(secondArchitectureStat.mtimeMs).toBe(firstArchitectureStat.mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 2,
      force: { forceAll: true },
    });
    const thirdStat = await stat(indexPath);
    const thirdArchitectureStat = await stat(architecturePath);
    expect(thirdStat.mtimeMs).toBeGreaterThan(secondStat.mtimeMs);
    expect(thirdArchitectureStat.mtimeMs).toBeGreaterThan(secondArchitectureStat.mtimeMs);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze single-entry runner remains backward compatible", async () => {
  const baseDir = await createFixtureProject();
  try {
    const result = await runAnalyzeEntry(
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      {
        baseDir,
        depth: 3,
        force: { forceAll: true },
      },
    );

    expect(result.counts.files).toBe(5);
    expect(result.counts.symbols).toBeGreaterThan(0);
    await expect(readFile(result.workdir.finalReport(), "utf8")).resolves.toContain(
      "# Static Analysis",
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze single-entry runner fails before symbols when scope budget exceeded", async () => {
  const baseDir = await createFixtureProject();
  try {
    await expect(
      runAnalyzeEntry(
        { path: "src/app/page.tsx", name: "src-app-page-tsx" },
        {
          baseDir,
          depth: 3,
          maxFiles: 4,
          force: { forceAll: true },
        },
      ),
    ).rejects.toThrow(
      'scope budget exceeded for "src/app/page.tsx"; scoped files: 5; max allowed: 4',
    );

    const wd = new AnalyzeWorkdir("src/app/page.tsx", 3, baseDir);
    expect(existsSync(wd.scopeFile())).toBe(true);
    expect(existsSync(wd.symbolsFile())).toBe(false);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze multi records budget failure and continues sibling entries", async () => {
  const baseDir = await createFixtureProject();
  try {
    await mkdir(join(baseDir, "src/routes"), { recursive: true });
    await writeFile(
      join(baseDir, "src/routes/Entry.tsx"),
      `
export function Entry() {
  return <section>ok</section>;
}
`,
    );

    const analyzeInput = resolveAnalyzeInput(
      {},
      parseAnalyzeConfigObject({
        entries: [
          { path: "src/app/page.tsx", name: "app-page" },
          { path: "src/routes/Entry.tsx", name: "route-entry" },
        ],
      }),
    );
    const manifest = await runAnalyzeMulti(analyzeInput, {
      baseDir,
      depth: 1,
      maxFiles: 1,
      force: { forceAll: true },
    });

    expect(manifest.entries.map((entry) => entry.status)).toEqual(["failed", "success"]);
    expect(manifest.entries[0]?.error).toContain('scope budget exceeded for "src/app/page.tsx"');
    expect(manifest.entries[1]?.counts?.files).toBe(1);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze runner uses default scope budget and honors raised maxFiles", async () => {
  const baseDir = await createFixtureProject();
  try {
    const defaultBudgetResult = await runAnalyzeEntry(
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      {
        baseDir,
        depth: 3,
        force: { forceAll: true },
      },
    );
    expect(defaultBudgetResult.counts.files).toBe(5);

    const raisedBudgetResult = await runAnalyzeEntry(
      { path: "src/app/page.tsx", name: "src-app-page-tsx" },
      {
        baseDir,
        depth: 3,
        maxFiles: 5,
        force: { forceAll: true },
      },
    );
    expect(raisedBudgetResult.counts.files).toBe(5);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
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

test("analyze config object rejects invalid entries", () => {
  expect(() =>
    parseAnalyzeConfigObject({
      entry: "src/app/page.tsx",
      entries: ["src/routes/Entry.tsx"],
    }),
  ).toThrow('"entry" and "entries" cannot both be set');

  expect(() =>
    parseAnalyzeConfigObject({
      entries: [],
    }),
  ).toThrow('"entries" cannot be empty');

  expect(() =>
    parseAnalyzeConfigObject({
      entries: "src/app/page.tsx",
    }),
  ).toThrow('"entries" must be an array');

  expect(() =>
    parseAnalyzeConfigObject({
      entries: [{}],
    }),
  ).toThrow('"entries[0].path" must be a non-empty string');

  expect(() =>
    parseAnalyzeConfigObject({
      entries: [{ path: "src/app/page.tsx", label: "app" }],
    }),
  ).toThrow('unknown key "entries[0].label"');

  expect(() =>
    parseAnalyzeConfigObject({
      entries: [{ path: "src/a.ts" }, { path: "src/b.ts", name: "src-a-ts" }],
    }),
  ).toThrow('duplicate entry name "src-a-ts"');

  expect(() =>
    parseAnalyzeConfigObject({
      entry: "src/app/page.tsx",
      maxFiles: 0,
    }),
  ).toThrow('"maxFiles" must be a positive integer');

  expect(() =>
    parseAnalyzeConfigObject({
      entry: "src/app/page.tsx",
      maxFiles: 1.5,
    }),
  ).toThrow('"maxFiles" must be a positive integer');
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

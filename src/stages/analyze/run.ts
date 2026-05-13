import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join, relative } from "node:path";
import type {
  AnalyzeConfigEntry,
  ResolvedAnalyzeInput,
} from "../../lib/analyze-config.ts";
import { config } from "../../config.ts";
import { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import { runAnalyzeDiagrams } from "./diagrams.ts";
import { parsePatternList, type AnalyzeScopeFilters } from "./filters.ts";
import { runAnalyzeGraph } from "./graph.ts";
import { runAnalyzeInsights } from "./insights.ts";
import { runAnalyzeReport } from "./report.ts";
import { runAnalyzeRepoIndex } from "./repo-index.ts";
import { runAnalyzeScope } from "./scope.ts";
import { runAnalyzeSymbols } from "./symbols.ts";

export const DEFAULT_MAX_SCOPED_FILES = 1000;

export interface AnalyzeStageForce {
  forceAll: boolean;
  forceStage?: string;
}

export interface AnalyzeEntryRunResult {
  entry: AnalyzeConfigEntry;
  workdir: AnalyzeWorkdir;
  counts: {
    files: number;
    symbols: number;
    repoIndexFiles: number;
    edges: number;
    diagrams: number;
    insights: number;
  };
}

export interface AnalyzeMultiManifestEntry {
  name: string;
  path: string;
  workdir: string;
  status: "success" | "failed";
  artifacts: {
    scope: string;
    symbols: string;
    repoIndex: string;
    graph: string;
    insights: string;
    diagramsManifest: string;
    finalIndex: string;
    finalReport: string;
  };
  counts?: {
    files: number;
    symbols: number;
    edges: number;
    diagrams: number;
    insights: number;
  };
  error?: string;
}

export interface AnalyzeMultiManifest {
  configDigest: string;
  config: {
    depth: number;
    maxFiles: number;
    include: string[];
    exclude: string[];
  };
  entries: AnalyzeMultiManifestEntry[];
}

export async function runAnalyzeEntry(
  entry: AnalyzeConfigEntry,
  options: {
    baseDir?: string;
    depth: number;
    maxFiles?: number;
    include?: string;
    exclude?: string;
    force: AnalyzeStageForce;
  },
): Promise<AnalyzeEntryRunResult> {
  const wd = new AnalyzeWorkdir(entry.path, options.depth, options.baseDir);
  await wd.ensureAll();
  const isForced = (stage: string) =>
    options.force.forceAll || options.force.forceStage === stage;
  const filters = {
    include: parsePatternList(options.include),
    exclude: parsePatternList(options.exclude),
  };
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_SCOPED_FILES;

  const scope = await runAnalyzeScope(wd, {
    force: isForced("scope"),
    filters,
  });
  assertScopeBudget(scope.files.length, maxFiles, entry.path);
  const symbols = await runAnalyzeSymbols(wd, scope, {
    force: isForced("symbols"),
  });
  const repoIndex = await runAnalyzeRepoIndex(wd, scope, symbols, {
    force: isForced("repo-index"),
  });
  const graph = await runAnalyzeGraph(wd, scope, symbols, {
    force: isForced("graph"),
  });
  const diagrams = await runAnalyzeDiagrams(wd, graph, {
    force: isForced("diagrams"),
  });
  const insights = await runAnalyzeInsights(wd, graph, diagrams, {
    force: isForced("insights"),
  });
  await runAnalyzeReport(wd, scope, symbols, repoIndex, graph, diagrams, insights, {
    force: isForced("report"),
  });

  return {
    entry,
    workdir: wd,
    counts: {
      files: scope.files.length,
      symbols: symbols.symbols.length,
      repoIndexFiles: repoIndex.fileCount,
      edges: graph.edges.length,
      diagrams: diagrams.length,
      insights: insights.insights.length,
    },
  };
}

export async function runAnalyzeMulti(
  input: ResolvedAnalyzeInput,
  options: {
    baseDir?: string;
    depth: number;
    maxFiles?: number;
    force: AnalyzeStageForce;
  },
): Promise<AnalyzeMultiManifest> {
  const baseDir = options.baseDir ?? process.cwd();
  const maxFiles = options.maxFiles ?? DEFAULT_MAX_SCOPED_FILES;
  const digest = createAnalyzeInputDigest(input, options.depth, maxFiles);
  const multiRoot = join(baseDir, config.workdirRoot, "analyze", "multi", digest);
  const manifestFile = join(multiRoot, "manifest.json");
  const indexFile = join(multiRoot, "index.md");
  await mkdir(multiRoot, { recursive: true });
  const filters = parseAnalyzeInputFilters(input);

  const entries: AnalyzeMultiManifestEntry[] = [];
  for (const entry of input.entries) {
    const wd = new AnalyzeWorkdir(entry.path, options.depth, baseDir);
    const artifacts = {
      scope: relative(baseDir, wd.scopeFile()),
      symbols: relative(baseDir, wd.symbolsFile()),
      repoIndex: relative(baseDir, wd.repoIndexFile()),
      graph: relative(baseDir, wd.graphFile()),
      insights: relative(baseDir, wd.insightsFile()),
      diagramsManifest: relative(baseDir, wd.diagramManifestFile()),
      finalIndex: relative(baseDir, wd.finalIndexReport()),
      finalReport: relative(baseDir, wd.finalReport()),
    };
    try {
      const result = await runAnalyzeEntry(entry, {
        baseDir,
        depth: options.depth,
        maxFiles,
        include: filters.include.join(","),
        exclude: filters.exclude.join(","),
        force: options.force,
      });
      entries.push({
        name: entry.name,
        path: entry.path,
        workdir: relative(baseDir, result.workdir.root),
        status: "success",
        artifacts,
        counts: result.counts,
      });
    } catch (error) {
      entries.push({
        name: entry.name,
        path: entry.path,
        workdir: relative(baseDir, wd.root),
        status: "failed",
        artifacts,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const manifest: AnalyzeMultiManifest = {
    configDigest: digest,
    config: {
      depth: options.depth,
      maxFiles,
      include: filters.include,
      exclude: filters.exclude,
    },
    entries,
  };

  await writeJsonIfChanged(manifestFile, manifest, options.force.forceAll);
  await writeTextIfChanged(
    indexFile,
    renderAnalyzeMultiIndex(manifest, multiRoot, baseDir),
    options.force.forceAll,
  );
  return manifest;
}

export function createAnalyzeInputDigest(
  input: ResolvedAnalyzeInput,
  depth: number,
  maxFiles: number = DEFAULT_MAX_SCOPED_FILES,
): string {
  const filters = parseAnalyzeInputFilters(input);
  const canonical = {
    depth,
    maxFiles,
    include: filters.include,
    exclude: filters.exclude,
    entries: input.entries.map((entry) => ({ name: entry.name, path: entry.path })),
  };
  return createHash("sha1").update(JSON.stringify(canonical)).digest("hex").slice(0, 12);
}

function parseAnalyzeInputFilters(input: ResolvedAnalyzeInput): AnalyzeScopeFilters {
  return {
    include: parsePatternList(input.include),
    exclude: parsePatternList(input.exclude),
  };
}

async function writeJsonIfChanged(
  path: string,
  value: unknown,
  force: boolean,
): Promise<void> {
  const next = `${JSON.stringify(value, null, 2)}\n`;
  if (!force && existsSync(path)) {
    const current = await readFile(path, "utf8");
    if (current === next) return;
  }
  await writeFile(path, next);
}

async function writeTextIfChanged(
  path: string,
  content: string,
  force: boolean,
): Promise<void> {
  if (!force && existsSync(path)) {
    const current = await readFile(path, "utf8");
    if (current === content) return;
  }
  await writeFile(path, content);
}

function renderAnalyzeMultiIndex(
  manifest: AnalyzeMultiManifest,
  multiRoot: string,
  baseDir: string,
): string {
  const succeeded = manifest.entries.filter((entry) => entry.status === "success").length;
  const failed = manifest.entries.length - succeeded;
  const includeText = manifest.config.include.join(", ");
  const excludeText = manifest.config.exclude.join(", ");
  const lines: string[] = [];
  lines.push("# Static Analysis Multi-Entry Index");
  lines.push("");
  lines.push(`- config digest: \`${manifest.configDigest}\``);
  lines.push(`- entries: ${manifest.entries.length}`);
  lines.push(`- succeeded: ${succeeded}`);
  lines.push(`- failed: ${failed}`);
  lines.push(`- depth: ${manifest.config.depth}`);
  lines.push(`- max files: ${manifest.config.maxFiles}`);
  if (includeText.length > 0) lines.push(`- include: \`${includeText}\``);
  if (excludeText.length > 0) lines.push(`- exclude: \`${excludeText}\``);
  lines.push("");
  lines.push(
    "| Entry | Status | Files | Symbols | Edges | Diagrams | Insights | Report | Artifacts |",
  );
  lines.push("| --- | --- | ---: | ---: | ---: | ---: | ---: | --- | --- |");
  for (const entry of manifest.entries) {
    const counts = entry.counts;
    const reportLink = toIndexRelativeLink(
      entry.artifacts.finalIndex,
      multiRoot,
      baseDir,
    );
    const artifacts = [
      `[detail](${toIndexRelativeLink(entry.artifacts.finalReport, multiRoot, baseDir)})`,
      `[repo-index](${toIndexRelativeLink(entry.artifacts.repoIndex, multiRoot, baseDir)})`,
      `[graph](${toIndexRelativeLink(entry.artifacts.graph, multiRoot, baseDir)})`,
      `[insights](${toIndexRelativeLink(entry.artifacts.insights, multiRoot, baseDir)})`,
      `[diagrams](${toIndexRelativeLink(entry.artifacts.diagramsManifest, multiRoot, baseDir)})`,
      `[scope](${toIndexRelativeLink(entry.artifacts.scope, multiRoot, baseDir)})`,
      `[symbols](${toIndexRelativeLink(entry.artifacts.symbols, multiRoot, baseDir)})`,
    ].join(" ");
    lines.push(
      `| ${markdownTableCell(entry.name)} | ${entry.status} | ${counts?.files ?? "-"} | ${counts?.symbols ?? "-"} | ${counts?.edges ?? "-"} | ${counts?.diagrams ?? "-"} | ${counts?.insights ?? "-"} | [report](${reportLink}) | ${artifacts} |`,
    );
  }
  if (failed > 0) {
    lines.push("");
    lines.push("## Failures");
    lines.push("");
    for (const entry of manifest.entries) {
      if (entry.status !== "failed") continue;
      lines.push(
        `- ${plainMarkdownText(entry.name)}: ${plainMarkdownText(entry.error ?? "unknown error")}`,
      );
    }
  }
  lines.push("");
  return `${lines.join("\n")}\n`;
}

function toIndexRelativeLink(
  artifactPath: string,
  multiRoot: string,
  baseDir: string,
): string {
  return relative(multiRoot, join(baseDir, artifactPath));
}

function markdownTableCell(value: string): string {
  return plainMarkdownText(value).replace(/\|/g, "\\|");
}

function plainMarkdownText(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function assertScopeBudget(fileCount: number, maxFiles: number, entryPath: string): void {
  if (fileCount <= maxFiles) return;
  throw new Error(
    [
      `scope budget exceeded for "${entryPath}"`,
      `scoped files: ${fileCount}`,
      `max allowed: ${maxFiles}`,
      "adjust include filters, reduce traversal depth, or raise maxFiles.",
    ].join("; "),
  );
}

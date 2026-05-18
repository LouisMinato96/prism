import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative } from "node:path";
import type {
  AnalyzeConfigEntry,
  ResolvedAnalyzeInput,
} from "../../lib/analyze-config.ts";
import { config } from "../../config.ts";
import {
  AnalyzeRepoIndexSchema,
  type AnalyzeRepoIndex,
  type AnalyzeRepoIndexFile,
  type AnalyzeRepoIndexSymbolType,
} from "../../schemas/index.ts";
import { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import { runAnalyzeDiagrams } from "./diagrams.ts";
import { parsePatternList, type AnalyzeScopeFilters } from "./filters.ts";
import { runAnalyzeGraph } from "./graph.ts";
import { runAnalyzeInsights } from "./insights.ts";
import { runAnalyzeReport } from "./report.ts";
import { ANALYZE_REPO_INDEX_TYPES, runAnalyzeRepoIndex } from "./repo-index.ts";
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
  const architectureFile = join(multiRoot, "architecture.md");
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
  const architecture = await loadAnalyzeMultiArchitecture(manifest, baseDir);
  await writeTextIfChanged(
    architectureFile,
    renderAnalyzeMultiArchitecture(manifest, architecture, multiRoot, baseDir),
    options.force.forceAll,
  );
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
  lines.push("## Architecture Overview");
  lines.push("");
  lines.push("[Open deterministic multi-entry architecture overview](architecture.md).");
  lines.push("");
  lines.push("## Entries");
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

interface AnalyzeMultiArchitectureEntry {
  entry: AnalyzeMultiManifestEntry;
  repoIndex: AnalyzeRepoIndex;
  folders: AnalyzeMultiFolderSummary[];
  domains: AnalyzeMultiFolderSummary[];
}

interface AnalyzeMultiFolderSummary {
  folder: string;
  files: number;
  symbols: number;
  exportedSymbols: number;
  typeCounts: Record<AnalyzeRepoIndexSymbolType, number>;
}

interface AnalyzeMultiSharedPrefixSummary {
  prefix: string;
  entries: string[];
  files: number;
  symbols: number;
}

async function loadAnalyzeMultiArchitecture(
  manifest: AnalyzeMultiManifest,
  baseDir: string,
): Promise<AnalyzeMultiArchitectureEntry[]> {
  const entries: AnalyzeMultiArchitectureEntry[] = [];

  for (const entry of manifest.entries) {
    if (entry.status !== "success") continue;

    const repoIndex = await loadAnalyzeMultiRepoIndex(entry, baseDir);
    entries.push({
      entry,
      repoIndex,
      folders: buildAnalyzeMultiFolderSummaries(repoIndex),
      domains: buildAnalyzeMultiDomainSummaries(repoIndex),
    });
  }

  return entries;
}

async function loadAnalyzeMultiRepoIndex(
  entry: AnalyzeMultiManifestEntry,
  baseDir: string,
): Promise<AnalyzeRepoIndex> {
  const artifactPath = join(baseDir, entry.artifacts.repoIndex);

  try {
    const parsedJson = JSON.parse(await readFile(artifactPath, "utf8"));
    const parsed = AnalyzeRepoIndexSchema.safeParse(parsedJson);
    if (!parsed.success) {
      const details = parsed.error.issues
        .map((issue) => issue.path.join(".") || issue.message)
        .join(", ");
      throw new Error(`invalid schema: ${details}`);
    }
    return parsed.data;
  } catch (error) {
    throw new Error(
      `failed to load repo-index artifact for "${entry.name}" at ${entry.artifacts.repoIndex}: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
}

function renderAnalyzeMultiArchitecture(
  manifest: AnalyzeMultiManifest,
  entries: AnalyzeMultiArchitectureEntry[],
  multiRoot: string,
  baseDir: string,
): string {
  const skippedEntries = manifest.entries.filter((entry) => entry.status !== "success");
  const sharedPrefixes = buildAnalyzeMultiSharedPrefixSummaries(entries).slice(0, 20);
  const uniqueFolders = buildAnalyzeMultiUniqueFolderSummaries(entries);
  const hasSharedDomains = hasAnalyzeMultiSharedDomains(entries);
  const lines: string[] = [
    "# Static Analysis Multi-Entry Architecture",
    "",
    "Purpose: deterministic aggregate view over successful entry repo indexes. This page does not merge per-entry graphs or infer architecture with an LLM.",
    "",
    "## Scope Summary",
    "",
    `- config digest: \`${manifest.configDigest}\``,
    `- entries: ${manifest.entries.length}`,
    `- successful entries: ${entries.length}`,
    `- skipped failed entries: ${skippedEntries.length}`,
    `- depth: ${manifest.config.depth}`,
    `- max files: ${manifest.config.maxFiles}`,
    "",
    "## Entry Cards",
    "",
    ...renderAnalyzeMultiEntryCards(entries, multiRoot, baseDir),
    "",
    "## Relative Size",
    "",
    ...renderAnalyzeMultiRelativeSize(entries),
    "",
    "## Entry Comparison",
    "",
    ...renderAnalyzeMultiEntryComparisonTable(manifest, multiRoot, baseDir),
    "",
    "## Domain Groups",
    "",
  ];

  if (entries.length === 0) {
    lines.push("No successful entries were available for domain summarization.");
  } else {
    for (const entry of entries) {
      lines.push(`### ${plainMarkdownText(entry.entry.name)}`);
      lines.push("");
      lines.push(...renderAnalyzeMultiFolderSummaryTable(entry.domains.slice(0, 8)));
      lines.push("");
    }
  }

  lines.push("## Top Modules Per Entry", "");

  if (entries.length === 0) {
    lines.push("No successful entries were available for architecture summarization.");
  } else {
    for (const entry of entries) {
      lines.push(`### ${plainMarkdownText(entry.entry.name)}`);
      lines.push("");
      lines.push(...renderAnalyzeMultiFolderSummaryTable(entry.folders.slice(0, 8)));
      lines.push("");
    }
  }

  lines.push("## Shared Folder Prefixes");
  lines.push("");
  lines.push(
    "Prefixes are computed from successful entry repo-index files at folder depth 2-4. Broad roots such as `src/components` are filtered out.",
  );
  lines.push("");
  lines.push(...renderAnalyzeMultiSharedPrefixTable(sharedPrefixes));
  lines.push("");
  lines.push("## Different Domains");
  lines.push("");
  if (entries.length === 0) {
    lines.push("No successful entries were available for unique-domain summarization.");
    lines.push("");
  } else if (!hasSharedDomains) {
    lines.push(
      "All domain groups are unique after broad-root filtering. See Domain Groups above.",
    );
    lines.push("");
  } else {
    for (const entry of entries) {
      const folders = uniqueFolders.get(entry.entry.name) ?? [];
      lines.push(`### ${plainMarkdownText(entry.entry.name)}`);
      lines.push("");
      lines.push(...renderAnalyzeMultiFolderSummaryTable(folders.slice(0, 8)));
      lines.push("");
    }
  }

  if (skippedEntries.length > 0) {
    lines.push("## Skipped Entries");
    lines.push("");
    for (const entry of skippedEntries) {
      lines.push(
        `- ${plainMarkdownText(entry.name)}: ${plainMarkdownText(entry.error ?? "unknown error")}`,
      );
    }
    lines.push("");
  }

  lines.push("## Architecture Notes");
  lines.push("");
  lines.push(...renderAnalyzeMultiArchitectureNotes(entries, sharedPrefixes));
  lines.push("");
  lines.push("## Reading Path");
  lines.push("");
  lines.push(...renderAnalyzeMultiReadingPathTable(entries, multiRoot, baseDir));
  lines.push("");
  lines.push("## Notes");
  lines.push("");
  lines.push("- This page is derived from existing disk artifacts only.");
  lines.push("- Failed entries are skipped here and remain visible in the multi index.");
  lines.push(
    "- Shared prefixes indicate overlapping folder ownership, not confirmed runtime coupling.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
}

function renderAnalyzeMultiEntryComparisonTable(
  manifest: AnalyzeMultiManifest,
  multiRoot: string,
  baseDir: string,
): string[] {
  const rows = [
    "| Entry | Status | Files | Symbols | Edges | Insights | Entry File | Report |",
    "| --- | --- | ---: | ---: | ---: | ---: | --- | --- |",
  ];

  for (const entry of manifest.entries) {
    const reportLink =
      entry.status === "success"
        ? `[report](${toIndexRelativeLink(entry.artifacts.finalIndex, multiRoot, baseDir)})`
        : "-";
    rows.push(
      `| ${markdownTableCell(entry.name)} | ${entry.status} | ${entry.counts?.files ?? "-"} | ${entry.counts?.symbols ?? "-"} | ${entry.counts?.edges ?? "-"} | ${entry.counts?.insights ?? "-"} | \`${markdownTableCell(entry.path)}\` | ${reportLink} |`,
    );
  }

  return rows;
}

function renderAnalyzeMultiEntryCards(
  entries: AnalyzeMultiArchitectureEntry[],
  multiRoot: string,
  baseDir: string,
): string[] {
  if (entries.length === 0) return ["No successful entries were available."];

  const lines: string[] = [];
  for (const entry of entries) {
    const largestDomain = entry.domains[0];
    const largestModule = entry.folders[0];
    lines.push(`### ${plainMarkdownText(entry.entry.name)}`);
    lines.push("");
    lines.push(
      `- Scope: ${entry.repoIndex.fileCount} files, ${entry.repoIndex.symbolCount} symbols, ${entry.entry.counts?.edges ?? 0} edges, ${entry.entry.counts?.insights ?? 0} insights.`,
    );
    lines.push(
      `- Dominant types: ${formatAnalyzeMultiDominantTypes(entry.repoIndex.typeCounts)}.`,
    );
    lines.push(`- Largest domain: ${formatAnalyzeMultiSummaryReference(largestDomain)}.`);
    lines.push(`- Largest module: ${formatAnalyzeMultiSummaryReference(largestModule)}.`);
    lines.push(
      `- Links: [report](${toIndexRelativeLink(entry.entry.artifacts.finalIndex, multiRoot, baseDir)}) [modules](${toIndexRelativeLink(join(dirname(entry.entry.artifacts.finalIndex), "pages", "12-module-directory.md"), multiRoot, baseDir)}) [repo-index](${toIndexRelativeLink(entry.entry.artifacts.repoIndex, multiRoot, baseDir)}).`,
    );
    lines.push("");
  }

  return lines;
}

function renderAnalyzeMultiRelativeSize(
  entries: AnalyzeMultiArchitectureEntry[],
): string[] {
  if (entries.length < 2)
    return ["At least two successful entries are needed for relative-size comparison."];

  const bySymbols = entries
    .slice()
    .sort(
      (a, b) =>
        b.repoIndex.symbolCount - a.repoIndex.symbolCount ||
        a.entry.name.localeCompare(b.entry.name),
    );
  const byFiles = entries
    .slice()
    .sort(
      (a, b) =>
        b.repoIndex.fileCount - a.repoIndex.fileCount ||
        a.entry.name.localeCompare(b.entry.name),
    );
  const byEdges = entries
    .slice()
    .sort(
      (a, b) =>
        (b.entry.counts?.edges ?? 0) - (a.entry.counts?.edges ?? 0) ||
        a.entry.name.localeCompare(b.entry.name),
    );
  const largestSymbols = bySymbols[0];
  const smallestSymbols = bySymbols[bySymbols.length - 1];
  const largestFiles = byFiles[0];
  const smallestFiles = byFiles[byFiles.length - 1];
  const largestEdges = byEdges[0];
  const smallestEdges = byEdges[byEdges.length - 1];

  return [
    `- Symbols: ${plainMarkdownText(largestSymbols.entry.name)} has ${formatAnalyzeMultiRatio(largestSymbols.repoIndex.symbolCount, smallestSymbols.repoIndex.symbolCount)} the symbols of ${plainMarkdownText(smallestSymbols.entry.name)}.`,
    `- Files: ${plainMarkdownText(largestFiles.entry.name)} has ${formatAnalyzeMultiRatio(largestFiles.repoIndex.fileCount, smallestFiles.repoIndex.fileCount)} the files of ${plainMarkdownText(smallestFiles.entry.name)}.`,
    `- Edges: ${plainMarkdownText(largestEdges.entry.name)} has ${formatAnalyzeMultiRatio(largestEdges.entry.counts?.edges ?? 0, smallestEdges.entry.counts?.edges ?? 0)} the edges of ${plainMarkdownText(smallestEdges.entry.name)}.`,
  ];
}

function buildAnalyzeMultiFolderSummaries(
  repoIndex: AnalyzeRepoIndex,
): AnalyzeMultiFolderSummary[] {
  const folders = new Map<string, AnalyzeMultiFolderSummary>();

  for (const file of repoIndex.files) {
    const folderName = analyzeMultiParentFolder(file.path);
    const summary = upsertAnalyzeMultiFolderSummary(folders, folderName);
    incrementAnalyzeMultiFolderSummary(summary, file);
  }

  return [...folders.values()].sort(compareAnalyzeMultiFolderSummaries);
}

function buildAnalyzeMultiDomainSummaries(
  repoIndex: AnalyzeRepoIndex,
): AnalyzeMultiFolderSummary[] {
  const domains = new Map<string, AnalyzeMultiFolderSummary>();

  for (const file of repoIndex.files) {
    const domainName = analyzeMultiDomainPath(file.path);
    const summary = upsertAnalyzeMultiFolderSummary(domains, domainName);
    incrementAnalyzeMultiFolderSummary(summary, file);
  }

  return [...domains.values()].sort(compareAnalyzeMultiFolderSummaries);
}

function upsertAnalyzeMultiFolderSummary(
  folders: Map<string, AnalyzeMultiFolderSummary>,
  folder: string,
): AnalyzeMultiFolderSummary {
  const existing = folders.get(folder);
  if (existing) return existing;

  const summary = {
    folder,
    files: 0,
    symbols: 0,
    exportedSymbols: 0,
    typeCounts: Object.fromEntries(
      ANALYZE_REPO_INDEX_TYPES.map((type) => [type, 0]),
    ) as Record<AnalyzeRepoIndexSymbolType, number>,
  };
  folders.set(folder, summary);
  return summary;
}

function incrementAnalyzeMultiFolderSummary(
  summary: AnalyzeMultiFolderSummary,
  file: AnalyzeRepoIndexFile,
): void {
  summary.files += 1;
  summary.symbols += file.symbolCount;
  summary.exportedSymbols += file.exportedSymbolCount;
  for (const type of ANALYZE_REPO_INDEX_TYPES) {
    summary.typeCounts[type] += file.typeCounts[type] ?? 0;
  }
}

function renderAnalyzeMultiFolderSummaryTable(
  folders: AnalyzeMultiFolderSummary[],
): string[] {
  if (folders.length === 0) return ["No folders found."];

  return [
    "| Folder | Files | Symbols | Exported Symbols | Type mix |",
    "| --- | ---: | ---: | ---: | --- |",
    ...folders.map(
      (folder) =>
        `| \`${markdownTableCell(folder.folder)}\` | ${folder.files} | ${folder.symbols} | ${folder.exportedSymbols} | ${formatAnalyzeMultiTypeMix(folder.typeCounts)} |`,
    ),
  ];
}

function buildAnalyzeMultiSharedPrefixSummaries(
  entries: AnalyzeMultiArchitectureEntry[],
): AnalyzeMultiSharedPrefixSummary[] {
  const prefixes = new Map<
    string,
    { entries: Set<string>; files: number; symbols: number }
  >();

  for (const entry of entries) {
    for (const file of entry.repoIndex.files) {
      for (const prefix of analyzeMultiFolderPrefixes(file.path)) {
        if (isAnalyzeMultiBroadSharedPrefix(prefix)) continue;
        const summary = prefixes.get(prefix) ?? {
          entries: new Set<string>(),
          files: 0,
          symbols: 0,
        };
        summary.entries.add(entry.entry.name);
        summary.files += 1;
        summary.symbols += file.symbolCount;
        prefixes.set(prefix, summary);
      }
    }
  }

  return [...prefixes.entries()]
    .flatMap(([prefix, summary]) =>
      summary.entries.size > 1
        ? [
            {
              prefix,
              entries: [...summary.entries].sort(),
              files: summary.files,
              symbols: summary.symbols,
            },
          ]
        : [],
    )
    .sort(compareAnalyzeMultiSharedPrefixSummaries);
}

function renderAnalyzeMultiSharedPrefixTable(
  prefixes: AnalyzeMultiSharedPrefixSummary[],
): string[] {
  if (prefixes.length === 0)
    return ["No shared folder prefixes were found across successful entries."];

  return [
    "| Prefix | Entries | Files | Symbols |",
    "| --- | --- | ---: | ---: |",
    ...prefixes.map(
      (prefix) =>
        `| \`${markdownTableCell(prefix.prefix)}\` | ${markdownTableCell(prefix.entries.join(", "))} | ${prefix.files} | ${prefix.symbols} |`,
    ),
  ];
}

function buildAnalyzeMultiUniqueFolderSummaries(
  entries: AnalyzeMultiArchitectureEntry[],
): Map<string, AnalyzeMultiFolderSummary[]> {
  const folderOwners = new Map<string, Set<string>>();
  const uniqueFolders = new Map<string, AnalyzeMultiFolderSummary[]>();

  for (const entry of entries) {
    for (const folder of entry.domains) {
      const owners = folderOwners.get(folder.folder) ?? new Set<string>();
      owners.add(entry.entry.name);
      folderOwners.set(folder.folder, owners);
    }
  }

  for (const entry of entries) {
    uniqueFolders.set(
      entry.entry.name,
      entry.domains
        .filter((folder) => folderOwners.get(folder.folder)?.size === 1)
        .sort(compareAnalyzeMultiFolderSummaries),
    );
  }

  return uniqueFolders;
}

function hasAnalyzeMultiSharedDomains(entries: AnalyzeMultiArchitectureEntry[]): boolean {
  const folderOwners = new Map<string, Set<string>>();

  for (const entry of entries) {
    for (const folder of entry.domains) {
      const owners = folderOwners.get(folder.folder) ?? new Set<string>();
      owners.add(entry.entry.name);
      folderOwners.set(folder.folder, owners);
    }
  }

  return [...folderOwners.values()].some((owners) => owners.size > 1);
}

function renderAnalyzeMultiReadingPathTable(
  entries: AnalyzeMultiArchitectureEntry[],
  multiRoot: string,
  baseDir: string,
): string[] {
  if (entries.length === 0) return ["No successful entries were available."];

  return [
    "| Entry | Start | Symbol Directory | Module Directory | Repo Index |",
    "| --- | --- | --- | --- | --- |",
    ...entries.map((entry) => {
      const finalDir = dirname(entry.entry.artifacts.finalIndex);
      return `| ${markdownTableCell(entry.entry.name)} | [report](${toIndexRelativeLink(entry.entry.artifacts.finalIndex, multiRoot, baseDir)}) | [symbols](${toIndexRelativeLink(join(finalDir, "pages", "11-symbol-directory.md"), multiRoot, baseDir)}) | [modules](${toIndexRelativeLink(join(finalDir, "pages", "12-module-directory.md"), multiRoot, baseDir)}) | [repo-index](${toIndexRelativeLink(entry.entry.artifacts.repoIndex, multiRoot, baseDir)}) |`;
    }),
  ];
}

function renderAnalyzeMultiArchitectureNotes(
  entries: AnalyzeMultiArchitectureEntry[],
  sharedPrefixes: AnalyzeMultiSharedPrefixSummary[],
): string[] {
  if (entries.length === 0) return ["- No successful entries were available."];

  const bySymbols = entries
    .slice()
    .sort(
      (a, b) =>
        b.repoIndex.symbolCount - a.repoIndex.symbolCount ||
        a.entry.name.localeCompare(b.entry.name),
    );
  const notes: string[] = [];
  const largest = bySymbols[0];

  notes.push(
    `- Largest analyzed slice: ${plainMarkdownText(largest.entry.name)} with ${largest.repoIndex.symbolCount} symbols across ${largest.repoIndex.fileCount} files.`,
  );
  if (entries.length > 1 && sharedPrefixes.length === 0) {
    notes.push(
      "- No meaningful shared folder prefix was found after filtering broad roots.",
    );
  } else if (sharedPrefixes.length > 0) {
    const strongest = sharedPrefixes[0];
    notes.push(
      `- Strongest shared prefix: \`${markdownTableCell(strongest.prefix)}\` across ${strongest.entries.length} entries, ${strongest.files} files, and ${strongest.symbols} symbols.`,
    );
  }

  for (const entry of entries
    .slice()
    .sort((a, b) => a.entry.name.localeCompare(b.entry.name))) {
    const largestModule = entry.folders[0];
    if (!largestModule) continue;
    notes.push(
      `- ${plainMarkdownText(entry.entry.name)} largest module by symbols: \`${markdownTableCell(largestModule.folder)}\` (${largestModule.symbols} symbols).`,
    );
  }

  return notes;
}

function analyzeMultiParentFolder(path: string): string {
  const normalized = path.replace(/\\/g, "/");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return ".";
  return normalized.slice(0, index);
}

function analyzeMultiDomainPath(path: string): string {
  const parent = analyzeMultiParentFolder(path);
  if (parent === ".") return ".";

  const parts = parent.split("/").filter(Boolean);
  if (parts[0] !== "src") return parts.slice(0, Math.min(parts.length, 2)).join("/");

  if (parts[1] === "components") {
    if (isAnalyzeMultiComponentBucket(parts[2]) && parts[3]) {
      return parts.slice(0, 4).join("/");
    }
    return parts.slice(0, Math.min(parts.length, 3)).join("/");
  }

  if (isAnalyzeMultiDomainRoot(parts[1]) && parts[2]) {
    return parts.slice(0, 3).join("/");
  }

  return parts.slice(0, Math.min(parts.length, 2)).join("/");
}

function analyzeMultiFolderPrefixes(path: string): string[] {
  const parent = analyzeMultiParentFolder(path);
  if (parent === ".") return [];

  const parts = parent.split("/").filter(Boolean);
  const prefixes: string[] = [];
  for (let length = 2; length <= Math.min(parts.length, 4); length += 1) {
    prefixes.push(parts.slice(0, length).join("/"));
  }
  return prefixes;
}

function isAnalyzeMultiComponentBucket(value: string | undefined): boolean {
  return new Set(["atoms", "molecules", "organisms", "templates", "pages"]).has(
    value ?? "",
  );
}

function isAnalyzeMultiDomainRoot(value: string | undefined): boolean {
  return new Set([
    "contexts",
    "helpers",
    "hooks",
    "services",
    "stores",
    "types",
    "zustandStore",
  ]).has(value ?? "");
}

function isAnalyzeMultiBroadSharedPrefix(prefix: string): boolean {
  return new Set([
    "src/components",
    "src/components/atoms",
    "src/components/molecules",
    "src/components/organisms",
    "src/components/pages",
    "src/components/templates",
    "src/contexts",
    "src/helpers",
    "src/hooks",
    "src/services",
    "src/stores",
    "src/types",
    "src/zustandStore",
  ]).has(prefix);
}

function formatAnalyzeMultiTypeMix(
  typeCounts: Record<AnalyzeRepoIndexSymbolType, number>,
): string {
  const parts = ANALYZE_REPO_INDEX_TYPES.flatMap((type) => {
    const count = typeCounts[type] ?? 0;
    return count > 0 ? [`${type}=${count}`] : [];
  });
  return parts.length === 0 ? "-" : parts.join(", ");
}

function formatAnalyzeMultiDominantTypes(
  typeCounts: Partial<Record<AnalyzeRepoIndexSymbolType, number>>,
): string {
  const parts = ANALYZE_REPO_INDEX_TYPES.map((type) => ({
    type,
    count: typeCounts[type] ?? 0,
  }))
    .filter((part) => part.count > 0)
    .sort((a, b) => b.count - a.count || a.type.localeCompare(b.type))
    .slice(0, 4)
    .map((part) => `${part.type}=${part.count}`);
  return parts.length === 0 ? "-" : parts.join(", ");
}

function formatAnalyzeMultiSummaryReference(
  summary: AnalyzeMultiFolderSummary | undefined,
): string {
  if (!summary) return "none";
  return `\`${markdownTableCell(summary.folder)}\` (${summary.files} files, ${summary.symbols} symbols)`;
}

function formatAnalyzeMultiRatio(largest: number, smallest: number): string {
  if (smallest === 0) return "not comparable to";
  const ratio = Math.round((largest / smallest) * 10) / 10;
  return `${ratio.toFixed(1)}x`;
}

function compareAnalyzeMultiFolderSummaries(
  a: AnalyzeMultiFolderSummary,
  b: AnalyzeMultiFolderSummary,
): number {
  return b.symbols - a.symbols || b.files - a.files || a.folder.localeCompare(b.folder);
}

function compareAnalyzeMultiSharedPrefixSummaries(
  a: AnalyzeMultiSharedPrefixSummary,
  b: AnalyzeMultiSharedPrefixSummary,
): number {
  return (
    b.entries.length - a.entries.length ||
    b.symbols - a.symbols ||
    b.files - a.files ||
    a.prefix.localeCompare(b.prefix)
  );
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

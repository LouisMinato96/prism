import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, normalize, relative } from "node:path";
import { log } from "../../lib/log.ts";
import {
  AnalyzeInsightsSchema,
  AnalyzeRepoIndexSchema,
  AnalyzeRepoIndexSymbolTypeSchema,
  type AnalyzeRepoIndex,
} from "../../schemas/index.ts";
import {
  AnalyzeDiagramSchema,
  AnalyzeMultiManifestSchema,
  ArtifactsIndexSchema,
  KnowledgePackSchema,
  KnowledgeSchemaVersion,
  type AnalyzeMultiManifest,
  type AnalyzeMultiManifestEntry,
  type ArtifactIndexEntry,
  type ArtifactIndexRun,
  type ArtifactLink,
  type ArtifactsIndex,
  type KnowledgeDocSummary,
  type KnowledgeDomainSummary,
  type KnowledgeEntrySummary,
  type KnowledgeInsightSummary,
  type KnowledgeModuleSummary,
  type KnowledgePack,
  type KnowledgeRunSummary,
  type KnowledgeSymbolSummary,
} from "../../schemas/knowledge.ts";

const KNOWLEDGE_PACK_FILE = "knowledge-pack.json";
const ARTIFACTS_INDEX_FILE = "artifacts-index.json";
const VALIDATION_REPORT_FILE = "validation-report.md";

const REQUIRED_ENTRY_ARTIFACTS: Array<keyof AnalyzeMultiManifestEntry["artifacts"]> = [
  "scope",
  "symbols",
  "repoIndex",
  "insights",
  "diagramsManifest",
  "finalIndex",
  "finalReport",
];

export interface KnowledgeBuildOptions {
  baseDir?: string;
  analyzeRoot?: string;
  docsRoot?: string;
  outRoot?: string;
  force?: boolean;
}

export interface KnowledgeBuildResult {
  knowledgePackPath: string;
  artifactsIndexPath: string;
  validationReportPath: string;
  knowledgePack: KnowledgePack;
  artifactsIndex: ArtifactsIndex;
  validation: KnowledgeValidation;
}

export interface KnowledgeValidation {
  missingExpectedFiles: string[];
  failedEntries: string[];
  partialEntryWorkdirs: string[];
  malformedArtifacts: string[];
  docsMissingArtifactLinks: string[];
  duplicateOrStaleRuns: string[];
  contradictionSignals: string[];
}

interface LoadedMultiRun {
  runSummary: KnowledgeRunSummary;
  artifactRun: ArtifactIndexRun;
  entrySummaries: KnowledgeEntrySummary[];
  domains: KnowledgeDomainSummary[];
  symbols: KnowledgeSymbolSummary[];
  modules: KnowledgeModuleSummary[];
  insights: KnowledgeInsightSummary[];
  referencedWorkdirs: Set<string>;
  touchedFiles: string[];
}

export async function runKnowledgeBuild(
  options: KnowledgeBuildOptions = {},
): Promise<KnowledgeBuildResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const analyzeRootInput = options.analyzeRoot ?? ".tmp/analyze";
  const docsRootInput = options.docsRoot ?? "docs/prism";
  const outRootInput = options.outRoot ?? ".prism/knowledge";
  const analyzeRootAbs = resolvePath(baseDir, analyzeRootInput);
  const analyzeRepoRootAbs = deriveAnalyzeRepoRoot(analyzeRootAbs, baseDir);
  const docsRootAbs = resolvePath(baseDir, docsRootInput);
  const outRootAbs = resolvePath(baseDir, outRootInput);
  const force = options.force === true;
  const stage = "knowledge:build";

  log.step(
    `building repo knowledge from ${toDisplayPath(baseDir, analyzeRootAbs)}`,
    stage,
  );
  await mkdir(outRootAbs, { recursive: true });

  const validation: KnowledgeValidation = {
    missingExpectedFiles: [],
    failedEntries: [],
    partialEntryWorkdirs: [],
    malformedArtifacts: [],
    docsMissingArtifactLinks: [],
    duplicateOrStaleRuns: [],
    contradictionSignals: [],
  };

  const [multiRunRoots, entryWorkdirs] = await Promise.all([
    discoverAnalyzeMultiRunRoots(analyzeRootAbs),
    discoverAnalyzeEntryWorkdirs(analyzeRootAbs),
  ]);

  const loadedRuns: LoadedMultiRun[] = [];
  const digestToRuns = new Map<string, string[]>();
  const touchedFiles = new Set<string>();

  for (const runRootAbs of multiRunRoots) {
    const loaded = await loadMultiRun({
      displayBaseDir: baseDir,
      artifactBaseDir: analyzeRepoRootAbs,
      runRootAbs,
      validation,
    });
    if (loaded === null) continue;
    loadedRuns.push(loaded);
    for (const file of loaded.touchedFiles) touchedFiles.add(file);
    const current = digestToRuns.get(loaded.runSummary.configDigest) ?? [];
    current.push(loaded.runSummary.runRoot);
    digestToRuns.set(loaded.runSummary.configDigest, current);
  }

  for (const [digest, runs] of digestToRuns) {
    if (runs.length < 2) continue;
    validation.duplicateOrStaleRuns.push(
      `config digest "${digest}" appears in multiple run roots: ${runs.join(", ")}`,
    );
  }

  const referencedWorkdirs = new Set<string>();
  for (const run of loadedRuns) {
    for (const workdir of run.referencedWorkdirs) referencedWorkdirs.add(workdir);
  }
  const orphanEntryWorkdirs = entryWorkdirs.filter(
    (workdir) => !referencedWorkdirs.has(workdir),
  );

  for (const orphan of orphanEntryWorkdirs) {
    validation.duplicateOrStaleRuns.push(
      `entry workdir not referenced by any multi manifest: ${orphan}`,
    );
  }

  const docsScan = await scanDocsRoot(baseDir, docsRootAbs, validation);
  for (const file of docsScan.touchedFiles) touchedFiles.add(file);
  for (const run of loadedRuns) {
    const manifestAbs = resolvePath(baseDir, run.runSummary.manifest);
    const indexAbs = resolvePath(baseDir, run.runSummary.index);
    const architectureAbs = resolvePath(baseDir, run.runSummary.architecture);
    touchedFiles.add(manifestAbs);
    touchedFiles.add(indexAbs);
    touchedFiles.add(architectureAbs);
  }

  const runSummaries = loadedRuns.map((run) => run.runSummary);
  const entrySummaries = loadedRuns.flatMap((run) => run.entrySummaries);
  const domainSummaries = loadedRuns
    .flatMap((run) => run.domains)
    .sort((a, b) => knowledgeDomainSortKey(a).localeCompare(knowledgeDomainSortKey(b)));
  const symbolSummaries = loadedRuns
    .flatMap((run) => run.symbols)
    .sort((a, b) => knowledgeSymbolSortKey(a).localeCompare(knowledgeSymbolSortKey(b)));
  const moduleSummaries = loadedRuns
    .flatMap((run) => run.modules)
    .sort((a, b) => knowledgeModuleSortKey(a).localeCompare(knowledgeModuleSortKey(b)));
  const insightSummaries = loadedRuns
    .flatMap((run) => run.insights)
    .sort((a, b) => knowledgeInsightSortKey(a).localeCompare(knowledgeInsightSortKey(b)));
  validation.contradictionSignals.push(
    ...detectEntryStatusContradictions(entrySummaries),
    ...detectInsightSeverityContradictions(insightSummaries),
  );
  const docSummaries = docsScan.docs.sort((a, b) => a.path.localeCompare(b.path));
  const docsArtifactLinks = docsScan.links.sort((a, b) =>
    artifactLinkSortKey(a).localeCompare(artifactLinkSortKey(b)),
  );

  const generatedAt = await resolveGeneratedAt(touchedFiles);
  const multiRunDigest = createHash("sha1")
    .update(
      JSON.stringify({
        runs: runSummaries.map((run) => ({
          configDigest: run.configDigest,
          runRoot: run.runRoot,
          succeeded: run.succeededCount,
          failed: run.failedCount,
        })),
        docs: docSummaries.map((doc) => ({
          path: doc.path,
          artifactLinks: doc.artifactLinks,
          missingArtifactLinks: doc.missingArtifactLinks,
        })),
      }),
    )
    .digest("hex")
    .slice(0, 12);

  const knowledgePack = KnowledgePackSchema.parse({
    schemaVersion: KnowledgeSchemaVersion,
    generatedAt,
    analyzeRoot: toDisplayPath(baseDir, analyzeRootAbs),
    docsRoot: toDisplayPath(baseDir, docsRootAbs),
    runs: runSummaries,
    entries: entrySummaries,
    domains: domainSummaries,
    symbols: symbolSummaries,
    modules: moduleSummaries,
    insights: insightSummaries,
    docs: docSummaries,
  });

  const artifactsIndex = ArtifactsIndexSchema.parse({
    schemaVersion: KnowledgeSchemaVersion,
    generatedAt,
    analyzeRoot: toDisplayPath(baseDir, analyzeRootAbs),
    docsRoot: toDisplayPath(baseDir, docsRootAbs),
    outRoot: toDisplayPath(baseDir, outRootAbs),
    multiRunDigest,
    runs: loadedRuns.map((run) => run.artifactRun),
    discoveredEntryWorkdirs: entryWorkdirs,
    orphanEntryWorkdirs,
    docsArtifactLinks,
    integritySignals: {
      staleRunSignals: validation.duplicateOrStaleRuns
        .slice()
        .sort((a, b) => a.localeCompare(b)),
      contradictionSignals: validation.contradictionSignals
        .slice()
        .sort((a, b) => a.localeCompare(b)),
    },
  });

  const validationReport = renderValidationReport(validation, {
    analyzeRoot: toDisplayPath(baseDir, analyzeRootAbs),
    docsRoot: toDisplayPath(baseDir, docsRootAbs),
    outRoot: toDisplayPath(baseDir, outRootAbs),
    runCount: runSummaries.length,
    entryWorkdirCount: entryWorkdirs.length,
    orphanWorkdirCount: orphanEntryWorkdirs.length,
  });

  const knowledgePackPath = join(outRootAbs, KNOWLEDGE_PACK_FILE);
  const artifactsIndexPath = join(outRootAbs, ARTIFACTS_INDEX_FILE);
  const validationReportPath = join(outRootAbs, VALIDATION_REPORT_FILE);

  await writeJsonIfChanged(knowledgePackPath, knowledgePack, force);
  await writeJsonIfChanged(artifactsIndexPath, artifactsIndex, force);
  await writeTextIfChanged(validationReportPath, validationReport, force);

  return {
    knowledgePackPath,
    artifactsIndexPath,
    validationReportPath,
    knowledgePack,
    artifactsIndex,
    validation,
  };
}

export async function discoverAnalyzeMultiRunRoots(
  analyzeRootAbs: string,
): Promise<string[]> {
  const multiRoot = join(analyzeRootAbs, "multi");
  if (!existsSync(multiRoot)) return [];

  const entries = await readdir(multiRoot, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(multiRoot, entry.name))
    .sort();
}

export async function discoverAnalyzeEntryWorkdirs(
  analyzeRootAbs: string,
): Promise<string[]> {
  if (!existsSync(analyzeRootAbs)) return [];

  const entries = await readdir(analyzeRootAbs, { withFileTypes: true });
  const workdirs = entries
    .filter((entry) => entry.isDirectory())
    .filter((entry) => entry.name !== "multi")
    .map((entry) => join(analyzeRootAbs, entry.name))
    .filter((root) => isLikelyAnalyzeWorkdir(root))
    .sort();
  return workdirs;
}

interface LoadMultiRunInput {
  displayBaseDir: string;
  artifactBaseDir: string;
  runRootAbs: string;
  validation: KnowledgeValidation;
}

async function loadMultiRun(input: LoadMultiRunInput): Promise<LoadedMultiRun | null> {
  const runRootRel = toDisplayPath(input.displayBaseDir, input.runRootAbs);
  const manifestPath = join(input.runRootAbs, "manifest.json");
  const indexPath = join(input.runRootAbs, "index.md");
  const architecturePath = join(input.runRootAbs, "architecture.md");
  const touchedFiles: string[] = [];

  if (!existsSync(manifestPath)) {
    input.validation.missingExpectedFiles.push(
      `missing manifest: ${runRootRel}/manifest.json`,
    );
    return null;
  }
  touchedFiles.push(manifestPath);
  if (!existsSync(indexPath)) {
    input.validation.missingExpectedFiles.push(`missing index: ${runRootRel}/index.md`);
  } else {
    touchedFiles.push(indexPath);
  }
  if (!existsSync(architecturePath)) {
    input.validation.missingExpectedFiles.push(
      `missing architecture: ${runRootRel}/architecture.md`,
    );
  } else {
    touchedFiles.push(architecturePath);
  }

  const manifest = await loadAnalyzeMultiManifest(
    manifestPath,
    input.validation,
    `multi manifest ${runRootRel}/manifest.json`,
  );
  if (manifest === null) return null;

  const folderDigest = normalize(runRootRel).split("/").pop() ?? "";
  if (folderDigest !== manifest.configDigest) {
    input.validation.duplicateOrStaleRuns.push(
      `run root digest mismatch for ${runRootRel}: folder="${folderDigest}" manifest="${manifest.configDigest}"`,
    );
  }

  const entrySummaries: KnowledgeEntrySummary[] = [];
  const domains: KnowledgeDomainSummary[] = [];
  const symbols: KnowledgeSymbolSummary[] = [];
  const modules: KnowledgeModuleSummary[] = [];
  const insights: KnowledgeInsightSummary[] = [];
  const artifactEntries: ArtifactIndexEntry[] = [];
  const referencedWorkdirs = new Set<string>();

  for (const manifestEntry of manifest.entries) {
    const entrySummary: KnowledgeEntrySummary = {
      runDigest: manifest.configDigest,
      name: manifestEntry.name,
      path: manifestEntry.path,
      status: manifestEntry.status,
      workdir: manifestEntry.workdir,
      artifacts: manifestEntry.artifacts,
      counts: manifestEntry.counts,
      error: manifestEntry.error,
    };
    entrySummaries.push(entrySummary);
    referencedWorkdirs.add(resolvePath(input.artifactBaseDir, manifestEntry.workdir));

    if (manifestEntry.status === "failed") {
      input.validation.failedEntries.push(
        `${manifest.configDigest}/${manifestEntry.name}: ${manifestEntry.error ?? "unknown error"}`,
      );
    }

    const missingForEntry = REQUIRED_ENTRY_ARTIFACTS.filter((artifactKey) => {
      const artifactPath = resolvePath(
        input.artifactBaseDir,
        manifestEntry.artifacts[artifactKey],
      );
      if (existsSync(artifactPath)) {
        touchedFiles.push(artifactPath);
        return false;
      }
      return true;
    });
    if (missingForEntry.length > 0) {
      input.validation.partialEntryWorkdirs.push(
        `${manifest.configDigest}/${manifestEntry.name}: missing ${missingForEntry.join(", ")}`,
      );
      for (const missing of missingForEntry) {
        input.validation.missingExpectedFiles.push(
          `${manifest.configDigest}/${manifestEntry.name}: ${manifestEntry.artifacts[missing]}`,
        );
      }
    }

    const diagramsManifestAbs = resolvePath(
      input.artifactBaseDir,
      manifestEntry.artifacts.diagramsManifest,
    );
    if (existsSync(diagramsManifestAbs)) {
      const diagrams = await loadJsonFile(
        diagramsManifestAbs,
        AnalyzeDiagramSchema.array(),
        input.validation,
        `${manifest.configDigest}/${manifestEntry.name} diagrams`,
      );
      if (diagrams) {
        for (const diagram of diagrams) {
          if (!existsSync(diagram.path)) {
            input.validation.missingExpectedFiles.push(
              `${manifest.configDigest}/${manifestEntry.name}: missing diagram file ${diagram.path}`,
            );
          }
        }
      }
    }

    const repoIndex = await loadJsonFile(
      resolvePath(input.artifactBaseDir, manifestEntry.artifacts.repoIndex),
      AnalyzeRepoIndexSchema,
      input.validation,
      `${manifest.configDigest}/${manifestEntry.name} repo-index`,
    );
    if (repoIndex !== null) {
      domains.push(
        ...buildDomainSummaries(manifest.configDigest, manifestEntry.name, repoIndex),
      );
      symbols.push(
        ...buildSymbolSummaries(manifest.configDigest, manifestEntry.name, repoIndex),
      );
      modules.push(
        ...buildModuleSummaries(manifest.configDigest, manifestEntry.name, repoIndex),
      );
    }

    const entryInsights = await loadInsightsSummaries(
      input.artifactBaseDir,
      manifest.configDigest,
      manifestEntry.name,
      manifestEntry.artifacts.insights,
      input.validation,
    );
    insights.push(...entryInsights);

    artifactEntries.push({
      name: manifestEntry.name,
      path: manifestEntry.path,
      status: manifestEntry.status,
      workdir: manifestEntry.workdir,
      scope: manifestEntry.artifacts.scope,
      symbols: manifestEntry.artifacts.symbols,
      repoIndex: manifestEntry.artifacts.repoIndex,
      insights: manifestEntry.artifacts.insights,
      finalIndex: manifestEntry.artifacts.finalIndex,
      finalReport: manifestEntry.artifacts.finalReport,
      symbolDirectoryPage: join(
        dirname(manifestEntry.artifacts.finalIndex),
        "pages",
        "11-symbol-directory.md",
      )
        .split("\\")
        .join("/"),
      moduleDirectoryPage: join(
        dirname(manifestEntry.artifacts.finalIndex),
        "pages",
        "12-module-directory.md",
      )
        .split("\\")
        .join("/"),
    });
  }

  const failedCount = manifest.entries.filter(
    (entry) => entry.status === "failed",
  ).length;
  const runSummary: KnowledgeRunSummary = {
    configDigest: manifest.configDigest,
    runRoot: runRootRel,
    manifest: toDisplayPath(input.displayBaseDir, manifestPath),
    index: toDisplayPath(input.displayBaseDir, indexPath),
    architecture: toDisplayPath(input.displayBaseDir, architecturePath),
    entryCount: manifest.entries.length,
    succeededCount: manifest.entries.length - failedCount,
    failedCount,
  };

  const artifactRun: ArtifactIndexRun = {
    configDigest: manifest.configDigest,
    runRoot: runRootRel,
    manifest: toDisplayPath(input.displayBaseDir, manifestPath),
    index: toDisplayPath(input.displayBaseDir, indexPath),
    architecture: toDisplayPath(input.displayBaseDir, architecturePath),
    entries: artifactEntries.sort((a, b) => a.name.localeCompare(b.name)),
  };

  return {
    runSummary,
    artifactRun,
    entrySummaries: entrySummaries.sort((a, b) =>
      knowledgeEntrySortKey(a).localeCompare(knowledgeEntrySortKey(b)),
    ),
    domains,
    symbols,
    modules,
    insights,
    referencedWorkdirs,
    touchedFiles,
  };
}

async function loadAnalyzeMultiManifest(
  manifestPath: string,
  validation: KnowledgeValidation,
  label: string,
): Promise<AnalyzeMultiManifest | null> {
  return await loadJsonFile(manifestPath, AnalyzeMultiManifestSchema, validation, label);
}

async function loadInsightsSummaries(
  baseDir: string,
  runDigest: string,
  entryName: string,
  insightsPath: string,
  validation: KnowledgeValidation,
): Promise<KnowledgeInsightSummary[]> {
  const insightsAbs = resolvePath(baseDir, insightsPath);
  const parsed = await loadJsonFile(
    insightsAbs,
    AnalyzeInsightsSchema,
    validation,
    `${runDigest}/${entryName} insights`,
  );
  if (parsed === null) return [];

  return parsed.insights
    .map((insight) => {
      const firstEvidence = insight.evidence[0] ?? {};
      return {
        runDigest,
        entry: entryName,
        id: insight.id,
        severity: insight.severity,
        lens: insight.lens,
        title: insight.title,
        evidenceCount: insight.evidence.length,
        explanation: insight.explanation,
        suggestion: insight.suggestion,
        docsUrl: insight.docsUrl,
        metric: insight.metric,
        evidenceFile: firstEvidence.file,
        evidenceLine: firstEvidence.line,
        evidenceSymbol: firstEvidence.symbol,
        evidenceDetail: firstEvidence.detail,
      };
    })
    .sort((a, b) => knowledgeInsightSortKey(a).localeCompare(knowledgeInsightSortKey(b)));
}

interface DocsScanResult {
  docs: KnowledgeDocSummary[];
  links: ArtifactLink[];
  touchedFiles: string[];
}

async function scanDocsRoot(
  baseDir: string,
  docsRootAbs: string,
  validation: KnowledgeValidation,
): Promise<DocsScanResult> {
  if (!existsSync(docsRootAbs)) {
    validation.missingExpectedFiles.push(
      `docs root missing: ${toDisplayPath(baseDir, docsRootAbs)}`,
    );
    return { docs: [], links: [], touchedFiles: [] };
  }

  const markdownFiles = await collectMarkdownFiles(docsRootAbs);
  const docs: KnowledgeDocSummary[] = [];
  const links: ArtifactLink[] = [];
  const touchedFiles: string[] = [];

  for (const fileAbs of markdownFiles) {
    touchedFiles.push(fileAbs);
    const content = await readFile(fileAbs, "utf8");
    const docLinks = extractMarkdownLinks(content);
    const artifactLinks = docLinks.filter((link) => isArtifactLikeLink(link.link));
    let missingArtifactLinks = 0;

    for (const link of artifactLinks) {
      const resolvedAbs = resolvePath(dirname(fileAbs), link.path);
      const exists = existsSync(resolvedAbs);
      const record: ArtifactLink = {
        sourceDoc: toDisplayPath(baseDir, fileAbs),
        link: link.link,
        resolved: toDisplayPath(baseDir, resolvedAbs),
        exists,
      };
      links.push(record);
      if (!exists) {
        missingArtifactLinks += 1;
        validation.docsMissingArtifactLinks.push(
          `${record.sourceDoc}: ${record.link} -> ${record.resolved}`,
        );
      }
    }

    docs.push({
      path: toDisplayPath(baseDir, fileAbs),
      artifactLinks: artifactLinks.length,
      missingArtifactLinks,
    });
  }

  return { docs, links, touchedFiles };
}

async function collectMarkdownFiles(rootAbs: string): Promise<string[]> {
  const files: string[] = [];
  const queue = [rootAbs];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = join(current, entry.name);
      if (entry.isDirectory()) {
        queue.push(fullPath);
        continue;
      }
      if (entry.isFile() && entry.name.toLowerCase().endsWith(".md")) {
        files.push(fullPath);
      }
    }
  }

  return files.sort();
}

interface MarkdownLink {
  link: string;
  path: string;
}

function extractMarkdownLinks(content: string): MarkdownLink[] {
  const links: MarkdownLink[] = [];
  const pattern = /\[[^\]]+\]\(([^)]+)\)/g;
  let match: RegExpExecArray | null = pattern.exec(content);
  while (match !== null) {
    const raw = match[1]?.trim() ?? "";
    const stripped = raw.replace(/^<|>$/g, "");
    const path = stripped.split("#")[0]?.split("?")[0] ?? "";
    if (path.length > 0) {
      links.push({ link: stripped, path });
    }
    match = pattern.exec(content);
  }
  return links;
}

function isArtifactLikeLink(link: string): boolean {
  if (link.startsWith("http://") || link.startsWith("https://")) return false;
  if (link.startsWith("mailto:")) return false;
  if (link.startsWith("#")) return false;
  return (
    link.includes(".tmp/") ||
    link.includes(".prism/") ||
    link.startsWith(".tmp") ||
    link.startsWith(".prism")
  );
}

function isLikelyAnalyzeWorkdir(rootAbs: string): boolean {
  return (
    existsSync(join(rootAbs, "scope", "scope.json")) ||
    existsSync(join(rootAbs, "repo-index", "repo-index.json")) ||
    existsSync(join(rootAbs, "final", "index.md"))
  );
}

function buildDomainSummaries(
  runDigest: string,
  entry: string,
  repoIndex: AnalyzeRepoIndex,
): KnowledgeDomainSummary[] {
  const byFolder = new Map<
    string,
    { files: number; symbols: number; exportedSymbols: number }
  >();
  for (const file of repoIndex.files) {
    const folder = dirname(file.path).split("\\").join("/");
    const current = byFolder.get(folder) ?? { files: 0, symbols: 0, exportedSymbols: 0 };
    current.files += 1;
    current.symbols += file.symbolCount;
    current.exportedSymbols += file.exportedSymbolCount;
    byFolder.set(folder, current);
  }

  return [...byFolder.entries()]
    .map(([folder, counts]) => ({
      runDigest,
      entry,
      folder,
      files: counts.files,
      symbols: counts.symbols,
      exportedSymbols: counts.exportedSymbols,
    }))
    .sort((a, b) => knowledgeDomainSortKey(a).localeCompare(knowledgeDomainSortKey(b)));
}

function buildSymbolSummaries(
  runDigest: string,
  entry: string,
  repoIndex: AnalyzeRepoIndex,
): KnowledgeSymbolSummary[] {
  return AnalyzeRepoIndexSymbolTypeSchema.options
    .map((type) => ({
      runDigest,
      entry,
      type,
      count: repoIndex.typeCounts[type] ?? 0,
    }))
    .sort((a, b) => knowledgeSymbolSortKey(a).localeCompare(knowledgeSymbolSortKey(b)));
}

function buildModuleSummaries(
  runDigest: string,
  entry: string,
  repoIndex: AnalyzeRepoIndex,
): KnowledgeModuleSummary[] {
  return repoIndex.files
    .slice()
    .sort(
      (a, b) =>
        b.symbolCount - a.symbolCount ||
        b.exportedSymbolCount - a.exportedSymbolCount ||
        a.path.localeCompare(b.path),
    )
    .slice(0, 50)
    .map((file) => ({
      runDigest,
      entry,
      path: file.path,
      symbolCount: file.symbolCount,
      exportedSymbolCount: file.exportedSymbolCount,
    }))
    .sort((a, b) => knowledgeModuleSortKey(a).localeCompare(knowledgeModuleSortKey(b)));
}

async function loadJsonFile<T>(
  path: string,
  schema: {
    safeParse: (value: unknown) =>
      | { success: true; data: T }
      | {
          success: false;
          error: { issues: Array<{ path: Array<string | number>; message: string }> };
        };
  },
  validation: KnowledgeValidation,
  label: string,
): Promise<T | null> {
  if (!existsSync(path)) {
    validation.missingExpectedFiles.push(`missing ${label}: ${path}`);
    return null;
  }
  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    validation.malformedArtifacts.push(
      `${label}: invalid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }

  const parsed = schema.safeParse(parsedJson);
  if (!parsed.success) {
    const details = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    validation.malformedArtifacts.push(
      `${label}: schema mismatch at ${path}: ${details}`,
    );
    return null;
  }
  return parsed.data;
}

function renderValidationReport(
  validation: KnowledgeValidation,
  context: {
    analyzeRoot: string;
    docsRoot: string;
    outRoot: string;
    runCount: number;
    entryWorkdirCount: number;
    orphanWorkdirCount: number;
  },
): string {
  const lines: string[] = [];
  lines.push("# Prism Knowledge Validation Report");
  lines.push("");
  lines.push(`- schema version: ${KnowledgeSchemaVersion}`);
  lines.push(`- analyze root: \`${context.analyzeRoot}\``);
  lines.push(`- docs root: \`${context.docsRoot}\``);
  lines.push(`- output root: \`${context.outRoot}\``);
  lines.push(`- discovered multi runs: ${context.runCount}`);
  lines.push(`- discovered entry workdirs: ${context.entryWorkdirCount}`);
  lines.push(`- orphan entry workdirs: ${context.orphanWorkdirCount}`);
  lines.push("");
  lines.push(
    ...renderValidationSection("Missing Expected Files", validation.missingExpectedFiles),
  );
  lines.push(...renderValidationSection("Failed Entries", validation.failedEntries));
  lines.push(
    ...renderValidationSection("Partial Entry Workdirs", validation.partialEntryWorkdirs),
  );
  lines.push(
    ...renderValidationSection("Malformed Artifacts", validation.malformedArtifacts),
  );
  lines.push(
    ...renderValidationSection(
      "Docs Missing Artifact Links",
      validation.docsMissingArtifactLinks,
    ),
  );
  lines.push(
    ...renderValidationSection(
      "Duplicate Or Stale-Looking Runs",
      validation.duplicateOrStaleRuns,
    ),
  );
  lines.push(
    ...renderValidationSection("Contradiction Signals", validation.contradictionSignals),
  );
  return `${lines.join("\n")}\n`;
}

function detectEntryStatusContradictions(entries: KnowledgeEntrySummary[]): string[] {
  const statusByPath = new Map<string, Set<string>>();
  const runsByPath = new Map<string, Set<string>>();
  for (const entry of entries) {
    const statuses = statusByPath.get(entry.path) ?? new Set<string>();
    statuses.add(entry.status);
    statusByPath.set(entry.path, statuses);

    const runs = runsByPath.get(entry.path) ?? new Set<string>();
    runs.add(entry.runDigest);
    runsByPath.set(entry.path, runs);
  }

  const contradictions: string[] = [];
  for (const [path, statuses] of statusByPath) {
    if (statuses.size < 2) continue;
    contradictions.push(
      `entry status conflict for ${path}: statuses=${[...statuses].sort().join(", ")} across runs=${[
        ...(runsByPath.get(path) ?? new Set<string>()),
      ]
        .sort()
        .join(", ")}`,
    );
  }
  return contradictions.sort((a, b) => a.localeCompare(b));
}

function detectInsightSeverityContradictions(
  insights: KnowledgeInsightSummary[],
): string[] {
  const bucket = new Map<string, { severities: Set<string>; runs: Set<string> }>();
  for (const insight of insights) {
    const key = `${insight.entry}|${insight.lens}|${insight.title}`;
    const current = bucket.get(key) ?? {
      severities: new Set<string>(),
      runs: new Set<string>(),
    };
    current.severities.add(insight.severity);
    current.runs.add(insight.runDigest);
    bucket.set(key, current);
  }

  const contradictions: string[] = [];
  for (const [key, value] of bucket) {
    if (value.severities.size < 2) continue;
    const [entry, lens, title] = key.split("|");
    contradictions.push(
      `insight severity conflict for ${entry} (${lens}/${title}): severities=${[
        ...value.severities,
      ]
        .sort()
        .join(", ")} across runs=${[...value.runs].sort().join(", ")}`,
    );
  }
  return contradictions.sort((a, b) => a.localeCompare(b));
}

function renderValidationSection(title: string, items: string[]): string[] {
  const lines = [`## ${title}`, ""];
  if (items.length === 0) {
    lines.push("None.");
    lines.push("");
    return lines;
  }
  for (const item of items.slice().sort((a, b) => a.localeCompare(b))) {
    lines.push(`- ${item}`);
  }
  lines.push("");
  return lines;
}

async function writeJsonIfChanged(
  path: string,
  value: unknown,
  force: boolean,
): Promise<void> {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  await writeTextIfChanged(path, content, force);
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

async function resolveGeneratedAt(touchedFiles: Set<string>): Promise<string> {
  let maxMtimeMs = 0;
  for (const path of touchedFiles) {
    if (!existsSync(path)) continue;
    const mtimeMs = (await stat(path)).mtimeMs;
    if (mtimeMs > maxMtimeMs) maxMtimeMs = mtimeMs;
  }
  if (maxMtimeMs <= 0) return new Date(0).toISOString();
  return new Date(maxMtimeMs).toISOString();
}

function deriveAnalyzeRepoRoot(analyzeRootAbs: string, fallbackBaseDir: string): string {
  if (
    basename(analyzeRootAbs) === "analyze" &&
    basename(dirname(analyzeRootAbs)) === ".tmp"
  ) {
    return dirname(dirname(analyzeRootAbs));
  }
  return fallbackBaseDir;
}

function resolvePath(baseDir: string, path: string): string {
  if (path.startsWith("/")) return normalize(path);
  return normalize(join(baseDir, path));
}

function toDisplayPath(baseDir: string, path: string): string {
  const rel = relative(baseDir, path).split("\\").join("/");
  if (rel === "") return ".";
  if (!rel.startsWith("../") && rel !== "..") return rel;
  return path.split("\\").join("/");
}

function knowledgeEntrySortKey(value: KnowledgeEntrySummary): string {
  return `${value.runDigest}:${value.name}:${value.path}`;
}

function knowledgeDomainSortKey(value: KnowledgeDomainSummary): string {
  return `${value.runDigest}:${value.entry}:${value.folder}`;
}

function knowledgeSymbolSortKey(value: KnowledgeSymbolSummary): string {
  return `${value.runDigest}:${value.entry}:${value.type}`;
}

function knowledgeModuleSortKey(value: KnowledgeModuleSummary): string {
  return `${value.runDigest}:${value.entry}:${value.path}`;
}

function knowledgeInsightSortKey(value: KnowledgeInsightSummary): string {
  return `${value.runDigest}:${value.entry}:${value.id}`;
}

function artifactLinkSortKey(value: ArtifactLink): string {
  return `${value.sourceDoc}:${value.link}:${value.resolved}`;
}

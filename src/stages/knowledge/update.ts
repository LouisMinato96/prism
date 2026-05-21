import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";
import { log } from "../../lib/log.ts";
import { runAnalyzeEntry } from "../analyze/run.ts";
import { runKnowledgeBuild } from "./build.ts";
import {
  AnalyzeMultiManifestSchema,
  ArtifactsIndexSchema,
  KnowledgeSchemaVersion,
  KnowledgeStateSchema,
  KnowledgeUpdateReportSchema,
  type KnowledgeUpdateChangeStatus,
  type KnowledgeUpdateCommit,
  type KnowledgeUpdateEntryImpact,
  type KnowledgeUpdateEntryImpactMatch,
  type KnowledgeUpdateExecution,
  type KnowledgeUpdateImpactReason,
  type KnowledgeUpdateFileChange,
  type KnowledgeState,
  type KnowledgeUpdateReport,
  type KnowledgeUpdateSlice,
} from "../../schemas/knowledge.ts";

const UPDATE_HISTORY_DIR = "history/updates";
const ARTIFACTS_INDEX_FILE = "artifacts-index.json";
const KNOWLEDGE_STATE_FILE = "state.json";

export interface KnowledgeUpdateOptions {
  baseDir?: string;
  repoRoot: string;
  knowledgeRoot: string;
  from: string;
  to: string;
  batchSize: number;
  dryRun?: boolean;
  force?: boolean;
}

export interface KnowledgeUpdateResult {
  reportPath: string;
  reportMarkdownPath: string;
  report: KnowledgeUpdateReport;
}

export async function runKnowledgeUpdate(
  options: KnowledgeUpdateOptions,
): Promise<KnowledgeUpdateResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const repoRootAbs = resolvePath(baseDir, options.repoRoot);
  const knowledgeRootAbs = resolvePath(baseDir, options.knowledgeRoot);
  const dryRun = options.dryRun !== false;
  const force = options.force === true;
  const stage = "knowledge:update";

  log.step(`planning knowledge update from ${options.from} to ${options.to}`, stage);

  const resolvedFrom = await resolveCommit(repoRootAbs, options.from);
  const resolvedTo = await resolveCommit(repoRootAbs, options.to);
  const commits = await listCommitsInRange(repoRootAbs, resolvedFrom, resolvedTo);
  const changes = await listChangesForCommits(repoRootAbs, commits);
  const changeSummary = summarizeChanges(changes);
  const mappingContext = await loadMappingContext(knowledgeRootAbs);
  const mapping = mapChangedFilesToKnowledgeEntries(mappingContext.entries, changes);
  const execution = dryRun
    ? undefined
    : await executeSelectiveRefresh({
        baseDir,
        repoRootAbs,
        knowledgeRootAbs,
        mappingContext,
        mapping,
      });
  const slices = buildSlices(commits, options.batchSize);

  const generatedAt =
    commits.length > 0
      ? commits[commits.length - 1]!.authoredAt
      : await resolveCommitAuthoredAt(repoRootAbs, resolvedTo);

  const report = KnowledgeUpdateReportSchema.parse({
    schemaVersion: KnowledgeSchemaVersion,
    generatedAt,
    mode: dryRun ? "dry-run" : "apply",
    repoRoot: toDisplayPath(baseDir, repoRootAbs),
    knowledgeRoot: toDisplayPath(baseDir, knowledgeRootAbs),
    from: options.from,
    to: options.to,
    resolvedFrom,
    resolvedTo,
    batchSize: options.batchSize,
    dryRun,
    commitCount: commits.length,
    commits,
    changeCount: changes.length,
    changes,
    changeSummary,
    impactSummary: {
      impactedEntries: mapping.impacts.length,
      staleEntries: mapping.impacts.filter((impact) => impact.stale).length,
      unmappedChanges: mapping.unmappedChanges.length,
    },
    impacts: mapping.impacts,
    unmappedChanges: mapping.unmappedChanges,
    execution,
    slices,
    notes: [
      dryRun
        ? "Dry-run planning only; analyze/build mutation is not executed."
        : "Apply mode executed selective refresh for impacted entries.",
      "Changed-file ingestion is deterministic and git-backed (A/M/D/R).",
      ...mappingContext.notes,
      ...mapping.notes,
      ...renderExecutionNotes(execution),
    ],
  });

  const stamp = timestampForFileName(report.generatedAt);
  const fileBase = `${stamp}-${report.resolvedFrom.slice(0, 12)}-${report.resolvedTo.slice(0, 12)}`;
  const updatesDirAbs = join(knowledgeRootAbs, UPDATE_HISTORY_DIR);
  const reportPath = join(updatesDirAbs, `${fileBase}.json`);
  const reportMarkdownPath = join(updatesDirAbs, `${fileBase}.md`);

  await mkdir(updatesDirAbs, { recursive: true });
  await writeTextIfChanged(reportPath, `${JSON.stringify(report, null, 2)}\n`, force);
  await writeTextIfChanged(reportMarkdownPath, renderUpdateReportMarkdown(report), force);
  await writeKnowledgeState({
    knowledgeRootAbs,
    report,
    reportPath,
    force,
  });

  return {
    reportPath,
    reportMarkdownPath,
    report,
  };
}

async function resolveCommit(repoRootAbs: string, ref: string): Promise<string> {
  const output = await gitRun(repoRootAbs, ["rev-parse", "--verify", `${ref}^{commit}`]);
  return output.trim();
}

async function resolveCommitAuthoredAt(
  repoRootAbs: string,
  commit: string,
): Promise<string> {
  const output = await gitRun(repoRootAbs, ["show", "-s", "--format=%ct", commit]);
  const epochSeconds = Number(output.trim());
  if (!Number.isFinite(epochSeconds) || epochSeconds < 0) {
    throw new Error(`failed to parse commit authored timestamp for ${commit}`);
  }
  return new Date(epochSeconds * 1000).toISOString();
}

async function listCommitsInRange(
  repoRootAbs: string,
  fromCommit: string,
  toCommit: string,
): Promise<KnowledgeUpdateCommit[]> {
  const output = await gitRun(repoRootAbs, [
    "log",
    "--reverse",
    "--format=%H%x1f%ct%x1f%s",
    `${fromCommit}..${toCommit}`,
  ]);
  const lines = output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  return lines.map((line) => {
    const [sha, epochRaw, subject] = line.split("\u001f");
    const epochSeconds = Number(epochRaw ?? "");
    if (!sha || !subject || !Number.isFinite(epochSeconds) || epochSeconds < 0) {
      throw new Error(`malformed git log line: ${line}`);
    }
    return {
      sha,
      shortSha: sha.slice(0, 12),
      authoredAt: new Date(epochSeconds * 1000).toISOString(),
      subject,
    } satisfies KnowledgeUpdateCommit;
  });
}

async function listChangesForCommits(
  repoRootAbs: string,
  commits: KnowledgeUpdateCommit[],
): Promise<KnowledgeUpdateFileChange[]> {
  const allChanges: KnowledgeUpdateFileChange[] = [];

  for (const commit of commits) {
    const output = await gitRun(repoRootAbs, [
      "show",
      "--name-status",
      "--format=",
      "--find-renames",
      commit.sha,
    ]);
    const lines = output
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0);

    const commitChanges = lines
      .map((line) => parseNameStatusLine(line, commit))
      .sort(
        (a, b) =>
          a.status.localeCompare(b.status) ||
          a.path.localeCompare(b.path) ||
          (a.previousPath ?? "").localeCompare(b.previousPath ?? ""),
      );
    allChanges.push(...commitChanges);
  }

  return allChanges;
}

function parseNameStatusLine(
  line: string,
  commit: KnowledgeUpdateCommit,
): KnowledgeUpdateFileChange {
  const parts = line.split(/\t+/);
  const statusToken = parts[0] ?? "";
  if (statusToken.startsWith("R")) {
    const oldPath = normalizeRepoPath(parts[1] ?? "");
    const newPath = normalizeRepoPath(parts[2] ?? "");
    if (!oldPath || !newPath) {
      throw new Error(`malformed rename line in ${commit.sha}: ${line}`);
    }
    return {
      commitSha: commit.sha,
      commitShortSha: commit.shortSha,
      status: "renamed",
      previousPath: oldPath,
      path: newPath,
    };
  }

  const mapped = mapChangeStatus(statusToken);
  const path = normalizeRepoPath(parts[1] ?? "");
  if (!mapped || !path) {
    throw new Error(
      `unsupported or malformed name-status line in ${commit.sha}: ${line}`,
    );
  }
  return {
    commitSha: commit.sha,
    commitShortSha: commit.shortSha,
    status: mapped,
    path,
  };
}

function mapChangeStatus(token: string): KnowledgeUpdateChangeStatus | null {
  if (token === "A") return "added";
  if (token === "M") return "modified";
  if (token === "D") return "deleted";
  return null;
}

function summarizeChanges(changes: KnowledgeUpdateFileChange[]): {
  total: number;
  added: number;
  modified: number;
  deleted: number;
  renamed: number;
} {
  const summary = {
    total: changes.length,
    added: 0,
    modified: 0,
    deleted: 0,
    renamed: 0,
  };
  for (const change of changes) {
    summary[change.status] += 1;
  }
  return summary;
}

interface MappingEntry {
  runDigest: string;
  entryName: string;
  entryPath: string;
  workdir: string;
  status: "success" | "failed";
  manifestPath: string;
}

interface MappingContext {
  analyzeRoot: string;
  docsRoot: string;
  outRoot: string;
  entries: MappingEntry[];
  notes: string[];
}

interface MappingResult {
  impacts: KnowledgeUpdateEntryImpact[];
  unmappedChanges: KnowledgeUpdateFileChange[];
  notes: string[];
}

function mapChangedFilesToKnowledgeEntries(
  entries: MappingEntry[],
  changes: KnowledgeUpdateFileChange[],
): MappingResult {
  const notes: string[] = [];
  if (entries.length === 0) {
    return { impacts: [], unmappedChanges: changes.slice(), notes };
  }

  const impactsByKey = new Map<string, KnowledgeUpdateEntryImpact>();
  const mappedChangeIndexes = new Set<number>();

  for (const [index, change] of changes.entries()) {
    for (const entry of entries) {
      const matches = resolveImpactMatches(change, entry);
      if (matches.length === 0) continue;
      mappedChangeIndexes.add(index);
      const key = `${entry.runDigest}::${entry.entryName}::${entry.entryPath}`;
      const current =
        impactsByKey.get(key) ??
        ({
          runDigest: entry.runDigest,
          entryName: entry.entryName,
          entryPath: entry.entryPath,
          workdir: entry.workdir,
          status: entry.status,
          stale: false,
          matches: [],
        } satisfies KnowledgeUpdateEntryImpact);
      for (const match of matches) {
        current.matches.push(match);
        if (match.staleSignal) current.stale = true;
      }
      impactsByKey.set(key, current);
    }
  }

  const impacts = [...impactsByKey.values()]
    .map((impact) => ({
      ...impact,
      matches: dedupeAndSortImpactMatches(impact.matches),
      stale: impact.matches.some((match) => match.staleSignal),
    }))
    .sort(
      (a, b) =>
        a.runDigest.localeCompare(b.runDigest) ||
        a.entryName.localeCompare(b.entryName) ||
        a.entryPath.localeCompare(b.entryPath),
    );

  const unmappedChanges = changes.filter((_, index) => !mappedChangeIndexes.has(index));
  if (unmappedChanges.length > 0) {
    notes.push(
      `No entry mapping found for ${unmappedChanges.length} changed file(s); these remain unmapped for this slice.`,
    );
  }

  return { impacts, unmappedChanges, notes };
}

function resolveImpactMatches(
  change: KnowledgeUpdateFileChange,
  entry: MappingEntry,
): KnowledgeUpdateEntryImpactMatch[] {
  const matches: KnowledgeUpdateEntryImpactMatch[] = [];
  const entryPath = normalizeRepoPath(entry.entryPath);
  const path = normalizeRepoPath(change.path);

  if (change.status !== "renamed" && entryPath === path) {
    matches.push(
      buildImpactMatch(change, "entry-path-exact", change.status === "deleted"),
    );
  }

  if (change.status === "renamed" && change.previousPath) {
    const previousPath = normalizeRepoPath(change.previousPath);
    if (entryPath === previousPath) {
      matches.push(buildImpactMatch(change, "entry-path-rename-previous", true));
    }
    if (entryPath === path) {
      matches.push(buildImpactMatch(change, "entry-path-rename-next", false));
    }
  }

  return matches;
}

function buildImpactMatch(
  change: KnowledgeUpdateFileChange,
  reason: KnowledgeUpdateImpactReason,
  staleSignal: boolean,
): KnowledgeUpdateEntryImpactMatch {
  return {
    commitSha: change.commitSha,
    commitShortSha: change.commitShortSha,
    status: change.status,
    path: change.path,
    previousPath: change.previousPath,
    reason,
    staleSignal,
  };
}

function dedupeAndSortImpactMatches(
  matches: KnowledgeUpdateEntryImpactMatch[],
): KnowledgeUpdateEntryImpactMatch[] {
  const unique = new Map<string, KnowledgeUpdateEntryImpactMatch>();
  for (const match of matches) {
    const key = [
      match.commitSha,
      match.status,
      match.path,
      match.previousPath ?? "",
      match.reason,
      match.staleSignal ? "1" : "0",
    ].join("::");
    unique.set(key, match);
  }
  return [...unique.values()].sort(
    (a, b) =>
      a.commitSha.localeCompare(b.commitSha) ||
      a.status.localeCompare(b.status) ||
      a.path.localeCompare(b.path) ||
      (a.previousPath ?? "").localeCompare(b.previousPath ?? "") ||
      a.reason.localeCompare(b.reason),
  );
}

async function loadMappingContext(knowledgeRootAbs: string): Promise<MappingContext> {
  const notes: string[] = [];
  const artifactsIndexPath = join(knowledgeRootAbs, ARTIFACTS_INDEX_FILE);
  if (!existsSync(artifactsIndexPath)) {
    notes.push(`Mapping context missing: ${artifactsIndexPath} was not found.`);
    return {
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: toDisplayPath(knowledgeRootAbs, knowledgeRootAbs),
      entries: [],
      notes,
    };
  }

  let json: unknown;
  try {
    json = JSON.parse(await readFile(artifactsIndexPath, "utf8"));
  } catch (error) {
    notes.push(
      `Mapping context malformed: invalid JSON in ${artifactsIndexPath}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: toDisplayPath(knowledgeRootAbs, knowledgeRootAbs),
      entries: [],
      notes,
    };
  }

  const parsed = ArtifactsIndexSchema.safeParse(json);
  if (!parsed.success) {
    const issueSummary = parsed.error.issues
      .map((issue) => `${issue.path.join(".") || "<root>"}: ${issue.message}`)
      .join("; ");
    notes.push(
      `Mapping context malformed: schema mismatch in ${artifactsIndexPath}: ${issueSummary}`,
    );
    return {
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: toDisplayPath(knowledgeRootAbs, knowledgeRootAbs),
      entries: [],
      notes,
    };
  }

  const entries = parsed.data.runs
    .flatMap((run) =>
      run.entries.map((entry) => ({
        runDigest: run.configDigest,
        entryName: entry.name,
        entryPath: entry.path,
        workdir: entry.workdir,
        status: entry.status,
        manifestPath: run.manifest,
      })),
    )
    .sort(
      (a, b) =>
        a.runDigest.localeCompare(b.runDigest) ||
        a.entryName.localeCompare(b.entryName) ||
        a.entryPath.localeCompare(b.entryPath),
    );

  return {
    analyzeRoot: parsed.data.analyzeRoot,
    docsRoot: parsed.data.docsRoot,
    outRoot: parsed.data.outRoot,
    entries,
    notes,
  };
}

async function executeSelectiveRefresh(input: {
  baseDir: string;
  repoRootAbs: string;
  knowledgeRootAbs: string;
  mappingContext: MappingContext;
  mapping: MappingResult;
}): Promise<KnowledgeUpdateExecution> {
  const failures: string[] = [];
  const staleKeys = new Set(
    input.mapping.impacts
      .filter((impact) => impact.stale)
      .map((impact) => impactKey(impact.runDigest, impact.entryName, impact.entryPath)),
  );

  const targets = input.mapping.impacts.filter((impact) => !impact.stale);
  const targetEntryCount = targets.length;
  const skippedStaleEntries = staleKeys.size;
  let attemptedEntries = 0;
  let succeededEntries = 0;
  let failedEntries = 0;

  const mappingByKey = new Map<string, MappingEntry>();
  for (const entry of input.mappingContext.entries) {
    mappingByKey.set(impactKey(entry.runDigest, entry.entryName, entry.entryPath), entry);
  }

  const manifestCache = new Map<
    string,
    ReturnType<typeof AnalyzeMultiManifestSchema.parse>
  >();
  const touchedManifestPaths = new Set<string>();

  for (const impact of targets) {
    const key = impactKey(impact.runDigest, impact.entryName, impact.entryPath);
    const mappingEntry = mappingByKey.get(key);
    if (!mappingEntry) {
      failedEntries += 1;
      failures.push(`mapping entry missing for impacted entry ${key}`);
      continue;
    }

    const manifestAbs = resolvePath(input.baseDir, mappingEntry.manifestPath);
    let manifest = manifestCache.get(manifestAbs);
    if (!manifest) {
      try {
        const json = JSON.parse(await readFile(manifestAbs, "utf8"));
        manifest = AnalyzeMultiManifestSchema.parse(json);
        manifestCache.set(manifestAbs, manifest);
      } catch (error) {
        failedEntries += 1;
        failures.push(
          `failed to load manifest ${manifestAbs}: ${error instanceof Error ? error.message : String(error)}`,
        );
        continue;
      }
    }

    const manifestEntry = manifest.entries.find(
      (entry) => entry.name === impact.entryName && entry.path === impact.entryPath,
    );
    if (!manifestEntry) {
      failedEntries += 1;
      failures.push(`manifest entry missing for ${key} in ${manifestAbs}`);
      continue;
    }

    attemptedEntries += 1;
    try {
      const result = await runAnalyzeEntry(
        {
          name: manifestEntry.name,
          path: manifestEntry.path,
        },
        {
          baseDir: input.repoRootAbs,
          depth: manifest.config.depth,
          maxFiles: manifest.config.maxFiles,
          include: manifest.config.include.join(","),
          exclude: manifest.config.exclude.join(","),
          force: { forceAll: true },
        },
      );

      manifestEntry.status = "success";
      manifestEntry.workdir = toRepoRelativePath(input.repoRootAbs, result.workdir.root);
      manifestEntry.artifacts = {
        scope: toRepoRelativePath(input.repoRootAbs, result.workdir.scopeFile()),
        symbols: toRepoRelativePath(input.repoRootAbs, result.workdir.symbolsFile()),
        repoIndex: toRepoRelativePath(input.repoRootAbs, result.workdir.repoIndexFile()),
        graph: toRepoRelativePath(input.repoRootAbs, result.workdir.graphFile()),
        insights: toRepoRelativePath(input.repoRootAbs, result.workdir.insightsFile()),
        diagramsManifest: toRepoRelativePath(
          input.repoRootAbs,
          result.workdir.diagramManifestFile(),
        ),
        finalIndex: toRepoRelativePath(
          input.repoRootAbs,
          result.workdir.finalIndexReport(),
        ),
        finalReport: toRepoRelativePath(input.repoRootAbs, result.workdir.finalReport()),
      };
      manifestEntry.counts = {
        files: result.counts.files,
        symbols: result.counts.symbols,
        edges: result.counts.edges,
        diagrams: result.counts.diagrams,
        insights: result.counts.insights,
      };
      delete manifestEntry.error;
      touchedManifestPaths.add(manifestAbs);
      succeededEntries += 1;
    } catch (error) {
      manifestEntry.status = "failed";
      delete manifestEntry.counts;
      manifestEntry.error = error instanceof Error ? error.message : String(error);
      touchedManifestPaths.add(manifestAbs);
      failedEntries += 1;
      failures.push(
        `analyze failed for ${key}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }

  for (const manifestAbs of [...touchedManifestPaths].sort()) {
    const manifest = manifestCache.get(manifestAbs);
    if (!manifest) continue;
    await writeTextIfChanged(manifestAbs, `${JSON.stringify(manifest, null, 2)}\n`, true);
  }

  let rebuiltKnowledge = false;
  try {
    await runKnowledgeBuild({
      baseDir: input.repoRootAbs,
      analyzeRoot: input.mappingContext.analyzeRoot,
      docsRoot: input.mappingContext.docsRoot,
      outRoot: input.knowledgeRootAbs,
      force: true,
    });
    rebuiltKnowledge = true;
  } catch (error) {
    failures.push(
      `knowledge build failed: ${error instanceof Error ? error.message : String(error)}`,
    );
  }

  return {
    targetEntries: targetEntryCount,
    skippedStaleEntries,
    attemptedEntries,
    succeededEntries,
    failedEntries,
    rebuiltKnowledge,
    failures: failures.sort((a, b) => a.localeCompare(b)),
  };
}

function impactKey(runDigest: string, entryName: string, entryPath: string): string {
  return `${runDigest}::${entryName}::${entryPath}`;
}

function renderExecutionNotes(execution: KnowledgeUpdateExecution | undefined): string[] {
  if (!execution) return [];
  return [
    `Execution summary: targets=${execution.targetEntries}, attempted=${execution.attemptedEntries}, succeeded=${execution.succeededEntries}, failed=${execution.failedEntries}, skippedStale=${execution.skippedStaleEntries}, rebuiltKnowledge=${execution.rebuiltKnowledge ? "yes" : "no"}.`,
  ];
}

function toRepoRelativePath(repoRootAbs: string, absolutePath: string): string {
  return relative(repoRootAbs, absolutePath).split("\\").join("/");
}

async function writeKnowledgeState(input: {
  knowledgeRootAbs: string;
  report: KnowledgeUpdateReport;
  reportPath: string;
  force: boolean;
}): Promise<void> {
  const statePath = join(input.knowledgeRootAbs, KNOWLEDGE_STATE_FILE);
  const existing = await loadKnowledgeState(statePath);
  const reportRel = relative(input.knowledgeRootAbs, input.reportPath)
    .split("\\")
    .join("/");

  const appliedUpdates = existing.appliedUpdates.slice();
  if (input.report.mode === "apply") {
    appliedUpdates.push({
      generatedAt: input.report.generatedAt,
      from: input.report.from,
      to: input.report.to,
      resolvedFrom: input.report.resolvedFrom,
      resolvedTo: input.report.resolvedTo,
      reportPath: reportRel,
    });
  }

  const dedupedAppliedUpdates = dedupeAppliedUpdates(appliedUpdates).slice(-100);
  const next = KnowledgeStateSchema.parse({
    schemaVersion: KnowledgeSchemaVersion,
    updatedAt: input.report.generatedAt,
    latestReportPath: reportRel,
    latestMode: input.report.mode,
    latestRange: {
      from: input.report.from,
      to: input.report.to,
      resolvedFrom: input.report.resolvedFrom,
      resolvedTo: input.report.resolvedTo,
    },
    lastAppliedReportPath:
      input.report.mode === "apply" ? reportRel : existing.lastAppliedReportPath,
    appliedUpdates: dedupedAppliedUpdates,
  });

  await writeTextIfChanged(statePath, `${JSON.stringify(next, null, 2)}\n`, input.force);
}

async function loadKnowledgeState(path: string): Promise<KnowledgeState> {
  if (!existsSync(path)) {
    return {
      schemaVersion: KnowledgeSchemaVersion,
      updatedAt: new Date(0).toISOString(),
      latestReportPath: "",
      latestMode: "dry-run",
      latestRange: {
        from: "",
        to: "",
        resolvedFrom: "",
        resolvedTo: "",
      },
      appliedUpdates: [],
    };
  }

  try {
    const json = JSON.parse(await readFile(path, "utf8"));
    const parsed = KnowledgeStateSchema.safeParse(json);
    if (parsed.success) return parsed.data;
  } catch {
    // Ignore malformed state and reinitialize deterministically.
  }

  return {
    schemaVersion: KnowledgeSchemaVersion,
    updatedAt: new Date(0).toISOString(),
    latestReportPath: "",
    latestMode: "dry-run",
    latestRange: {
      from: "",
      to: "",
      resolvedFrom: "",
      resolvedTo: "",
    },
    appliedUpdates: [],
  };
}

function dedupeAppliedUpdates(
  updates: KnowledgeState["appliedUpdates"],
): KnowledgeState["appliedUpdates"] {
  const byKey = new Map<string, KnowledgeState["appliedUpdates"][number]>();
  for (const update of updates) {
    const key = `${update.resolvedFrom}::${update.resolvedTo}`;
    byKey.set(key, update);
  }
  return [...byKey.values()].sort(
    (a, b) =>
      a.generatedAt.localeCompare(b.generatedAt) ||
      a.resolvedFrom.localeCompare(b.resolvedFrom) ||
      a.resolvedTo.localeCompare(b.resolvedTo),
  );
}

function buildSlices(
  commits: KnowledgeUpdateCommit[],
  batchSize: number,
): KnowledgeUpdateSlice[] {
  const slices: KnowledgeUpdateSlice[] = [];
  for (let start = 0; start < commits.length; start += batchSize) {
    const chunk = commits.slice(start, start + batchSize);
    if (chunk.length === 0) continue;
    slices.push({
      index: slices.length,
      fromCommit: chunk[0]!.sha,
      toCommit: chunk[chunk.length - 1]!.sha,
      commitCount: chunk.length,
    });
  }
  return slices;
}

function renderUpdateReportMarkdown(report: KnowledgeUpdateReport): string {
  const lines: string[] = [];
  lines.push("# Prism Knowledge Update Report");
  lines.push("");
  lines.push(`- schema version: ${report.schemaVersion}`);
  lines.push(`- mode: ${report.mode}`);
  lines.push(`- generated at: ${report.generatedAt}`);
  lines.push(`- repo root: \`${report.repoRoot}\``);
  lines.push(`- knowledge root: \`${report.knowledgeRoot}\``);
  lines.push(`- requested range: \`${report.from}..${report.to}\``);
  lines.push(`- resolved range: \`${report.resolvedFrom}..${report.resolvedTo}\``);
  lines.push(`- dry run: ${report.dryRun ? "yes" : "no"}`);
  lines.push(`- batch size: ${report.batchSize}`);
  lines.push(`- commit count: ${report.commitCount}`);
  lines.push(`- changed files: ${report.changeCount}`);
  lines.push(
    `- impacted entries: ${report.impactSummary.impactedEntries} (stale: ${report.impactSummary.staleEntries})`,
  );
  lines.push(`- unmapped changes: ${report.impactSummary.unmappedChanges}`);
  lines.push("");

  lines.push("## Commits");
  lines.push("");
  if (report.commits.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| # | sha | authored at | subject |");
    lines.push("| --- | --- | --- | --- |");
    report.commits.forEach((commit, index) => {
      lines.push(
        `| ${index + 1} | ${commit.shortSha} | ${commit.authoredAt} | ${escapeTableCell(commit.subject)} |`,
      );
    });
  }
  lines.push("");

  lines.push("## Changed Files");
  lines.push("");
  lines.push(
    `- summary: total=${report.changeSummary.total}, added=${report.changeSummary.added}, modified=${report.changeSummary.modified}, deleted=${report.changeSummary.deleted}, renamed=${report.changeSummary.renamed}`,
  );
  lines.push("");
  if (report.changes.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| # | commit | status | path | previous path |");
    lines.push("| --- | --- | --- | --- | --- |");
    report.changes.forEach((change, index) => {
      lines.push(
        `| ${index + 1} | ${change.commitShortSha} | ${change.status} | ${escapeTableCell(change.path)} | ${escapeTableCell(change.previousPath ?? "-")} |`,
      );
    });
  }
  lines.push("");

  lines.push("## Impacted Entries");
  lines.push("");
  if (report.impacts.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| # | run | entry | status | path | stale | match count |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    report.impacts.forEach((impact, index) => {
      lines.push(
        `| ${index + 1} | ${impact.runDigest} | ${escapeTableCell(impact.entryName)} | ${impact.status} | ${escapeTableCell(impact.entryPath)} | ${impact.stale ? "yes" : "no"} | ${impact.matches.length} |`,
      );
    });
    lines.push("");
    lines.push("| # | commit | status | path | previous path | reason | stale signal |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    let row = 1;
    for (const impact of report.impacts) {
      for (const match of impact.matches) {
        lines.push(
          `| ${row} | ${match.commitShortSha} | ${match.status} | ${escapeTableCell(match.path)} | ${escapeTableCell(match.previousPath ?? "-")} | ${match.reason} | ${match.staleSignal ? "yes" : "no"} |`,
        );
        row += 1;
      }
    }
  }
  lines.push("");

  lines.push("## Unmapped Changes");
  lines.push("");
  if (report.unmappedChanges.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| # | commit | status | path | previous path |");
    lines.push("| --- | --- | --- | --- | --- |");
    report.unmappedChanges.forEach((change, index) => {
      lines.push(
        `| ${index + 1} | ${change.commitShortSha} | ${change.status} | ${escapeTableCell(change.path)} | ${escapeTableCell(change.previousPath ?? "-")} |`,
      );
    });
  }
  lines.push("");

  lines.push("## Planned Batches");
  lines.push("");
  if (report.slices.length === 0) {
    lines.push("None.");
  } else {
    lines.push("| # | from commit | to commit | commit count |");
    lines.push("| --- | --- | --- | --- |");
    for (const slice of report.slices) {
      lines.push(
        `| ${slice.index + 1} | ${slice.fromCommit.slice(0, 12)} | ${slice.toCommit.slice(0, 12)} | ${slice.commitCount} |`,
      );
    }
  }
  lines.push("");

  lines.push("## Execution");
  lines.push("");
  if (!report.execution) {
    lines.push("Not executed (dry-run mode).");
  } else {
    lines.push(`- target entries: ${report.execution.targetEntries}`);
    lines.push(`- skipped stale entries: ${report.execution.skippedStaleEntries}`);
    lines.push(`- attempted entries: ${report.execution.attemptedEntries}`);
    lines.push(`- succeeded entries: ${report.execution.succeededEntries}`);
    lines.push(`- failed entries: ${report.execution.failedEntries}`);
    lines.push(
      `- rebuilt knowledge: ${report.execution.rebuiltKnowledge ? "yes" : "no"}`,
    );
    if (report.execution.failures.length > 0) {
      lines.push("");
      lines.push("### Execution Failures");
      lines.push("");
      for (const failure of report.execution.failures) {
        lines.push(`- ${failure}`);
      }
    }
  }
  lines.push("");

  lines.push("## Notes");
  lines.push("");
  for (const note of report.notes) {
    lines.push(`- ${note}`);
  }
  lines.push("");

  return `${lines.join("\n")}\n`;
}

async function gitRun(repoRootAbs: string, args: string[]): Promise<string> {
  const proc = Bun.spawn(["git", ...args], {
    cwd: repoRootAbs,
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} exited ${exitCode} in ${repoRootAbs}\nstderr:\n${stderr}`,
    );
  }
  return stdout;
}

async function writeTextIfChanged(
  outputAbs: string,
  content: string,
  force: boolean,
): Promise<void> {
  await mkdir(dirname(outputAbs), { recursive: true });
  if (!force && existsSync(outputAbs)) {
    const current = await readFile(outputAbs, "utf8");
    if (current === content) return;
  }
  await writeFile(outputAbs, content);
}

function timestampForFileName(iso: string): string {
  return iso.replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
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

function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

function normalizeRepoPath(path: string): string {
  return path
    .trim()
    .replace(/^\.\/+/, "")
    .split("\\")
    .join("/");
}

import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, normalize } from "node:path";
import { log } from "../../lib/log.ts";
import {
  AnalyzeDiagramSchema,
  AnalyzeGraphSchema,
  ArtifactsIndexSchema,
  KnowledgePackSchema,
  KnowledgeQuestionsFileSchema,
  type ArtifactIndexEntry,
  type ArtifactIndexRun,
  type ArtifactsIndex,
  type KnowledgeInsightSummary,
  type KnowledgePack,
} from "../../schemas/index.ts";

const KNOWLEDGE_PACK_FILE = "knowledge-pack.json";
const ARTIFACTS_INDEX_FILE = "artifacts-index.json";

export type KnowledgeAnswerIntent =
  | "auth-flow"
  | "permissions"
  | "data-flow"
  | "failure-debug"
  | "general";

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "does",
  "be",
  "by",
  "for",
  "from",
  "how",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "that",
  "the",
  "to",
  "what",
  "where",
  "who",
  "work",
  "why",
  "with",
  "works",
  "system",
]);

const INTENT_KEYWORDS: Record<Exclude<KnowledgeAnswerIntent, "general">, string[]> = {
  "auth-flow": [
    "auth",
    "oauth",
    "sso",
    "login",
    "logout",
    "session",
    "token",
    "impersonat",
    "firewall",
  ],
  permissions: [
    "permission",
    "role",
    "access",
    "guard",
    "rbac",
    "acl",
    "denied",
    "allow",
    "restrict",
  ],
  "data-flow": [
    "data",
    "flow",
    "fetch",
    "query",
    "mutation",
    "grpc",
    "service",
    "api",
    "state",
    "store",
  ],
  "failure-debug": [
    "error",
    "failed",
    "failure",
    "bug",
    "crash",
    "issue",
    "timeout",
    "exception",
    "debug",
    "broken",
  ],
};

interface QueryProfile {
  question: string;
  intent: KnowledgeAnswerIntent;
  tokens: string[];
  matchedIntentKeywords: string[];
}

export interface KnowledgeAnswerOptions {
  baseDir?: string;
  knowledgeRoot?: string;
  codeRoot?: string;
  question?: string;
  questionsFile?: string;
  answerOut?: string;
  outDir?: string;
  top?: number;
  emitJson?: boolean;
  force?: boolean;
}

export interface KnowledgeAnswerResult {
  knowledgeRoot: string;
  codeRoot: string;
  answers: Array<{
    question: string;
    outputPath: string;
    jsonOutputPath?: string;
  }>;
  indexPath?: string;
}

interface KnowledgeAnswerJson {
  schemaVersion: 1;
  question: string;
  questionDigest: string;
  intent: KnowledgeAnswerIntent;
  intentKeywords: string[];
  generatedAt: string;
  knowledgeRoot: string;
  codeRoot: string;
  topLimit: number;
  confidence: {
    level: "low" | "medium" | "high";
    score: number;
  };
  summary: string;
  entries: Array<{
    score: number;
    run: string;
    name: string;
    path: string;
    status: "success" | "failed";
    startHere: string;
    detail: string;
    serviceFlow: string;
    codeFile: string;
    codeExists: boolean;
    flowSignal: EntryGraphStats;
    diagramSignal: string;
    finalExcerpt: string;
    serviceFlowExcerpt: string;
    matchedTokens: string[];
  }>;
  insights: Array<{
    score: number;
    severity: "high" | "medium" | "low" | "info";
    entry: string;
    title: string;
    lens: string;
    occurrences: number;
    evidenceCount: number;
    ids: string[];
    matchedTokens: string[];
  }>;
  warnings: string[];
  limits: string[];
}

interface LoadedKnowledge {
  packPath: string;
  indexPath: string;
  pack: KnowledgePack;
  index: ArtifactsIndex;
}

interface EntryMatch {
  run: ArtifactIndexRun;
  entry: ArtifactIndexEntry;
  codePath: string;
  codeExists: boolean;
  graphStats: EntryGraphStats;
  score: number;
  matchedTokens: string[];
}

interface InsightMatch {
  insight: KnowledgeInsightSummary;
  score: number;
  matchedTokens: string[];
  occurrences: number;
  aggregatedEvidenceCount: number;
  groupedIds: string[];
}

interface EntryGraphStats {
  exists: boolean;
  edgeCount: number;
  calls: number;
  serviceCalls: number;
  routes: number;
  contextEdges: number;
  storeEdges: number;
}

interface EntryArtifactEvidence {
  finalIndexPath: string;
  finalIndexExists: boolean;
  finalIndexSnippet?: string;
  serviceFlowPath: string;
  serviceFlowExists: boolean;
  serviceFlowSnippet?: string;
  diagramsManifestPath: string;
  diagramsManifestExists: boolean;
  diagramCount: number;
  nonEmptyDiagramCount: number;
  topDiagrams: Array<{ name: string; edgeCount: number }>;
}

export async function runKnowledgeAnswer(
  options: KnowledgeAnswerOptions,
): Promise<KnowledgeAnswerResult> {
  const stage = "knowledge:answer";
  const baseDir = options.baseDir ?? process.cwd();
  const knowledgeRootInput = options.knowledgeRoot ?? ".prism/knowledge";
  const outDirInput = options.outDir ?? ".prism/knowledge/answers";
  const top = options.top ?? 8;
  const emitJson = options.emitJson === true;
  const force = options.force === true;

  if (!options.question && !options.questionsFile) {
    throw new Error("knowledge answer requires a question or questions file");
  }
  if (options.question && options.questionsFile) {
    throw new Error("knowledge answer accepts either question or questions file");
  }

  const knowledgeRootAbs = resolvePath(baseDir, knowledgeRootInput);
  const outDirAbs = resolvePath(baseDir, outDirInput);
  await mkdir(outDirAbs, { recursive: true });

  const loaded = await loadKnowledge(knowledgeRootAbs);
  const analyzeRepoRootAbs = resolveAnalyzeRepoRoot(baseDir, loaded.pack.analyzeRoot);
  const codeRootAbs = resolveCodeRoot(baseDir, loaded.pack.analyzeRoot, options.codeRoot);
  const graphStatsByEntry = await loadGraphStatsForArtifacts({
    analyzeRepoRootAbs,
    artifactsIndex: loaded.index,
  });
  const questions = await loadQuestions({
    baseDir,
    question: options.question,
    questionsFile: options.questionsFile,
  });

  log.step(
    `answering ${questions.length} question(s) from ${toDisplayPath(baseDir, knowledgeRootAbs)}`,
    stage,
  );

  const usedOutputNames = new Set<string>();
  const answers: Array<{
    question: string;
    outputPath: string;
    jsonOutputPath?: string;
  }> = [];

  for (const [index, question] of questions.entries()) {
    const outputAbs =
      options.answerOut && questions.length === 1
        ? resolvePath(baseDir, options.answerOut)
        : uniqueAnswerPath(outDirAbs, slugifyQuestion(question, index), usedOutputNames);

    const rendered = await renderAnswer({
      question,
      knowledgeRoot: toDisplayPath(baseDir, knowledgeRootAbs),
      codeRoot: toDisplayPath(baseDir, codeRootAbs),
      generatedAt: await resolveGeneratedAt([loaded.packPath, loaded.indexPath]),
      top,
      pack: loaded.pack,
      index: loaded.index,
      codeRootAbs,
      analyzeRepoRootAbs,
      graphStatsByEntry,
    });
    await writeTextIfChanged(outputAbs, rendered.markdown, force);

    let jsonOutputPath: string | undefined;
    if (emitJson) {
      const jsonPath = replaceExtension(outputAbs, ".json");
      const jsonText = `${JSON.stringify(rendered.json, null, 2)}\n`;
      await writeTextIfChanged(jsonPath, jsonText, force);
      jsonOutputPath = jsonPath;
    }

    answers.push({
      question,
      outputPath: outputAbs,
      jsonOutputPath,
    });
    usedOutputNames.add(outputAbs);
  }

  let indexPath: string | undefined;
  if (questions.length > 1) {
    const batchIndexAbs = join(outDirAbs, "index.md");
    const lines = [
      "# Prism Knowledge Answers",
      "",
      `- knowledge root: \`${toDisplayPath(baseDir, knowledgeRootAbs)}\``,
      `- answer count: ${answers.length}`,
      "",
    ];
    for (const answer of answers) {
      lines.push(
        `- ${answer.question}: \`${toDisplayPath(baseDir, answer.outputPath)}\``,
      );
    }
    lines.push("");
    await writeTextIfChanged(batchIndexAbs, lines.join("\n"), force);
    indexPath = batchIndexAbs;
  }

  return {
    knowledgeRoot: knowledgeRootAbs,
    codeRoot: codeRootAbs,
    answers,
    indexPath,
  };
}

async function loadKnowledge(knowledgeRootAbs: string): Promise<LoadedKnowledge> {
  const packPath = join(knowledgeRootAbs, KNOWLEDGE_PACK_FILE);
  const indexPath = join(knowledgeRootAbs, ARTIFACTS_INDEX_FILE);

  if (!existsSync(packPath)) {
    throw new Error(`missing knowledge pack: ${packPath}`);
  }
  if (!existsSync(indexPath)) {
    throw new Error(`missing artifacts index: ${indexPath}`);
  }

  const packRaw = JSON.parse(await readFile(packPath, "utf8"));
  const indexRaw = JSON.parse(await readFile(indexPath, "utf8"));
  const pack = KnowledgePackSchema.parse(packRaw);
  const index = ArtifactsIndexSchema.parse(indexRaw);
  return { packPath, indexPath, pack, index };
}

async function loadQuestions(input: {
  baseDir: string;
  question?: string;
  questionsFile?: string;
}): Promise<string[]> {
  if (input.question) return [input.question];
  const path = resolvePath(input.baseDir, input.questionsFile!);
  if (!existsSync(path)) {
    throw new Error(`missing questions file: ${path}`);
  }
  const raw = JSON.parse(await readFile(path, "utf8"));
  const parsed = KnowledgeQuestionsFileSchema.parse(raw);
  const questions = Array.isArray(parsed) ? parsed : parsed.questions;
  const normalized = questions
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
  if (normalized.length === 0) {
    throw new Error(`questions file has no non-empty questions: ${path}`);
  }
  return normalized;
}

async function renderAnswer(input: {
  question: string;
  knowledgeRoot: string;
  codeRoot: string;
  generatedAt: string;
  top: number;
  pack: KnowledgePack;
  index: ArtifactsIndex;
  codeRootAbs: string;
  analyzeRepoRootAbs: string;
  graphStatsByEntry: Map<string, EntryGraphStats>;
}): Promise<{ markdown: string; json: KnowledgeAnswerJson }> {
  const query = buildQueryProfile(input.question);
  const entryMatches = rankEntryMatches(
    query,
    input.index,
    input.codeRootAbs,
    input.graphStatsByEntry,
  ).slice(0, input.top);
  const insightMatches = rankInsightMatches(
    input.question,
    query.tokens,
    input.pack,
  ).slice(0, input.top);
  const artifactEvidenceByEntry = await loadArtifactEvidenceForEntries({
    entries: entryMatches,
    analyzeRepoRootAbs: input.analyzeRepoRootAbs,
    queryTokens: query.tokens,
  });
  const confidence = computeAnswerConfidence(
    entryMatches,
    insightMatches,
    artifactEvidenceByEntry,
  );
  const warnings = collectArtifactWarnings(
    entryMatches,
    artifactEvidenceByEntry,
    input.analyzeRepoRootAbs,
  );

  const questionDigest = createHash("sha1")
    .update(input.question)
    .digest("hex")
    .slice(0, 12);
  const summary = buildSummaryParagraph(
    input.question,
    query.tokens,
    entryMatches,
    insightMatches,
  );
  const limits = [
    "This answer is deterministic and grounded only in existing Prism knowledge artifacts.",
    "It does not infer facts that are absent from artifact evidence.",
    "If evidence is thin or missing, re-run `prism analyze` for additional entrypoints and rebuild knowledge.",
  ];

  const lines: string[] = [];
  lines.push("# Prism Knowledge Answer");
  lines.push("");
  lines.push(`- question: ${input.question}`);
  lines.push(`- question digest: ${questionDigest}`);
  lines.push(`- intent: ${query.intent}`);
  if (query.matchedIntentKeywords.length > 0) {
    lines.push(`- intent keywords: ${query.matchedIntentKeywords.join(", ")}`);
  }
  lines.push(`- generated at: ${input.generatedAt}`);
  lines.push(`- knowledge root: \`${input.knowledgeRoot}\``);
  lines.push(`- code root: \`${input.codeRoot}\``);
  lines.push(`- schema version: ${input.pack.schemaVersion}`);
  lines.push(`- top limit: ${input.top}`);
  lines.push(`- confidence: ${confidence.level} (${confidence.score}/100)`);
  lines.push("");
  lines.push("## Answer");
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push("## Evidence Entries");
  lines.push("");
  if (entryMatches.length === 0) {
    lines.push("No matching entries found in artifacts-index.");
  } else {
    for (const match of entryMatches) {
      const artifactEvidence =
        artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
        emptyArtifactEvidence(match.entry.finalIndex);
      lines.push(
        `- score ${match.score} | run ${match.run.configDigest} | ${match.entry.name} | ${match.entry.path}`,
      );
      lines.push(`  - status: ${match.entry.status}`);
      lines.push(`  - start_here: \`${match.entry.finalIndex}\``);
      lines.push(`  - detail: \`${match.entry.finalReport}\``);
      lines.push(
        `  - service_flow: \`${deriveServiceFlowPath(match.entry.finalIndex)}\``,
      );
      lines.push(
        `  - code_file: \`${match.codePath}\` (${match.codeExists ? "exists" : "missing"})`,
      );
      lines.push(
        `  - flow_signal: edges=${match.graphStats.edgeCount}, calls=${match.graphStats.calls}, service_calls=${match.graphStats.serviceCalls}, routes=${match.graphStats.routes}, context=${match.graphStats.contextEdges}, store=${match.graphStats.storeEdges}`,
      );
      lines.push(`  - diagram_signal: ${renderDiagramSignal(artifactEvidence)}`);
      lines.push(
        `  - final_excerpt: ${renderSnippetValue(artifactEvidence.finalIndexSnippet, artifactEvidence.finalIndexExists)}`,
      );
      lines.push(
        `  - service_flow_excerpt: ${renderSnippetValue(artifactEvidence.serviceFlowSnippet, artifactEvidence.serviceFlowExists)}`,
      );
      if (match.matchedTokens.length > 0) {
        lines.push(`  - matched tokens: ${match.matchedTokens.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Evidence Insights");
  lines.push("");
  if (insightMatches.length === 0) {
    lines.push("No matching insights found in knowledge-pack.");
  } else {
    for (const match of insightMatches) {
      lines.push(
        `- score ${match.score} | ${match.insight.severity} | ${match.insight.entry} | ${match.insight.title}`,
      );
      lines.push(
        `  - lens: ${match.insight.lens}, occurrences: ${match.occurrences}, evidence count: ${match.aggregatedEvidenceCount}, ids: ${match.groupedIds.join(", ")}`,
      );
      if (match.matchedTokens.length > 0) {
        lines.push(`  - matched tokens: ${match.matchedTokens.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Missing Artifact Warnings");
  lines.push("");
  if (warnings.length === 0) {
    lines.push("No missing artifacts detected for ranked entries.");
  } else {
    lines.push(...warnings.map((warning) => `- ${warning}`));
  }
  lines.push("");
  lines.push("## Limits");
  lines.push("");
  lines.push(...limits.map((limit) => `- ${limit}`));
  lines.push("");

  const json: KnowledgeAnswerJson = {
    schemaVersion: 1,
    question: input.question,
    questionDigest,
    intent: query.intent,
    intentKeywords: query.matchedIntentKeywords,
    generatedAt: input.generatedAt,
    knowledgeRoot: input.knowledgeRoot,
    codeRoot: input.codeRoot,
    topLimit: input.top,
    confidence,
    summary,
    entries: entryMatches.map((match) => {
      const artifactEvidence =
        artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
        emptyArtifactEvidence(match.entry.finalIndex);
      return {
        score: match.score,
        run: match.run.configDigest,
        name: match.entry.name,
        path: match.entry.path,
        status: match.entry.status,
        startHere: match.entry.finalIndex,
        detail: match.entry.finalReport,
        serviceFlow: deriveServiceFlowPath(match.entry.finalIndex),
        codeFile: match.codePath,
        codeExists: match.codeExists,
        flowSignal: match.graphStats,
        diagramSignal: renderDiagramSignal(artifactEvidence),
        finalExcerpt: renderSnippetValue(
          artifactEvidence.finalIndexSnippet,
          artifactEvidence.finalIndexExists,
        ),
        serviceFlowExcerpt: renderSnippetValue(
          artifactEvidence.serviceFlowSnippet,
          artifactEvidence.serviceFlowExists,
        ),
        matchedTokens: match.matchedTokens,
      };
    }),
    insights: insightMatches.map((match) => ({
      score: match.score,
      severity: match.insight.severity,
      entry: match.insight.entry,
      title: match.insight.title,
      lens: match.insight.lens,
      occurrences: match.occurrences,
      evidenceCount: match.aggregatedEvidenceCount,
      ids: match.groupedIds,
      matchedTokens: match.matchedTokens,
    })),
    warnings,
    limits,
  };

  return {
    markdown: `${lines.join("\n")}\n`,
    json,
  };
}

function buildSummaryParagraph(
  question: string,
  tokens: string[],
  entries: EntryMatch[],
  insights: InsightMatch[],
): string {
  if (tokens.length === 0) {
    return `No keyword tokens were extracted from "${question}", so this answer only lists raw evidence candidates.`;
  }
  if (entries.length === 0) {
    return `No high-confidence entry matches were found for tokens: ${tokens.join(", ")}. Inspect the evidence sections for nearest candidates.`;
  }
  const primary = entries[0]!;
  const related = entries.slice(1, 4).map((entry) => entry.entry.name);
  const relatedText =
    related.length > 0 ? ` Related entries: ${related.join(", ")}.` : "";
  const insightText =
    insights.length > 0
      ? ` Matched insights include: ${insights
          .slice(0, 3)
          .map((insight) => insight.insight.title)
          .join("; ")}.`
      : "";
  return `Primary evidence points to "${primary.entry.name}" (${primary.entry.path}) as the closest match for "${question}".${relatedText}${insightText}`;
}

function rankEntryMatches(
  query: QueryProfile,
  artifactsIndex: ArtifactsIndex,
  codeRootAbs: string,
  graphStatsByEntry: Map<string, EntryGraphStats>,
): EntryMatch[] {
  const normalizedQuestion = normalizeText(query.question);
  const matches: EntryMatch[] = [];

  for (const run of artifactsIndex.runs) {
    for (const entry of run.entries) {
      const haystack = normalizeText(`${entry.name} ${entry.path}`);
      const tokenMatches = query.tokens.filter((token) => haystack.includes(token));
      const codePath = resolvePath(codeRootAbs, entry.path);
      const codeExists = existsSync(codePath);
      const graphStats =
        graphStatsByEntry.get(entryRunKey(run.configDigest, entry)) ?? emptyGraphStats();
      let score = tokenMatches.length * 10;
      if (tokenMatches.length > 0 && entry.status === "success") score += 3;
      if (tokenMatches.length > 0 && codeExists) score += 2;
      if (tokenMatches.length > 0 && graphStats.exists) score += 2;
      if (
        tokenMatches.length > 0 &&
        normalizedQuestion.includes(normalizeText(entry.name))
      ) {
        score += 5;
      }
      score += scoreIntentBoost(
        query.intent,
        entry,
        haystack,
        tokenMatches,
        normalizedQuestion,
      );
      score += scoreGraphSignalBoost(query.intent, graphStats);
      if (score <= 0) continue;
      matches.push({
        run,
        entry,
        codePath,
        codeExists,
        graphStats,
        score,
        matchedTokens: tokenMatches,
      });
    }
  }

  return matches.sort(
    (a, b) =>
      b.score - a.score ||
      Number(a.entry.path.includes("/workers/")) -
        Number(b.entry.path.includes("/workers/")) ||
      a.entry.path.localeCompare(b.entry.path) ||
      a.run.configDigest.localeCompare(b.run.configDigest),
  );
}

function rankInsightMatches(
  question: string,
  tokens: string[],
  knowledgePack: KnowledgePack,
): InsightMatch[] {
  const normalizedQuestion = normalizeText(question);
  const matches: InsightMatch[] = [];

  for (const insight of knowledgePack.insights) {
    const haystack = normalizeText(
      `${insight.entry} ${insight.title} ${insight.lens} ${insight.severity} ${insight.id}`,
    );
    const tokenMatches = tokens.filter((token) => haystack.includes(token));
    let score = tokenMatches.length * 8;
    if (
      tokenMatches.length > 0 &&
      normalizedQuestion.includes(normalizeText(insight.entry))
    ) {
      score += 3;
    }
    if (score <= 0) continue;
    matches.push({
      insight,
      score,
      matchedTokens: tokenMatches,
      occurrences: 1,
      aggregatedEvidenceCount: insight.evidenceCount,
      groupedIds: [insight.id],
    });
  }

  return dedupeInsightMatches(matches).sort(
    (a, b) =>
      b.score - a.score ||
      a.insight.entry.localeCompare(b.insight.entry) ||
      a.insight.id.localeCompare(b.insight.id),
  );
}

function dedupeInsightMatches(matches: InsightMatch[]): InsightMatch[] {
  const grouped = new Map<string, InsightMatch>();
  for (const match of matches) {
    const key = `${match.insight.entry}|${match.insight.lens}|${match.insight.title}|${match.insight.severity}`;
    const current = grouped.get(key);
    if (!current) {
      grouped.set(key, { ...match });
      continue;
    }
    current.occurrences += 1;
    current.aggregatedEvidenceCount += match.insight.evidenceCount;
    current.groupedIds = [...new Set([...current.groupedIds, match.insight.id])];
    current.matchedTokens = [
      ...new Set([...current.matchedTokens, ...match.matchedTokens]),
    ];
    current.score = Math.max(current.score, match.score) + 1;
  }
  return [...grouped.values()];
}

function tokenize(input: string): string[] {
  const words = normalizeText(input)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !STOP_WORDS.has(word));
  return [...new Set(words)];
}

export function classifyIntent(question: string): KnowledgeAnswerIntent {
  const normalized = normalizeText(question);
  if (normalized.length === 0) return "general";

  // Priority matters for ambiguous prompts.
  const orderedIntents: Array<Exclude<KnowledgeAnswerIntent, "general">> = [
    "auth-flow",
    "permissions",
    "failure-debug",
    "data-flow",
  ];
  for (const intent of orderedIntents) {
    const matches = INTENT_KEYWORDS[intent].some((keyword) =>
      normalized.includes(keyword),
    );
    if (matches) return intent;
  }
  return "general";
}

function buildQueryProfile(question: string): QueryProfile {
  const intent = classifyIntent(question);
  const baseTokens = tokenize(question);
  const keywords = intent === "general" ? [] : INTENT_KEYWORDS[intent];
  const matchedIntentKeywords = keywords.filter((keyword) =>
    normalizeText(question).includes(keyword),
  );
  const tokens = [...new Set([...baseTokens, ...matchedIntentKeywords])];
  return {
    question,
    intent,
    tokens,
    matchedIntentKeywords,
  };
}

function scoreIntentBoost(
  intent: KnowledgeAnswerIntent,
  entry: ArtifactIndexEntry,
  haystack: string,
  tokenMatches: string[],
  normalizedQuestion: string,
): number {
  if (tokenMatches.length === 0) return 0;

  const path = normalizeText(entry.path);
  let score = 0;

  if (intent === "auth-flow") {
    if (
      containsAny(haystack, [
        "auth",
        "oauth",
        "sso",
        "login",
        "logout",
        "session",
        "token",
      ])
    ) {
      score += 10;
    }
    if (containsAny(haystack, ["svc-auth", "auth-service"])) score += 8;
    if (containsAny(path, ["/services/", "service"])) score += 6;
    if (containsAny(haystack, ["firewall", "permission"])) score += 4;
    if (containsAny(path, ["/workers/", ".worker", "worker"])) score -= 6;
  } else if (intent === "permissions") {
    if (
      containsAny(haystack, [
        "permission",
        "role",
        "access",
        "guard",
        "denied",
        "firewall",
      ])
    ) {
      score += 10;
    }
    if (containsAny(path, ["/context/", "/components/"])) score += 3;
    if (containsAny(path, ["/workers/"])) score -= 3;
  } else if (intent === "data-flow") {
    if (
      containsAny(haystack, ["data", "fetch", "query", "mutation", "grpc", "service"])
    ) {
      score += 8;
    }
    if (containsAny(path, ["/services/", "/core/"])) score += 5;
    if (containsAny(haystack, ["store", "zustand"])) score += 4;
  } else if (intent === "failure-debug") {
    if (entry.status === "failed") score += 10;
    if (containsAny(haystack, ["error", "failed", "exception", "timeout", "debug"]))
      score += 8;
    if (containsAny(path, ["/workers/"])) score += 3;
  }

  if (normalizedQuestion.includes(normalizeText(entry.path))) score += 3;
  return score;
}

function containsAny(haystack: string, values: string[]): boolean {
  return values.some((value) => haystack.includes(normalizeText(value)));
}

function scoreGraphSignalBoost(
  intent: KnowledgeAnswerIntent,
  graphStats: EntryGraphStats,
): number {
  if (!graphStats.exists || graphStats.edgeCount === 0) return 0;

  if (intent === "auth-flow") {
    return Math.min(8, graphStats.serviceCalls * 2 + graphStats.calls);
  }
  if (intent === "permissions") {
    return Math.min(8, graphStats.contextEdges * 2 + graphStats.routes);
  }
  if (intent === "data-flow") {
    return Math.min(8, graphStats.calls + graphStats.serviceCalls + graphStats.routes);
  }
  if (intent === "failure-debug") {
    return Math.min(6, Math.floor(graphStats.edgeCount / 4));
  }
  return Math.min(4, Math.floor(graphStats.edgeCount / 6));
}

async function loadGraphStatsForArtifacts(input: {
  analyzeRepoRootAbs: string;
  artifactsIndex: ArtifactsIndex;
}): Promise<Map<string, EntryGraphStats>> {
  const statsByEntry = new Map<string, EntryGraphStats>();

  for (const run of input.artifactsIndex.runs) {
    for (const entry of run.entries) {
      const graphPath = resolvePath(
        input.analyzeRepoRootAbs,
        `${entry.workdir}/graph/graph.json`,
      );
      const stats = await loadEntryGraphStats(graphPath);
      statsByEntry.set(entryRunKey(run.configDigest, entry), stats);
    }
  }

  return statsByEntry;
}

async function loadArtifactEvidenceForEntries(input: {
  entries: EntryMatch[];
  analyzeRepoRootAbs: string;
  queryTokens: string[];
}): Promise<Map<string, EntryArtifactEvidence>> {
  const pairs = await Promise.all(
    input.entries.map(async (match) => {
      const key = entryRunKey(match.run.configDigest, match.entry);
      const finalIndexPath = resolvePath(
        input.analyzeRepoRootAbs,
        match.entry.finalIndex,
      );
      const serviceFlowRel = deriveServiceFlowPath(match.entry.finalIndex);
      const serviceFlowPath = resolvePath(input.analyzeRepoRootAbs, serviceFlowRel);
      const diagramsManifestPath = resolvePath(
        input.analyzeRepoRootAbs,
        join(match.entry.workdir, "diagrams", "manifest.json"),
      );

      const finalIndexText = await readArtifactTextIfExists(finalIndexPath);
      const serviceFlowText = await readArtifactTextIfExists(serviceFlowPath);
      const diagrams = await loadDiagramManifest(diagramsManifestPath);

      const evidence: EntryArtifactEvidence = {
        finalIndexPath,
        finalIndexExists: finalIndexText !== undefined,
        finalIndexSnippet: buildArtifactSnippet(finalIndexText, input.queryTokens),
        serviceFlowPath,
        serviceFlowExists: serviceFlowText !== undefined,
        serviceFlowSnippet: buildArtifactSnippet(serviceFlowText, input.queryTokens),
        diagramsManifestPath,
        diagramsManifestExists: existsSync(diagramsManifestPath),
        diagramCount: diagrams.length,
        nonEmptyDiagramCount: diagrams.filter((diagram) => diagram.edgeCount > 0).length,
        topDiagrams: diagrams
          .slice()
          .sort((a, b) => b.edgeCount - a.edgeCount || a.name.localeCompare(b.name))
          .slice(0, 3)
          .map((diagram) => ({
            name: diagram.name,
            edgeCount: diagram.edgeCount,
          })),
      };
      return [key, evidence] as const;
    }),
  );

  return new Map(pairs);
}

async function loadDiagramManifest(
  diagramManifestPath: string,
): Promise<Array<{ name: string; edgeCount: number }>> {
  if (!existsSync(diagramManifestPath)) return [];
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(diagramManifestPath, "utf8"));
  } catch {
    return [];
  }
  const parsed = AnalyzeDiagramSchema.array().safeParse(raw);
  if (!parsed.success) return [];
  return parsed.data.map((diagram) => ({
    name: diagram.name,
    edgeCount: diagram.edgeCount,
  }));
}

async function readArtifactTextIfExists(path: string): Promise<string | undefined> {
  if (!existsSync(path)) return undefined;
  try {
    return await readFile(path, "utf8");
  } catch {
    return undefined;
  }
}

function buildArtifactSnippet(
  text: string | undefined,
  queryTokens: string[],
): string | undefined {
  if (!text) return undefined;
  const normalizedTokens = queryTokens.filter((token) => token.length > 0);
  const cleanedLines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .filter((line) => !line.startsWith("```"))
    .map((line) =>
      line
        .replace(/^#{1,6}\s+/, "")
        .replace(/^[-*]\s+/, "")
        .replace(/\s+/g, " ")
        .trim(),
    )
    .filter((line) => line.length > 0);

  if (cleanedLines.length === 0) return undefined;

  const matched = cleanedLines.filter((line) => {
    const normalizedLine = normalizeText(line);
    return normalizedTokens.some((token) => normalizedLine.includes(token));
  });
  const selected = (matched.length > 0 ? matched : cleanedLines).slice(0, 2);
  const merged = selected.join(" | ");
  if (merged.length <= 220) return merged;
  return `${merged.slice(0, 217).trimEnd()}...`;
}

function renderDiagramSignal(evidence: EntryArtifactEvidence): string {
  if (!evidence.diagramsManifestExists) return "diagrams manifest missing";
  if (evidence.diagramCount === 0) return "0 diagrams";
  const top =
    evidence.topDiagrams.length === 0
      ? "-"
      : evidence.topDiagrams
          .map((diagram) => `${diagram.name}(${diagram.edgeCount})`)
          .join(", ");
  return `${evidence.diagramCount} diagrams, non_empty=${evidence.nonEmptyDiagramCount}, top=${top}`;
}

function renderSnippetValue(snippet: string | undefined, fileExists: boolean): string {
  if (snippet) return snippet;
  return fileExists ? "no matching excerpt" : "file missing";
}

function computeAnswerConfidence(
  entryMatches: EntryMatch[],
  insightMatches: InsightMatch[],
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>,
): { score: number; level: "low" | "medium" | "high" } {
  if (entryMatches.length === 0) return { score: 15, level: "low" };

  const primaryScore = Math.min(40, entryMatches[0]!.score);
  const entryCountBoost = Math.min(20, entryMatches.length * 4);
  const insightBoost = Math.min(10, insightMatches.length * 2);

  let totalChecks = 0;
  let passedChecks = 0;
  for (const match of entryMatches) {
    const artifact =
      artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
      emptyArtifactEvidence(match.entry.finalIndex);
    const checks = [
      match.codeExists,
      match.graphStats.exists,
      artifact.finalIndexExists,
      artifact.serviceFlowExists,
      artifact.diagramsManifestExists,
    ];
    totalChecks += checks.length;
    passedChecks += checks.filter(Boolean).length;
  }
  const artifactCoverage =
    totalChecks === 0 ? 0 : Math.round((passedChecks / totalChecks) * 30);

  const score = clamp(
    primaryScore + entryCountBoost + insightBoost + artifactCoverage,
    0,
    100,
  );
  return {
    score,
    level: score >= 75 ? "high" : score >= 45 ? "medium" : "low",
  };
}

function collectArtifactWarnings(
  entryMatches: EntryMatch[],
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>,
  analyzeRepoRootAbs: string,
): string[] {
  const warnings = new Set<string>();
  for (const match of entryMatches) {
    const artifact =
      artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
      emptyArtifactEvidence(match.entry.finalIndex);
    const label = `${match.run.configDigest}/${match.entry.name}`;
    if (!match.codeExists) {
      warnings.add(`${label}: missing code file ${match.entry.path}`);
    }
    if (!match.graphStats.exists) {
      const graphPath = resolvePath(
        analyzeRepoRootAbs,
        `${match.entry.workdir}/graph/graph.json`,
      );
      warnings.add(`${label}: missing graph artifact ${toPosixPath(graphPath)}`);
    }
    if (!artifact.finalIndexExists) {
      warnings.add(
        `${label}: missing final index ${toPosixPath(artifact.finalIndexPath)}`,
      );
    }
    if (!artifact.serviceFlowExists) {
      warnings.add(
        `${label}: missing service-flow page ${toPosixPath(artifact.serviceFlowPath)}`,
      );
    }
    if (!artifact.diagramsManifestExists) {
      warnings.add(
        `${label}: missing diagrams manifest ${toPosixPath(artifact.diagramsManifestPath)}`,
      );
    }
  }
  return [...warnings].sort((a, b) => a.localeCompare(b));
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function toPosixPath(path: string): string {
  return path.split("\\").join("/");
}

function emptyArtifactEvidence(finalIndexPath: string): EntryArtifactEvidence {
  return {
    finalIndexPath,
    finalIndexExists: false,
    serviceFlowPath: deriveServiceFlowPath(finalIndexPath),
    serviceFlowExists: false,
    diagramsManifestPath: join(
      dirname(dirname(finalIndexPath)),
      "diagrams",
      "manifest.json",
    ),
    diagramsManifestExists: false,
    diagramCount: 0,
    nonEmptyDiagramCount: 0,
    topDiagrams: [],
  };
}

async function loadEntryGraphStats(graphPath: string): Promise<EntryGraphStats> {
  if (!existsSync(graphPath)) return emptyGraphStats();
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(graphPath, "utf8"));
  } catch {
    return emptyGraphStats();
  }
  const parsed = AnalyzeGraphSchema.safeParse(raw);
  if (!parsed.success) return emptyGraphStats();
  return summarizeGraph(parsed.data);
}

function summarizeGraph(graph: {
  nodes: Array<{ id: string; type: string }>;
  edges: Array<{ type: string; to: string }>;
}): EntryGraphStats {
  const nodeTypeById = new Map(graph.nodes.map((node) => [node.id, node.type]));
  let calls = 0;
  let serviceCalls = 0;
  let routes = 0;
  let contextEdges = 0;
  let storeEdges = 0;

  for (const edge of graph.edges) {
    if (edge.type === "calls") calls += 1;
    if (edge.type === "routes_to" || edge.type === "fallback_routes_to") routes += 1;
    if (edge.type === "uses_context" || edge.type === "provides_context")
      contextEdges += 1;
    if (
      edge.type === "uses_store" ||
      edge.type === "reads_store" ||
      edge.type === "writes_store" ||
      edge.type === "invokes_store_action"
    ) {
      storeEdges += 1;
    }
    if (edge.type === "calls" && nodeTypeById.get(edge.to) === "service") {
      serviceCalls += 1;
    }
  }

  return {
    exists: true,
    edgeCount: graph.edges.length,
    calls,
    serviceCalls,
    routes,
    contextEdges,
    storeEdges,
  };
}

function resolveAnalyzeRepoRoot(baseDir: string, analyzeRootFromPack: string): string {
  const analyzeRootAbs = resolvePath(baseDir, analyzeRootFromPack);
  if (
    basename(analyzeRootAbs) === "analyze" &&
    basename(dirname(analyzeRootAbs)) === ".tmp"
  ) {
    return dirname(dirname(analyzeRootAbs));
  }
  return baseDir;
}

function entryRunKey(runDigest: string, entry: ArtifactIndexEntry): string {
  return `${runDigest}::${entry.name}::${entry.path}`;
}

function emptyGraphStats(): EntryGraphStats {
  return {
    exists: false,
    edgeCount: 0,
    calls: 0,
    serviceCalls: 0,
    routes: 0,
    contextEdges: 0,
    storeEdges: 0,
  };
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, " ")
    .trim();
}

function deriveServiceFlowPath(finalIndexPath: string): string {
  return join(dirname(normalize(finalIndexPath)), "pages", "08-service-flow.md")
    .split("\\")
    .join("/");
}

function slugifyQuestion(question: string, index: number): string {
  const base = normalizeText(question).replace(/\s+/g, "-").replace(/-+/g, "-");
  const clean = base.replace(/^-+|-+$/g, "");
  const fallback = `question-${index + 1}`;
  return `${clean || fallback}.md`;
}

function uniqueAnswerPath(
  outDirAbs: string,
  fileName: string,
  usedOutputNames: Set<string>,
): string {
  const candidate = join(outDirAbs, fileName);
  if (!usedOutputNames.has(candidate)) return candidate;
  const extIndex = fileName.lastIndexOf(".");
  const stem = extIndex === -1 ? fileName : fileName.slice(0, extIndex);
  const ext = extIndex === -1 ? "" : fileName.slice(extIndex);
  let i = 2;
  while (true) {
    const next = join(outDirAbs, `${stem}-${i}${ext}`);
    if (!usedOutputNames.has(next)) return next;
    i += 1;
  }
}

function replaceExtension(path: string, ext: string): string {
  const dot = path.lastIndexOf(".");
  if (dot === -1) return `${path}${ext}`;
  return `${path.slice(0, dot)}${ext}`;
}

async function resolveGeneratedAt(paths: string[]): Promise<string> {
  let maxMtimeMs = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const mtimeMs = (await stat(path)).mtimeMs;
    if (mtimeMs > maxMtimeMs) maxMtimeMs = mtimeMs;
  }
  if (maxMtimeMs <= 0) return new Date(0).toISOString();
  return new Date(maxMtimeMs).toISOString();
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

function resolveCodeRoot(
  baseDir: string,
  analyzeRootFromPack: string,
  explicitCodeRoot: string | undefined,
): string {
  if (explicitCodeRoot) return resolvePath(baseDir, explicitCodeRoot);
  const analyzeRootAbs = resolvePath(baseDir, analyzeRootFromPack);
  if (
    basename(analyzeRootAbs) === "analyze" &&
    basename(dirname(analyzeRootAbs)) === ".tmp"
  ) {
    return dirname(dirname(analyzeRootAbs));
  }
  return baseDir;
}

function resolvePath(baseDir: string, path: string): string {
  if (path.startsWith("/")) return normalize(path);
  return normalize(join(baseDir, path));
}

function toDisplayPath(baseDir: string, path: string): string {
  if (path.startsWith(baseDir)) {
    const rel = path
      .slice(baseDir.length)
      .replace(/^[/\\]+/, "")
      .split("\\")
      .join("/");
    return rel === "" ? "." : rel;
  }
  return path.split("\\").join("/");
}

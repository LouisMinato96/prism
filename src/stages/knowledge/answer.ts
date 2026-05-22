import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, normalize } from "node:path";
import { log } from "../../lib/log.ts";
import {
  AnalyzeDiagramSchema,
  AnalyzeGraphSchema,
  AnalyzeRepoIndexSchema,
  ArtifactsIndexSchema,
  KnowledgePackSchema,
  KnowledgeQuestionClassificationSchema,
  KnowledgeQuestionsFileSchema,
  type ArtifactIndexEntry,
  type ArtifactIndexRun,
  type ArtifactsIndex,
  type KnowledgeInsightSummary,
  type KnowledgePack,
  type KnowledgeQuestionClass,
  type KnowledgeQuestionClassConfidence,
  type KnowledgeQuestionClassification,
} from "../../schemas/index.ts";

const KNOWLEDGE_PACK_FILE = "knowledge-pack.json";
const ARTIFACTS_INDEX_FILE = "artifacts-index.json";

export type KnowledgeAnswerIntent =
  | "auth-flow"
  | "permissions"
  | "data-flow"
  | "failure-debug"
  | "general";

type PrimaryQuestionClass = Exclude<KnowledgeQuestionClass, "unknown_or_ambiguous">;

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

const QUESTION_CLASS_ORDER: PrimaryQuestionClass[] = [
  "architecture_storyline",
  "entrypoint_trace",
  "dependency_flow",
  "building_blocks",
  "reference_lookup",
  "change_guidance",
];

const QUESTION_CLASS_TIE_BREAK: KnowledgeQuestionClass[] = [
  "reference_lookup",
  "entrypoint_trace",
  "dependency_flow",
  "architecture_storyline",
  "building_blocks",
  "change_guidance",
];

const GLOBAL_VERB_RULES: Array<{
  id: string;
  phrases: string[];
  weight: number;
  target: PrimaryQuestionClass;
}> = [
  {
    id: "verb_how",
    phrases: ["how", "how does", "explain", "overview"],
    weight: 22,
    target: "architecture_storyline",
  },
  {
    id: "verb_where",
    phrases: ["where", "located", "defined"],
    weight: 24,
    target: "reference_lookup",
  },
  {
    id: "verb_trace",
    phrases: ["start", "entry", "handle", "route", "trigger"],
    weight: 22,
    target: "entrypoint_trace",
  },
  {
    id: "verb_dep",
    phrases: ["depends", "calls", "uses", "impact"],
    weight: 22,
    target: "dependency_flow",
  },
  {
    id: "verb_parts",
    phrases: ["parts", "components", "building blocks", "made of"],
    weight: 20,
    target: "building_blocks",
  },
  {
    id: "verb_change",
    phrases: ["add", "modify", "change", "implement"],
    weight: 22,
    target: "change_guidance",
  },
];

const CLASS_PHRASE_RULES: Array<{
  id: string;
  phrases: string[];
  weight: number;
  target: PrimaryQuestionClass;
}> = [
  {
    id: "phrase_architecture",
    phrases: ["how does * work", "explain *", "architecture of *"],
    weight: 26,
    target: "architecture_storyline",
  },
  {
    id: "phrase_entrypoint",
    phrases: ["where does * start", "what handles *", "entry point for *"],
    weight: 26,
    target: "entrypoint_trace",
  },
  {
    id: "phrase_dependency",
    phrases: ["what depends on *", "what calls *", "what does * use"],
    weight: 26,
    target: "dependency_flow",
  },
  {
    id: "phrase_building",
    phrases: ["what files make up *", "components of *", "building blocks of *"],
    weight: 24,
    target: "building_blocks",
  },
  {
    id: "phrase_reference",
    phrases: ["where is * defined", "find usages of *", "references of *"],
    weight: 28,
    target: "reference_lookup",
  },
  {
    id: "phrase_change",
    phrases: [
      "how to add *",
      "how should i add *",
      "where should i modify *",
      "how to implement *",
    ],
    weight: 26,
    target: "change_guidance",
  },
];

const DOMAIN_TOPICS: Record<string, string[]> = {
  auth: INTENT_KEYWORDS["auth-flow"],
  permissions: INTENT_KEYWORDS.permissions,
  data: INTENT_KEYWORDS["data-flow"],
  failure: INTENT_KEYWORDS["failure-debug"],
};

interface QueryProfile {
  question: string;
  intent: KnowledgeAnswerIntent;
  questionClass: KnowledgeQuestionClass;
  classConfidence: KnowledgeQuestionClassConfidence;
  classScore: number;
  classDelta: number;
  classMatchedRules: string[];
  classScores: Array<{
    class: KnowledgeQuestionClass;
    score: number;
    matchedRules: string[];
  }>;
  topicCandidates: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
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
  strict?: boolean;
  minConfidence?: "low" | "medium" | "high";
  force?: boolean;
}

export interface KnowledgeAnswerResult {
  knowledgeRoot: string;
  codeRoot: string;
  answers: Array<{
    question: string;
    outputPath: string;
    jsonOutputPath?: string;
    classificationOutputPath: string;
    evidencePackOutputPath: string;
  }>;
  indexPath?: string;
  strict: {
    enabled: boolean;
    minConfidence: "low" | "medium" | "high";
    failed: boolean;
    failures: string[];
    issues: StrictIssueRecord[];
    summary: StrictSummary;
  };
}

interface KnowledgeAnswerJson {
  schemaVersion: 1;
  question: string;
  questionDigest: string;
  questionClass: KnowledgeQuestionClass;
  questionClassConfidence: KnowledgeQuestionClassConfidence;
  questionClassScore: number;
  questionClassDelta: number;
  questionClassRules: string[];
  topicCandidates: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
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
    repoSignal: {
      files: number;
      symbols: number;
      serviceSymbols: number;
      contextSymbols: number;
      storeSymbols: number;
      hookSymbols: number;
      componentSymbols: number;
      authHints: number;
      permissionHints: number;
      dataHints: number;
      debugHints: number;
    };
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
  integritySignals: {
    staleRunSignals: string[];
    contradictionSignals: string[];
    relevantSignals: string[];
  };
  evidencePack: {
    status: "complete" | "partial";
    requirements: string[];
    satisfied: string[];
    missing: string[];
    sources: Array<{
      kind: "analyze_artifact" | "code_root_file";
      path: string;
      usedFor: string[];
      exists: boolean;
      note?: string;
    }>;
    codeRootFallback: {
      used: boolean;
      maxFiles: number;
      maxBytesPerFile: number;
      scannedFiles: number;
      matchedFiles: number;
      matchedPaths: string[];
    };
  };
  failOpen: {
    triggered: boolean;
    reasons: string[];
    candidateTopics: Array<{
      label: string;
      score: number;
      reasons: string[];
    }>;
    candidateEntries: Array<{
      run: string;
      name: string;
      path: string;
      score: number;
    }>;
    missingRequirements: string[];
  };
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
  repoIndexSignals: EntryRepoIndexSignals;
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

interface EntryRepoIndexSignals {
  exists: boolean;
  fileCount: number;
  symbolCount: number;
  serviceSymbols: number;
  contextSymbols: number;
  storeSymbols: number;
  hookSymbols: number;
  componentSymbols: number;
  authHints: number;
  permissionHints: number;
  dataHints: number;
  debugHints: number;
  searchText: string;
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

interface StrictEvaluation {
  question: string;
  questionDigest: string;
  questionClass: KnowledgeQuestionClass;
  questionClassConfidence: KnowledgeQuestionClassConfidence;
  confidence: {
    level: "low" | "medium" | "high";
    score: number;
  };
  evidencePackStatus: "complete" | "partial";
  missingEvidenceRequirements: EvidenceRequirement[];
  failOpenTriggered: boolean;
  failOpenReasons: string[];
  missingCriticalArtifacts: StrictArtifactGap[];
}

type StrictFailureCategory =
  | "confidence_below_min"
  | "question_class_ambiguous"
  | "evidence_pack_incomplete"
  | "fail_open_required"
  | "missing_code_file"
  | "missing_graph"
  | "missing_repo_index"
  | "missing_final_index"
  | "missing_service_flow_page";

interface StrictArtifactGap {
  category: Exclude<StrictFailureCategory, "confidence_below_min">;
  detail: string;
}

export interface StrictIssueRecord {
  question: string;
  questionDigest: string;
  category: StrictFailureCategory;
  detail: string;
}

export interface StrictSummary {
  questionCount: number;
  failedQuestionCount: number;
  issueCount: number;
  categories: Array<{ category: StrictFailureCategory; count: number }>;
}

type EvidenceRequirement =
  | "entrypoints"
  | "building_blocks"
  | "dependency_edges"
  | "references";

interface EvidencePack {
  status: "complete" | "partial";
  requirements: EvidenceRequirement[];
  satisfied: EvidenceRequirement[];
  missing: EvidenceRequirement[];
  sources: Array<{
    kind: "analyze_artifact" | "code_root_file";
    path: string;
    usedFor: EvidenceRequirement[];
    exists: boolean;
    note?: string;
  }>;
  codeRootFallback: {
    used: boolean;
    maxFiles: number;
    maxBytesPerFile: number;
    scannedFiles: number;
    matchedFiles: number;
    matchedPaths: string[];
  };
}

interface BatchAnswerRecord {
  question: string;
  questionDigest: string;
  questionClass: KnowledgeQuestionClass;
  failOpenTriggered: boolean;
  evidencePackStatus: "complete" | "partial";
  classificationOutputPath: string;
  evidencePackOutputPath: string;
  missingEvidenceRequirements: string[];
  confidence: {
    level: "low" | "medium" | "high";
    score: number;
  };
  outputPath: string;
  jsonOutputPath?: string;
  strictIssues: StrictIssueRecord[];
}

const SECTION_ENTRY_LIMIT = 5;
const EVIDENCE_MAP_LIMIT = 8;
const HUMAN_SECTION_LIMIT = 8;
const CODE_FALLBACK_MAX_FILES = 25;
const CODE_FALLBACK_MAX_BYTES_PER_FILE = 250 * 1024;

export async function runKnowledgeAnswer(
  options: KnowledgeAnswerOptions,
): Promise<KnowledgeAnswerResult> {
  const stage = "knowledge:answer";
  const baseDir = options.baseDir ?? process.cwd();
  const knowledgeRootInput = options.knowledgeRoot ?? ".prism/knowledge";
  const outDirInput = options.outDir ?? ".prism/knowledge/answers";
  const top = options.top ?? 8;
  const emitJson = options.emitJson === true;
  const strict = options.strict === true;
  const minConfidence = options.minConfidence ?? "medium";
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
  const repoIndexSignalsByEntry = await loadRepoIndexSignalsForArtifacts({
    analyzeRepoRootAbs,
    artifactsIndex: loaded.index,
  });
  const questions = await loadQuestions({
    baseDir,
    question: options.question,
    questionsFile: options.questionsFile,
  });
  const generatedAt = await resolveGeneratedAt([loaded.packPath, loaded.indexPath]);

  log.step(
    `answering ${questions.length} question(s) from ${toDisplayPath(baseDir, knowledgeRootAbs)}`,
    stage,
  );

  const usedOutputNames = new Set<string>();
  const answers: Array<{
    question: string;
    outputPath: string;
    jsonOutputPath?: string;
    classificationOutputPath: string;
    evidencePackOutputPath: string;
  }> = [];
  const strictEvaluations: StrictEvaluation[] = [];
  const batchAnswers: BatchAnswerRecord[] = [];

  for (const [index, question] of questions.entries()) {
    const outputAbs =
      options.answerOut && questions.length === 1
        ? resolvePath(baseDir, options.answerOut)
        : uniqueAnswerPath(outDirAbs, slugifyQuestion(question, index), usedOutputNames);

    const rendered = await renderAnswer({
      question,
      knowledgeRoot: toDisplayPath(baseDir, knowledgeRootAbs),
      codeRoot: toDisplayPath(baseDir, codeRootAbs),
      generatedAt,
      top,
      pack: loaded.pack,
      index: loaded.index,
      codeRootAbs,
      analyzeRepoRootAbs,
      graphStatsByEntry,
      repoIndexSignalsByEntry,
    });
    await writeTextIfChanged(outputAbs, rendered.markdown, force);
    const classificationPath = replaceExtension(outputAbs, ".classification.json");
    const classificationText = `${JSON.stringify(rendered.classification, null, 2)}\n`;
    await writeTextIfChanged(classificationPath, classificationText, force);
    const evidencePackPath = replaceExtension(outputAbs, ".evidence-pack.json");
    const evidencePackText = `${JSON.stringify(rendered.json.evidencePack, null, 2)}\n`;
    await writeTextIfChanged(evidencePackPath, evidencePackText, force);

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
      classificationOutputPath: classificationPath,
      evidencePackOutputPath: evidencePackPath,
    });
    strictEvaluations.push(rendered.strictEvaluation);
    batchAnswers.push({
      question,
      questionDigest: rendered.json.questionDigest,
      questionClass: rendered.json.questionClass,
      failOpenTriggered: rendered.json.failOpen.triggered,
      evidencePackStatus: rendered.json.evidencePack.status,
      classificationOutputPath: classificationPath,
      evidencePackOutputPath: evidencePackPath,
      missingEvidenceRequirements: rendered.json.evidencePack.missing,
      confidence: rendered.json.confidence,
      outputPath: outputAbs,
      jsonOutputPath,
      strictIssues: strict
        ? evaluateStrictIssues(rendered.strictEvaluation, minConfidence)
        : [],
    });
    usedOutputNames.add(outputAbs);
  }

  let indexPath: string | undefined;
  if (questions.length > 1) {
    const batchIndexAbs = join(outDirAbs, "index.md");
    const strictIssueCount = batchAnswers.reduce(
      (count, answer) => count + answer.strictIssues.length,
      0,
    );
    const strictFailCount = batchAnswers.filter(
      (answer) => answer.strictIssues.length > 0,
    ).length;
    const lines = [
      "# Prism Knowledge Answers",
      "",
      `- generated at: ${generatedAt}`,
      `- knowledge root: \`${toDisplayPath(baseDir, knowledgeRootAbs)}\``,
      `- question count: ${questions.length}`,
      `- answer count: ${answers.length}`,
      `- strict mode: ${strict ? `enabled (min=${minConfidence})` : "disabled"}`,
      `- strict fail count: ${strict ? strictFailCount : 0}`,
      `- strict issue count: ${strict ? strictIssueCount : 0}`,
      "",
      "## Answers",
      "",
      "| # | digest | class | confidence | evidence | fail-open | strict | markdown | json | classification | evidence-pack | question |",
      "| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |",
    ];
    for (const [index, answer] of batchAnswers.entries()) {
      const strictCell = strict
        ? answer.strictIssues.length === 0
          ? "pass"
          : `fail(${answer.strictIssues.length})`
        : "n/a";
      const jsonCell = answer.jsonOutputPath
        ? `\`${toDisplayPath(baseDir, answer.jsonOutputPath)}\``
        : "-";
      const failOpenCell = answer.failOpenTriggered ? "yes" : "no";
      const classificationCell = `\`${toDisplayPath(baseDir, answer.classificationOutputPath)}\``;
      const evidencePackCell = `\`${toDisplayPath(baseDir, answer.evidencePackOutputPath)}\``;
      lines.push(
        `| ${index + 1} | ${answer.questionDigest} | ${answer.questionClass} | ${answer.confidence.level} (${answer.confidence.score}/100) | ${answer.evidencePackStatus} | ${failOpenCell} | ${strictCell} | \`${toDisplayPath(baseDir, answer.outputPath)}\` | ${jsonCell} | ${classificationCell} | ${evidencePackCell} | ${escapeTableCell(answer.question)} |`,
      );
    }

    const classSummary = summarizeCounts(
      batchAnswers.map((answer) => answer.questionClass),
    );
    const evidenceSummary = summarizeCounts(
      batchAnswers.map((answer) => answer.evidencePackStatus),
    );
    const followUp = batchAnswers
      .map((answer) => {
        const reasons: string[] = [];
        if (answer.questionClass === "unknown_or_ambiguous") {
          reasons.push("question_class_ambiguous");
        }
        if (answer.failOpenTriggered) {
          reasons.push("fail_open_triggered");
        }
        if (answer.evidencePackStatus === "partial") {
          reasons.push("evidence_pack_partial");
        }
        return {
          ...answer,
          reasons,
        };
      })
      .filter((answer) => answer.reasons.length > 0);

    lines.push("");
    lines.push("## Class Summary");
    lines.push("");
    lines.push("| class | count |");
    lines.push("| --- | --- |");
    for (const item of classSummary) {
      lines.push(`| ${item.key} | ${item.count} |`);
    }

    lines.push("");
    lines.push("## Evidence-Pack Summary");
    lines.push("");
    lines.push("| status | count |");
    lines.push("| --- | --- |");
    for (const item of evidenceSummary) {
      lines.push(`| ${item.key} | ${item.count} |`);
    }

    lines.push("");
    lines.push("## Needs Follow-Up");
    lines.push("");
    if (followUp.length === 0) {
      lines.push("None.");
    } else {
      lines.push("| digest | class | evidence | fail-open | reasons | question |");
      lines.push("| --- | --- | --- | --- | --- | --- |");
      for (const answer of followUp) {
        lines.push(
          `| ${answer.questionDigest} | ${answer.questionClass} | ${answer.evidencePackStatus} | ${answer.failOpenTriggered ? "yes" : "no"} | ${escapeTableCell(answer.reasons.join(", "))} | ${escapeTableCell(answer.question)} |`,
        );
      }
    }

    if (strict) {
      lines.push("");
      lines.push("## Strict Summary");
      lines.push("");
      const strictSummary = buildStrictSummary(strictEvaluations, minConfidence);
      lines.push(`- question count: ${strictSummary.questionCount}`);
      lines.push(`- failed question count: ${strictSummary.failedQuestionCount}`);
      lines.push(`- issue count: ${strictSummary.issueCount}`);
      lines.push("");
      lines.push("| category | count |");
      lines.push("| --- | --- |");
      for (const category of strictSummary.categories) {
        lines.push(`| ${category.category} | ${category.count} |`);
      }
      lines.push("");
      lines.push("## Strict Issues");
      lines.push("");
      if (strictIssueCount === 0) {
        lines.push("None.");
      } else {
        for (const answer of batchAnswers) {
          if (answer.strictIssues.length === 0) continue;
          for (const issue of answer.strictIssues) {
            lines.push(
              `- [${answer.questionDigest}] code=${issue.category} detail=${issue.detail}`,
            );
          }
        }
      }
    }
    lines.push("");
    await writeTextIfChanged(batchIndexAbs, lines.join("\n"), force);
    indexPath = batchIndexAbs;
  }

  const strictIssues =
    strict === true ? evaluateStrictFailures(strictEvaluations, minConfidence) : [];
  const strictFailures = strictIssues.map((issue) => formatStrictIssue(issue));
  const strictSummary =
    strict === true
      ? buildStrictSummary(strictEvaluations, minConfidence)
      : {
          questionCount: strictEvaluations.length,
          failedQuestionCount: 0,
          issueCount: 0,
          categories: [],
        };

  return {
    knowledgeRoot: knowledgeRootAbs,
    codeRoot: codeRootAbs,
    answers,
    indexPath,
    strict: {
      enabled: strict,
      minConfidence,
      failed: strictFailures.length > 0,
      failures: strictFailures,
      issues: strictIssues,
      summary: strictSummary,
    },
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
  repoIndexSignalsByEntry: Map<string, EntryRepoIndexSignals>;
}): Promise<{
  markdown: string;
  json: KnowledgeAnswerJson;
  classification: KnowledgeQuestionClassification;
  strictEvaluation: StrictEvaluation;
}> {
  const query = buildQueryProfile(input.question);
  const entryMatches = rankEntryMatches(
    query,
    input.index,
    input.codeRootAbs,
    input.graphStatsByEntry,
    input.repoIndexSignalsByEntry,
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
  const evidencePack = await buildEvidencePack({
    query,
    entryMatches,
    artifactEvidenceByEntry,
    codeRootAbs: input.codeRootAbs,
    analyzeRepoRootAbs: input.analyzeRepoRootAbs,
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
  const staleRunSignals = input.index.integritySignals?.staleRunSignals ?? [];
  const contradictionSignals = input.index.integritySignals?.contradictionSignals ?? [];
  const relevantSignals = selectRelevantIntegritySignals(
    entryMatches,
    staleRunSignals,
    contradictionSignals,
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
  const failOpen = buildFailOpenDecision({
    query,
    confidence,
    evidencePack,
    entryMatches,
  });
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
  lines.push(`- question class: ${query.questionClass}`);
  lines.push(
    `- class confidence: ${query.classConfidence} (score=${query.classScore}, delta=${query.classDelta})`,
  );
  if (query.classMatchedRules.length > 0) {
    lines.push(`- class rules: ${query.classMatchedRules.join(", ")}`);
  }
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
  lines.push(`- evidence pack: ${evidencePack.status}`);
  lines.push(`- requirements: ${evidencePack.requirements.join(", ")}`);
  lines.push(`- satisfied: ${evidencePack.satisfied.join(", ") || "none"}`);
  lines.push(`- missing: ${evidencePack.missing.join(", ") || "none"}`);
  lines.push(`- fail-open: ${failOpen.triggered ? "triggered" : "not-triggered"}`);
  lines.push("");
  lines.push("## Executive Answer");
  lines.push("");
  lines.push(summary);
  lines.push("");
  lines.push(
    ...renderHumanFirstSections({
      questionClass: query.questionClass,
      topicCandidates: query.topicCandidates,
      entries: entryMatches,
      insights: insightMatches,
      warnings,
      evidencePack,
      artifactEvidenceByEntry,
    }),
  );
  if (failOpen.triggered) {
    lines.push("");
    lines.push("## Fail-Open Guidance");
    lines.push("");
    lines.push(...renderFailOpenGuidance(failOpen));
  }
  lines.push("");
  lines.push("## Raw Evidence Appendix");
  lines.push("");
  lines.push("## Auth Flow");
  lines.push("");
  lines.push(
    ...renderSectionEntries({
      entries: selectSectionEntries(entryMatches, isAuthFlowEntry, SECTION_ENTRY_LIMIT),
      emptyMessage: "No auth flow evidence found in ranked entries.",
      artifactEvidenceByEntry,
    }),
  );
  lines.push("");
  lines.push("## Guards & Permissions");
  lines.push("");
  lines.push(
    ...renderSectionEntries({
      entries: selectSectionEntries(entryMatches, isPermissionEntry, SECTION_ENTRY_LIMIT),
      emptyMessage: "No guard or permission evidence found in ranked entries.",
      artifactEvidenceByEntry,
    }),
  );
  lines.push("");
  lines.push("## Failure Paths");
  lines.push("");
  lines.push(
    ...renderSectionEntries({
      entries: selectSectionEntries(entryMatches, isFailureEntry, SECTION_ENTRY_LIMIT),
      emptyMessage: "No failure-focused entries found in ranked evidence.",
      artifactEvidenceByEntry,
    }),
  );
  const failureInsights = insightMatches
    .filter((match) => isFailureInsight(match.insight))
    .slice(0, 3);
  if (failureInsights.length > 0) {
    lines.push("");
    lines.push("Failure-related insights:");
    for (const insight of failureInsights) {
      lines.push(
        `- ${insight.insight.entry} | ${insight.insight.severity} | ${insight.insight.title} | occurrences=${insight.occurrences} | evidence=${insight.aggregatedEvidenceCount}`,
      );
    }
  }
  lines.push("");
  lines.push("## Evidence Map");
  lines.push("");
  const evidenceMapRows = entryMatches.slice(0, EVIDENCE_MAP_LIMIT);
  if (evidenceMapRows.length === 0) {
    lines.push("No entries available for evidence map.");
  } else {
    lines.push("| rank | run | entry | status | path | start_here | detail |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    for (const [index, match] of evidenceMapRows.entries()) {
      lines.push(
        `| ${index + 1} | ${match.run.configDigest} | ${match.entry.name} | ${match.entry.status} | ${match.entry.path} | \`${match.entry.finalIndex}\` | \`${match.entry.finalReport}\` |`,
      );
    }
    lines.push(
      `Showing ${evidenceMapRows.length} of ${entryMatches.length} ranked entries.`,
    );
  }
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
      lines.push(`  - repo_signal: ${renderRepoSignal(match.repoIndexSignals)}`);
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
  lines.push("## Evidence Pack");
  lines.push("");
  lines.push(`- status: ${evidencePack.status}`);
  lines.push(`- requirements: ${evidencePack.requirements.join(", ")}`);
  lines.push(`- satisfied: ${evidencePack.satisfied.join(", ") || "none"}`);
  lines.push(`- missing: ${evidencePack.missing.join(", ") || "none"}`);
  lines.push(
    `- code-root fallback: used=${evidencePack.codeRootFallback.used}, scanned=${evidencePack.codeRootFallback.scannedFiles}, matched=${evidencePack.codeRootFallback.matchedFiles}, limits=(max_files=${evidencePack.codeRootFallback.maxFiles}, max_bytes=${evidencePack.codeRootFallback.maxBytesPerFile})`,
  );
  if (evidencePack.codeRootFallback.matchedPaths.length > 0) {
    lines.push(
      `- fallback matched paths: ${evidencePack.codeRootFallback.matchedPaths.join(", ")}`,
    );
  }
  lines.push("");
  lines.push("## Staleness & Contradiction Signals");
  lines.push("");
  lines.push(
    `- stale signals: ${staleRunSignals.length}, contradiction signals: ${contradictionSignals.length}, relevant signals: ${relevantSignals.length}`,
  );
  if (relevantSignals.length === 0) {
    lines.push("No relevant stale/contradiction signals for ranked entries.");
  } else {
    lines.push(...relevantSignals.map((signal) => `- ${signal}`));
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
    questionClass: query.questionClass,
    questionClassConfidence: query.classConfidence,
    questionClassScore: query.classScore,
    questionClassDelta: query.classDelta,
    questionClassRules: query.classMatchedRules,
    topicCandidates: query.topicCandidates,
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
        repoSignal: {
          files: match.repoIndexSignals.fileCount,
          symbols: match.repoIndexSignals.symbolCount,
          serviceSymbols: match.repoIndexSignals.serviceSymbols,
          contextSymbols: match.repoIndexSignals.contextSymbols,
          storeSymbols: match.repoIndexSignals.storeSymbols,
          hookSymbols: match.repoIndexSignals.hookSymbols,
          componentSymbols: match.repoIndexSignals.componentSymbols,
          authHints: match.repoIndexSignals.authHints,
          permissionHints: match.repoIndexSignals.permissionHints,
          dataHints: match.repoIndexSignals.dataHints,
          debugHints: match.repoIndexSignals.debugHints,
        },
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
    integritySignals: {
      staleRunSignals,
      contradictionSignals,
      relevantSignals,
    },
    evidencePack: {
      status: evidencePack.status,
      requirements: evidencePack.requirements,
      satisfied: evidencePack.satisfied,
      missing: evidencePack.missing,
      sources: evidencePack.sources.map((source) => ({
        kind: source.kind,
        path: source.path,
        usedFor: source.usedFor,
        exists: source.exists,
        note: source.note,
      })),
      codeRootFallback: evidencePack.codeRootFallback,
    },
    failOpen: {
      triggered: failOpen.triggered,
      reasons: failOpen.reasons,
      candidateTopics: failOpen.candidateTopics,
      candidateEntries: failOpen.candidateEntries,
      missingRequirements: failOpen.missingRequirements,
    },
    limits,
  };

  const classification = KnowledgeQuestionClassificationSchema.parse({
    schemaVersion: 1 as const,
    generatedAt: input.generatedAt,
    question: input.question,
    questionDigest,
    normalizedQuestion: normalizeText(input.question),
    class: query.questionClass,
    confidence: query.classConfidence,
    score: query.classScore,
    delta: query.classDelta,
    matchedRules: query.classMatchedRules,
    classScores: query.classScores,
    topicCandidates: query.topicCandidates,
  });

  return {
    markdown: `${lines.join("\n")}\n`,
    json,
    classification,
    strictEvaluation: {
      question: input.question,
      questionDigest,
      questionClass: query.questionClass,
      questionClassConfidence: query.classConfidence,
      confidence,
      evidencePackStatus: evidencePack.status,
      missingEvidenceRequirements: evidencePack.missing,
      failOpenTriggered: failOpen.triggered,
      failOpenReasons: failOpen.reasons,
      missingCriticalArtifacts: collectCriticalArtifactGaps(
        entryMatches,
        artifactEvidenceByEntry,
      ),
    },
  };
}

async function buildEvidencePack(input: {
  query: QueryProfile;
  entryMatches: EntryMatch[];
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>;
  codeRootAbs: string;
  analyzeRepoRootAbs: string;
}): Promise<EvidencePack> {
  const requirements = requirementsForQuestionClass(input.query.questionClass);
  const coverage = evaluateAnalyzeCoverage({
    requirements,
    entryMatches: input.entryMatches,
    artifactEvidenceByEntry: input.artifactEvidenceByEntry,
    analyzeRepoRootAbs: input.analyzeRepoRootAbs,
  });
  let missing = requirements.filter(
    (requirement) => !coverage.satisfied.has(requirement),
  );
  const fallback = await runBoundedCodeRootFallback({
    missing,
    query: input.query,
    codeRootAbs: input.codeRootAbs,
    entryMatches: input.entryMatches,
  });

  for (const requirement of fallback.satisfied) {
    coverage.satisfied.add(requirement);
  }
  missing = requirements.filter((requirement) => !coverage.satisfied.has(requirement));

  return {
    status: missing.length === 0 ? "complete" : "partial",
    requirements,
    satisfied: [...coverage.satisfied].sort((a, b) => a.localeCompare(b)),
    missing,
    sources: [...coverage.sources, ...fallback.sources].sort(
      (a, b) =>
        a.kind.localeCompare(b.kind) ||
        a.path.localeCompare(b.path) ||
        a.usedFor.join(",").localeCompare(b.usedFor.join(",")),
    ),
    codeRootFallback: fallback.stats,
  };
}

function requirementsForQuestionClass(
  questionClass: KnowledgeQuestionClass,
): EvidenceRequirement[] {
  if (questionClass === "architecture_storyline") {
    return ["entrypoints", "building_blocks", "dependency_edges", "references"];
  }
  if (questionClass === "entrypoint_trace") {
    return ["entrypoints", "dependency_edges", "references"];
  }
  if (questionClass === "dependency_flow") {
    return ["dependency_edges", "references"];
  }
  if (questionClass === "building_blocks") {
    return ["building_blocks", "references"];
  }
  if (questionClass === "reference_lookup") {
    return ["references"];
  }
  if (questionClass === "change_guidance") {
    return ["entrypoints", "building_blocks", "references"];
  }
  return ["references"];
}

function evaluateAnalyzeCoverage(input: {
  requirements: EvidenceRequirement[];
  entryMatches: EntryMatch[];
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>;
  analyzeRepoRootAbs: string;
}): {
  satisfied: Set<EvidenceRequirement>;
  sources: EvidencePack["sources"];
} {
  const satisfied = new Set<EvidenceRequirement>();
  const sources: EvidencePack["sources"] = [];

  const bestEntries = input.entryMatches.slice(0, Math.max(1, EVIDENCE_MAP_LIMIT));
  for (const match of bestEntries) {
    const artifact =
      input.artifactEvidenceByEntry.get(
        entryRunKey(match.run.configDigest, match.entry),
      ) ?? emptyArtifactEvidence(match.entry.finalIndex);

    const graphPath = resolvePath(
      input.analyzeRepoRootAbs,
      `${match.entry.workdir}/graph/graph.json`,
    );
    const repoIndexPath = resolvePath(input.analyzeRepoRootAbs, match.entry.repoIndex);
    const finalIndexPath = resolvePath(input.analyzeRepoRootAbs, match.entry.finalIndex);
    const finalReportPath = resolvePath(
      input.analyzeRepoRootAbs,
      match.entry.finalReport,
    );

    sources.push({
      kind: "analyze_artifact",
      path: toPosixPath(finalIndexPath),
      usedFor: ["entrypoints", "references"],
      exists: artifact.finalIndexExists,
      note: `${match.run.configDigest}/${match.entry.name}`,
    });
    sources.push({
      kind: "analyze_artifact",
      path: toPosixPath(finalReportPath),
      usedFor: ["references"],
      exists: existsSync(finalReportPath),
      note: `${match.run.configDigest}/${match.entry.name}`,
    });
    sources.push({
      kind: "analyze_artifact",
      path: toPosixPath(repoIndexPath),
      usedFor: ["building_blocks"],
      exists: match.repoIndexSignals.exists,
      note: `${match.run.configDigest}/${match.entry.name}`,
    });
    sources.push({
      kind: "analyze_artifact",
      path: toPosixPath(graphPath),
      usedFor: ["dependency_edges"],
      exists: match.graphStats.exists,
      note: `${match.run.configDigest}/${match.entry.name}`,
    });

    if (artifact.finalIndexExists) {
      satisfied.add("entrypoints");
      satisfied.add("references");
    }
    if (match.repoIndexSignals.exists && match.repoIndexSignals.symbolCount > 0) {
      satisfied.add("building_blocks");
      satisfied.add("references");
    }
    if (match.graphStats.exists && match.graphStats.edgeCount > 0) {
      satisfied.add("dependency_edges");
      satisfied.add("references");
    }
    if (match.codeExists) {
      sources.push({
        kind: "code_root_file",
        path: toPosixPath(match.codePath),
        usedFor: ["references"],
        exists: true,
        note: `${match.run.configDigest}/${match.entry.name}`,
      });
      satisfied.add("references");
    }
  }

  return {
    satisfied: new Set(
      [...satisfied].filter((requirement) => input.requirements.includes(requirement)),
    ),
    sources,
  };
}

async function runBoundedCodeRootFallback(input: {
  missing: EvidenceRequirement[];
  query: QueryProfile;
  codeRootAbs: string;
  entryMatches: EntryMatch[];
}): Promise<{
  satisfied: Set<EvidenceRequirement>;
  sources: EvidencePack["sources"];
  stats: EvidencePack["codeRootFallback"];
}> {
  const required = new Set(input.missing);
  const satisfied = new Set<EvidenceRequirement>();
  const sources: EvidencePack["sources"] = [];
  const stats: EvidencePack["codeRootFallback"] = {
    used: required.size > 0,
    maxFiles: CODE_FALLBACK_MAX_FILES,
    maxBytesPerFile: CODE_FALLBACK_MAX_BYTES_PER_FILE,
    scannedFiles: 0,
    matchedFiles: 0,
    matchedPaths: [],
  };
  if (required.size === 0) {
    return { satisfied, sources, stats };
  }

  const candidates = buildCodeFallbackCandidates({
    query: input.query,
    codeRootAbs: input.codeRootAbs,
    entryMatches: input.entryMatches,
  }).slice(0, CODE_FALLBACK_MAX_FILES);

  for (const candidate of candidates) {
    if (!existsSync(candidate)) continue;
    stats.scannedFiles += 1;
    let text: string;
    try {
      text = await readFile(candidate, "utf8");
    } catch {
      continue;
    }
    const bounded = text.slice(0, CODE_FALLBACK_MAX_BYTES_PER_FILE);
    const normalized = normalizeText(bounded);
    const tokens = input.query.tokens;
    const tokenMatchCount = tokens.reduce(
      (count, token) => (normalized.includes(token) ? count + 1 : count),
      0,
    );
    const usedFor: EvidenceRequirement[] = [];
    if (required.has("references") && tokenMatchCount > 0) {
      usedFor.push("references");
      satisfied.add("references");
    }
    if (
      required.has("entrypoints") &&
      containsAny(normalized, ["export default", "route"])
    ) {
      usedFor.push("entrypoints");
      satisfied.add("entrypoints");
    }
    if (
      required.has("building_blocks") &&
      containsAny(normalized, ["class ", "function ", "const ", "interface ", "type "])
    ) {
      usedFor.push("building_blocks");
      satisfied.add("building_blocks");
    }
    if (
      required.has("dependency_edges") &&
      containsAny(normalized, ["import ", "from ", "use", "call", "service"])
    ) {
      usedFor.push("dependency_edges");
      satisfied.add("dependency_edges");
    }

    if (usedFor.length > 0) {
      stats.matchedFiles += 1;
      stats.matchedPaths.push(toPosixPath(candidate));
      sources.push({
        kind: "code_root_file",
        path: toPosixPath(candidate),
        usedFor: [...new Set(usedFor)].sort((a, b) => a.localeCompare(b)),
        exists: true,
        note: `token_matches=${tokenMatchCount}`,
      });
    }

    const remaining = [...required].filter((item) => !satisfied.has(item));
    if (remaining.length === 0) break;
  }

  return { satisfied, sources, stats };
}

function buildCodeFallbackCandidates(input: {
  query: QueryProfile;
  codeRootAbs: string;
  entryMatches: EntryMatch[];
}): string[] {
  const result: string[] = [];
  const seen = new Set<string>();

  const add = (path: string) => {
    if (seen.has(path)) return;
    seen.add(path);
    result.push(path);
  };

  for (const candidate of tokenizeRawQuestion(input.query.question)) {
    if (!isPathLikeToken(candidate)) continue;
    const resolved = resolvePath(input.codeRootAbs, candidate);
    add(resolved);
  }

  for (const match of input.entryMatches) {
    add(match.codePath);
    if (result.length >= CODE_FALLBACK_MAX_FILES) break;
  }

  return result;
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

function renderHumanFirstSections(input: {
  questionClass: KnowledgeQuestionClass;
  topicCandidates: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
  entries: EntryMatch[];
  insights: InsightMatch[];
  warnings: string[];
  evidencePack: EvidencePack;
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>;
}): string[] {
  const lines: string[] = [];
  lines.push(...renderHowToReadSection(input));

  if (input.questionClass === "unknown_or_ambiguous") {
    lines.push("");
    lines.push("## Candidate Focus Areas");
    lines.push("");
    if (input.topicCandidates.length === 0) {
      lines.push("No strong candidates detected.");
    } else {
      for (const candidate of input.topicCandidates.slice(0, HUMAN_SECTION_LIMIT)) {
        lines.push(
          `- ${candidate.label} | score=${candidate.score} | reasons=${candidate.reasons.join(", ")}`,
        );
      }
      if (input.topicCandidates.length > HUMAN_SECTION_LIMIT) {
        lines.push(
          `- showing ${HUMAN_SECTION_LIMIT} of ${input.topicCandidates.length} candidates`,
        );
      }
    }
    lines.push("");
    lines.push("## Gaps / Uncertainty");
    lines.push("");
    lines.push(...renderGapsList(input.evidencePack, input.warnings));
    lines.push("");
    lines.push("## Proof References");
    lines.push("");
    lines.push(
      ...renderProofReferences(
        input.entries,
        input.artifactEvidenceByEntry,
        HUMAN_SECTION_LIMIT,
      ),
    );
    return lines;
  }

  if (
    input.questionClass === "architecture_storyline" ||
    input.questionClass === "change_guidance"
  ) {
    lines.push("");
    lines.push("## Entry Files");
    lines.push("");
    lines.push(...renderEntryFilesList(input.entries, HUMAN_SECTION_LIMIT));
    lines.push("");
    lines.push("## Core Building Blocks");
    lines.push("");
    lines.push(...renderBuildingBlocksList(input.entries, HUMAN_SECTION_LIMIT));
    lines.push("");
    lines.push("## Dependency / Control Flow");
    lines.push("");
    lines.push(...renderDependencyFlowList(input.entries, HUMAN_SECTION_LIMIT));
  } else if (input.questionClass === "entrypoint_trace") {
    lines.push("");
    lines.push("## Entry Files");
    lines.push("");
    lines.push(...renderEntryFilesList(input.entries, HUMAN_SECTION_LIMIT));
    lines.push("");
    lines.push("## Dependency / Control Flow");
    lines.push("");
    lines.push(...renderDependencyFlowList(input.entries, HUMAN_SECTION_LIMIT));
  } else if (input.questionClass === "dependency_flow") {
    lines.push("");
    lines.push("## Dependency / Control Flow");
    lines.push("");
    lines.push(...renderDependencyFlowList(input.entries, HUMAN_SECTION_LIMIT));
    lines.push("");
    lines.push("## Entry Files");
    lines.push("");
    lines.push(...renderEntryFilesList(input.entries, HUMAN_SECTION_LIMIT));
  } else if (input.questionClass === "building_blocks") {
    lines.push("");
    lines.push("## Core Building Blocks");
    lines.push("");
    lines.push(...renderBuildingBlocksList(input.entries, HUMAN_SECTION_LIMIT));
    lines.push("");
    lines.push("## Entry Files");
    lines.push("");
    lines.push(...renderEntryFilesList(input.entries, HUMAN_SECTION_LIMIT));
  } else if (input.questionClass === "reference_lookup") {
    lines.push("");
    lines.push("## Entry Files");
    lines.push("");
    lines.push(...renderEntryFilesList(input.entries, HUMAN_SECTION_LIMIT));
  }

  lines.push("");
  lines.push("## Failure Paths");
  lines.push("");
  lines.push(...renderFailurePathNarrative(input.entries, input.insights));
  lines.push("");
  lines.push("## Gaps / Uncertainty");
  lines.push("");
  lines.push(...renderGapsList(input.evidencePack, input.warnings));
  lines.push("");
  lines.push("## Proof References");
  lines.push("");
  lines.push(
    ...renderProofReferences(
      input.entries,
      input.artifactEvidenceByEntry,
      HUMAN_SECTION_LIMIT,
    ),
  );

  return lines;
}

function renderHowToReadSection(input: {
  questionClass: KnowledgeQuestionClass;
  evidencePack: EvidencePack;
}): string[] {
  const lines = ["## How To Read This Answer", ""];
  const mode = input.questionClass;
  lines.push(
    `- mode: ${mode}; evidence status: ${input.evidencePack.status}; requirements: ${input.evidencePack.requirements.join(", ")}`,
  );
  if (mode === "architecture_storyline") {
    lines.push(
      "- Read in order: Entry Files -> Core Building Blocks -> Dependency / Control Flow -> Failure Paths -> Proof References.",
    );
  } else if (mode === "entrypoint_trace") {
    lines.push(
      "- Read in order: Entry Files -> Dependency / Control Flow -> Proof References.",
    );
  } else if (mode === "dependency_flow") {
    lines.push(
      "- Read in order: Dependency / Control Flow -> Entry Files -> Proof References.",
    );
  } else if (mode === "building_blocks") {
    lines.push(
      "- Read in order: Core Building Blocks -> Entry Files -> Proof References.",
    );
  } else if (mode === "reference_lookup") {
    lines.push("- Read in order: Entry Files -> Proof References.");
  } else if (mode === "change_guidance") {
    lines.push(
      "- Read in order: Entry Files -> Core Building Blocks -> Dependency / Control Flow -> Gaps / Uncertainty -> Proof References.",
    );
  } else {
    lines.push(
      "- Classification is ambiguous; inspect Candidate Focus Areas then Proof References.",
    );
  }
  return lines;
}

function renderEntryFilesList(entries: EntryMatch[], limit: number): string[] {
  if (entries.length === 0) return ["No ranked entry files available."];
  const selected = entries.slice(0, limit);
  const lines = selected.map(
    (match, index) =>
      `${index + 1}. \`${match.entry.path}\` (${match.entry.name}, run=${match.run.configDigest}, status=${match.entry.status})`,
  );
  if (entries.length > limit) {
    lines.push(`- showing ${limit} of ${entries.length} ranked entries`);
  }
  return lines;
}

function renderBuildingBlocksList(entries: EntryMatch[], limit: number): string[] {
  if (entries.length === 0) return ["No building-block signals available."];
  const selected = entries.slice(0, limit);
  const lines = selected.map((match) => {
    const repo = match.repoIndexSignals;
    return `- ${match.entry.name}: files=${repo.fileCount}, symbols=${repo.symbolCount}, service=${repo.serviceSymbols}, hooks=${repo.hookSymbols}, components=${repo.componentSymbols}`;
  });
  if (entries.length > limit) {
    lines.push(`- showing ${limit} of ${entries.length} ranked entries`);
  }
  return lines;
}

function renderDependencyFlowList(entries: EntryMatch[], limit: number): string[] {
  if (entries.length === 0) return ["No dependency-flow signals available."];
  const selected = entries.slice(0, limit);
  const lines = selected.map((match) => {
    const graph = match.graphStats;
    return `- ${match.entry.name}: edges=${graph.edgeCount}, calls=${graph.calls}, service_calls=${graph.serviceCalls}, routes=${graph.routes}, context_edges=${graph.contextEdges}, store_edges=${graph.storeEdges}`;
  });
  if (entries.length > limit) {
    lines.push(`- showing ${limit} of ${entries.length} ranked entries`);
  }
  return lines;
}

function renderFailurePathNarrative(
  entries: EntryMatch[],
  insights: InsightMatch[],
): string[] {
  const failedEntries = entries.filter((entry) => entry.entry.status === "failed");
  const failureInsights = insights.filter((insight) => isFailureInsight(insight.insight));
  const lines: string[] = [];
  if (failedEntries.length === 0 && failureInsights.length === 0) {
    return ["No failure-focused evidence surfaced in top-ranked entries."];
  }
  for (const entry of failedEntries.slice(0, HUMAN_SECTION_LIMIT)) {
    lines.push(
      `- failed entry: ${entry.entry.name} (${entry.entry.path}) run=${entry.run.configDigest}`,
    );
  }
  for (const insight of failureInsights.slice(0, HUMAN_SECTION_LIMIT)) {
    lines.push(
      `- insight: ${insight.insight.title} (${insight.insight.severity}) in ${insight.insight.entry}`,
    );
  }
  return lines;
}

function renderGapsList(evidencePack: EvidencePack, warnings: string[]): string[] {
  const lines: string[] = [];
  if (evidencePack.missing.length === 0 && warnings.length === 0) {
    return ["No explicit evidence gaps for the current requirements."];
  }
  for (const missing of evidencePack.missing) {
    lines.push(`- missing requirement: ${missing}`);
  }
  for (const warning of warnings.slice(0, HUMAN_SECTION_LIMIT)) {
    lines.push(`- warning: ${warning}`);
  }
  if (warnings.length > HUMAN_SECTION_LIMIT) {
    lines.push(`- showing ${HUMAN_SECTION_LIMIT} of ${warnings.length} warnings`);
  }
  return lines;
}

function renderProofReferences(
  entries: EntryMatch[],
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>,
  limit: number,
): string[] {
  if (entries.length === 0) return ["No proof references available."];
  const selected = entries.slice(0, limit);
  const lines: string[] = [];
  for (const match of selected) {
    const artifact =
      artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
      emptyArtifactEvidence(match.entry.finalIndex);
    lines.push(
      `- ${match.entry.name}: start_here=\`${match.entry.finalIndex}\`, detail=\`${match.entry.finalReport}\`, service_flow=\`${deriveServiceFlowPath(match.entry.finalIndex)}\`, code_file=\`${match.codePath}\` (${match.codeExists ? "exists" : "missing"}), final_excerpt=${renderSnippetValue(artifact.finalIndexSnippet, artifact.finalIndexExists)}`,
    );
  }
  if (entries.length > limit) {
    lines.push(`- showing ${limit} of ${entries.length} ranked references`);
  }
  return lines;
}

function buildFailOpenDecision(input: {
  query: QueryProfile;
  confidence: { level: "low" | "medium" | "high"; score: number };
  evidencePack: EvidencePack;
  entryMatches: EntryMatch[];
}): {
  triggered: boolean;
  reasons: string[];
  candidateTopics: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
  candidateEntries: Array<{
    run: string;
    name: string;
    path: string;
    score: number;
  }>;
  missingRequirements: string[];
} {
  const reasons: string[] = [];
  if (input.query.questionClass === "unknown_or_ambiguous") {
    reasons.push("question_class_ambiguous");
  }
  if (input.query.classConfidence === "none") {
    reasons.push("class_confidence_none");
  }
  if (input.evidencePack.status === "partial") {
    reasons.push("evidence_pack_partial");
  }
  if (input.confidence.level === "low") {
    reasons.push("answer_confidence_low");
  }
  const triggered = reasons.length > 0;
  return {
    triggered,
    reasons,
    candidateTopics: input.query.topicCandidates.slice(0, HUMAN_SECTION_LIMIT),
    candidateEntries: input.entryMatches.slice(0, HUMAN_SECTION_LIMIT).map((entry) => ({
      run: entry.run.configDigest,
      name: entry.entry.name,
      path: entry.entry.path,
      score: entry.score,
    })),
    missingRequirements: input.evidencePack.missing,
  };
}

function renderFailOpenGuidance(input: {
  triggered: boolean;
  reasons: string[];
  candidateTopics: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
  candidateEntries: Array<{
    run: string;
    name: string;
    path: string;
    score: number;
  }>;
  missingRequirements: string[];
}): string[] {
  if (!input.triggered) {
    return ["Fail-open not required."];
  }
  const lines: string[] = [];
  lines.push(`- reasons: ${input.reasons.join(", ")}`);
  if (input.missingRequirements.length > 0) {
    lines.push(`- missing requirements: ${input.missingRequirements.join(", ")}`);
  }
  lines.push("- candidate topics:");
  if (input.candidateTopics.length === 0) {
    lines.push("  - none");
  } else {
    for (const candidate of input.candidateTopics) {
      lines.push(
        `  - ${candidate.label} (score=${candidate.score}, reasons=${candidate.reasons.join(", ")})`,
      );
    }
  }
  lines.push("- candidate entries:");
  if (input.candidateEntries.length === 0) {
    lines.push("  - none");
  } else {
    for (const entry of input.candidateEntries) {
      lines.push(
        `  - ${entry.name} | ${entry.path} | run=${entry.run} | score=${entry.score}`,
      );
    }
  }
  lines.push(
    "- next query suggestion: specify a concrete file path, symbol, or exact subsystem name.",
  );
  return lines;
}

function selectSectionEntries(
  entries: EntryMatch[],
  predicate: (entry: EntryMatch) => boolean,
  limit: number,
): EntryMatch[] {
  const selected: EntryMatch[] = [];
  const seen = new Set<string>();
  for (const entry of entries) {
    if (!predicate(entry)) continue;
    const key = `${entry.run.configDigest}:${entry.entry.path}`;
    if (seen.has(key)) continue;
    selected.push(entry);
    seen.add(key);
    if (selected.length >= limit) break;
  }
  return selected;
}

function renderSectionEntries(input: {
  entries: EntryMatch[];
  emptyMessage: string;
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>;
}): string[] {
  if (input.entries.length === 0) return [input.emptyMessage];
  const lines: string[] = [];
  for (const match of input.entries) {
    const artifact =
      input.artifactEvidenceByEntry.get(
        entryRunKey(match.run.configDigest, match.entry),
      ) ?? emptyArtifactEvidence(match.entry.finalIndex);
    lines.push(
      `- ${match.entry.name} | ${match.entry.path} | score=${match.score} | status=${match.entry.status}`,
    );
    lines.push(
      `  - run=${match.run.configDigest}, service_calls=${match.graphStats.serviceCalls}, context_edges=${match.graphStats.contextEdges}, auth_hints=${match.repoIndexSignals.authHints}, permission_hints=${match.repoIndexSignals.permissionHints}, debug_hints=${match.repoIndexSignals.debugHints}`,
    );
    lines.push(
      `  - refs: start_here=\`${match.entry.finalIndex}\`, detail=\`${match.entry.finalReport}\`, service_flow=\`${deriveServiceFlowPath(match.entry.finalIndex)}\`, final_excerpt=${renderSnippetValue(artifact.finalIndexSnippet, artifact.finalIndexExists)}`,
    );
  }
  return lines;
}

function isAuthFlowEntry(match: EntryMatch): boolean {
  const haystack = normalizeText(`${match.entry.name} ${match.entry.path}`);
  return (
    containsAny(haystack, INTENT_KEYWORDS["auth-flow"]) ||
    match.repoIndexSignals.authHints > 0
  );
}

function isPermissionEntry(match: EntryMatch): boolean {
  const haystack = normalizeText(`${match.entry.name} ${match.entry.path}`);
  return (
    containsAny(haystack, INTENT_KEYWORDS.permissions) ||
    match.repoIndexSignals.permissionHints > 0 ||
    match.graphStats.contextEdges > 0
  );
}

function isFailureEntry(match: EntryMatch): boolean {
  const haystack = normalizeText(`${match.entry.name} ${match.entry.path}`);
  return (
    match.entry.status === "failed" ||
    containsAny(haystack, INTENT_KEYWORDS["failure-debug"]) ||
    match.repoIndexSignals.debugHints > 0
  );
}

function isFailureInsight(insight: KnowledgeInsightSummary): boolean {
  const haystack = normalizeText(
    `${insight.title} ${insight.lens} ${insight.entry} ${insight.severity}`,
  );
  return (
    containsAny(haystack, INTENT_KEYWORDS["failure-debug"]) || insight.severity === "high"
  );
}

function selectRelevantIntegritySignals(
  entries: EntryMatch[],
  staleRunSignals: string[],
  contradictionSignals: string[],
): string[] {
  const all = [...staleRunSignals, ...contradictionSignals].sort((a, b) =>
    a.localeCompare(b),
  );
  if (all.length === 0) return [];

  const needles = new Set<string>();
  for (const entry of entries) {
    needles.add(normalizeText(entry.entry.name));
    needles.add(normalizeText(entry.entry.path));
    needles.add(normalizeText(entry.run.configDigest));
  }
  const normalizedNeedles = [...needles].filter((value) => value.length > 0);

  const matched = all.filter((signal) => {
    const normalized = normalizeText(signal);
    return normalizedNeedles.some(
      (needle) => needle.length > 0 && normalized.includes(needle),
    );
  });
  if (matched.length > 0) return matched.slice(0, 12);
  return all.slice(0, 6);
}

function rankEntryMatches(
  query: QueryProfile,
  artifactsIndex: ArtifactsIndex,
  codeRootAbs: string,
  graphStatsByEntry: Map<string, EntryGraphStats>,
  repoIndexSignalsByEntry: Map<string, EntryRepoIndexSignals>,
): EntryMatch[] {
  const normalizedQuestion = normalizeText(query.question);
  const matches: EntryMatch[] = [];

  for (const run of artifactsIndex.runs) {
    for (const entry of run.entries) {
      const repoIndexSignals =
        repoIndexSignalsByEntry.get(entryRunKey(run.configDigest, entry)) ??
        emptyRepoIndexSignals();
      const haystack = normalizeText(
        `${entry.name} ${entry.path} ${repoIndexSignals.searchText}`,
      );
      const tokenMatches = query.tokens.filter((token) => haystack.includes(token));
      const codePath = resolvePath(codeRootAbs, entry.path);
      const codeExists = existsSync(codePath);
      const graphStats =
        graphStatsByEntry.get(entryRunKey(run.configDigest, entry)) ?? emptyGraphStats();
      let score = tokenMatches.length * 10;
      if (tokenMatches.length > 0 && entry.status === "success") score += 3;
      if (tokenMatches.length > 0 && codeExists) score += 2;
      if (tokenMatches.length > 0 && graphStats.exists) score += 2;
      if (tokenMatches.length > 0 && repoIndexSignals.exists) score += 1;
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
      score += scoreRepoIndexSignalBoost(query.intent, repoIndexSignals);
      if (score <= 0) continue;
      matches.push({
        run,
        entry,
        codePath,
        codeExists,
        graphStats,
        repoIndexSignals,
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

function classifyQuestion(question: string): {
  questionClass: KnowledgeQuestionClass;
  confidence: KnowledgeQuestionClassConfidence;
  score: number;
  delta: number;
  matchedRules: string[];
  classScores: Array<{
    class: KnowledgeQuestionClass;
    score: number;
    matchedRules: string[];
  }>;
  topicCandidates: Array<{
    label: string;
    score: number;
    reasons: string[];
  }>;
} {
  const normalizedQuestion = normalizeText(question);
  const rawTokens = tokenizeRawQuestion(question);
  const normalizedTokens = tokenize(question);
  const hasPathAnchor = rawTokens.some(isPathLikeToken);
  const hasSymbolAnchor = rawTokens.some(isSymbolLikeToken);
  const hasRouteAnchor = rawTokens.some(isRouteLikeToken);
  const topicCandidates = buildTopicCandidates(rawTokens, normalizedTokens);
  const hasDomainTopic = topicCandidates.some((candidate) =>
    candidate.reasons.some((reason) => reason.startsWith("domain-token:")),
  );

  const classScores = new Map<PrimaryQuestionClass, number>();
  const classMatchedRules = new Map<PrimaryQuestionClass, string[]>();
  for (const cls of QUESTION_CLASS_ORDER) {
    classScores.set(cls, 0);
    classMatchedRules.set(cls, []);
  }

  let matchedVerbSignal = false;
  for (const rule of GLOBAL_VERB_RULES) {
    if (matchesAnyPhrase(normalizedQuestion, rule.phrases)) {
      matchedVerbSignal = true;
      applyQuestionClassRule(
        classScores,
        classMatchedRules,
        rule.target,
        rule.weight,
        rule.id,
      );
    }
  }

  for (const rule of CLASS_PHRASE_RULES) {
    if (matchesAnyWildcardPhrase(normalizedQuestion, rule.phrases)) {
      applyQuestionClassRule(
        classScores,
        classMatchedRules,
        rule.target,
        rule.weight,
        rule.id,
      );
    }
  }

  if (hasPathAnchor) {
    applyQuestionClassRule(
      classScores,
      classMatchedRules,
      "reference_lookup",
      18,
      "path_anchor:reference_lookup",
    );
    applyQuestionClassRule(
      classScores,
      classMatchedRules,
      "dependency_flow",
      8,
      "path_anchor:dependency_flow",
    );
  }

  if (hasSymbolAnchor) {
    applyQuestionClassRule(
      classScores,
      classMatchedRules,
      "reference_lookup",
      16,
      "symbol_anchor:reference_lookup",
    );
    applyQuestionClassRule(
      classScores,
      classMatchedRules,
      "dependency_flow",
      10,
      "symbol_anchor:dependency_flow",
    );
  }

  if (hasRouteAnchor) {
    applyQuestionClassRule(
      classScores,
      classMatchedRules,
      "entrypoint_trace",
      16,
      "route_anchor:entrypoint_trace",
    );
  }

  if (hasDomainTopic) {
    for (const cls of QUESTION_CLASS_ORDER) {
      applyQuestionClassRule(classScores, classMatchedRules, cls, 8, "domain_token:all");
    }
  }

  if (normalizedTokens.length < 2) {
    for (const cls of QUESTION_CLASS_ORDER) {
      applyQuestionClassRule(
        classScores,
        classMatchedRules,
        cls,
        -20,
        "penalty:short_question",
      );
    }
  }

  if (!matchedVerbSignal && !hasPathAnchor && !hasSymbolAnchor && !hasRouteAnchor) {
    for (const cls of QUESTION_CLASS_ORDER) {
      applyQuestionClassRule(
        classScores,
        classMatchedRules,
        cls,
        -18,
        "penalty:no_signal",
      );
    }
  }

  const scored = QUESTION_CLASS_ORDER.map((cls) => ({
    class: cls,
    score: classScores.get(cls) ?? 0,
    matchedRules: (classMatchedRules.get(cls) ?? [])
      .slice()
      .sort((a, b) => a.localeCompare(b)),
  })).sort(
    (a, b) =>
      b.score - a.score || questionClassRank(a.class) - questionClassRank(b.class),
  );

  const top = scored[0] ?? {
    class: "architecture_storyline" as PrimaryQuestionClass,
    score: 0,
    matchedRules: [],
  };
  const second = scored[1] ?? {
    class: "entrypoint_trace" as PrimaryQuestionClass,
    score: 0,
    matchedRules: [],
  };
  const delta = Math.max(0, top.score - second.score);

  let questionClass: KnowledgeQuestionClass = top.class;
  if (top.score < 28) {
    questionClass = "unknown_or_ambiguous";
  } else if (top.score === second.score) {
    questionClass = breakClassTie(top.class, second.class);
  } else if (delta <= 4) {
    questionClass = "unknown_or_ambiguous";
  }

  let confidence: KnowledgeQuestionClassConfidence = "none";
  if (questionClass !== "unknown_or_ambiguous") {
    if (top.score >= 52 && delta >= 12) {
      confidence = "high";
    } else if (top.score >= 40 && delta >= 8) {
      confidence = "medium";
    } else if (top.score >= 28 && delta >= 5) {
      confidence = "low";
    } else {
      confidence = "none";
      questionClass = "unknown_or_ambiguous";
    }
  }

  const classScoreRows: Array<{
    class: KnowledgeQuestionClass;
    score: number;
    matchedRules: string[];
  }> = scored.map((item) => ({
    class: item.class,
    score: item.score,
    matchedRules: item.matchedRules,
  }));
  classScoreRows.push({
    class: "unknown_or_ambiguous",
    score: questionClass === "unknown_or_ambiguous" ? top.score : 0,
    matchedRules:
      questionClass === "unknown_or_ambiguous"
        ? ["selection:ambiguous_or_below_threshold"]
        : [],
  });

  return {
    questionClass,
    confidence,
    score: top.score,
    delta,
    matchedRules:
      questionClass === "unknown_or_ambiguous"
        ? ["selection:ambiguous_or_below_threshold"]
        : top.matchedRules,
    classScores: classScoreRows.sort(
      (a, b) =>
        b.score - a.score || questionClassRank(a.class) - questionClassRank(b.class),
    ),
    topicCandidates,
  };
}

function buildQueryProfile(question: string): QueryProfile {
  const classified = classifyQuestion(question);
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
    questionClass: classified.questionClass,
    classConfidence: classified.confidence,
    classScore: classified.score,
    classDelta: classified.delta,
    classMatchedRules: classified.matchedRules,
    classScores: classified.classScores,
    topicCandidates: classified.topicCandidates,
    tokens,
    matchedIntentKeywords,
  };
}

export function classifyQuestionClass(question: string): KnowledgeQuestionClass {
  return classifyQuestion(question).questionClass;
}

function tokenizeRawQuestion(question: string): string[] {
  return question
    .split(/\s+/)
    .map((token) => token.trim())
    .map((token) => token.replace(/^[`"'([{]+|[`"')\]}:;,.!?]+$/g, ""))
    .filter((token) => token.length > 0);
}

function isPathLikeToken(token: string): boolean {
  return /[\\/]/.test(token) || /\.(tsx?|jsx?|md|json)$/i.test(token);
}

function isSymbolLikeToken(token: string): boolean {
  return (
    /^use[A-Z][A-Za-z0-9_]*$/.test(token) ||
    /^[A-Z][A-Za-z0-9_]+$/.test(token) ||
    /^[a-z]+[A-Z][A-Za-z0-9_]*$/.test(token) ||
    /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*$/.test(token)
  );
}

function isRouteLikeToken(token: string): boolean {
  const normalized = normalizeText(token);
  return (
    normalized.includes("/api") ||
    normalized.includes("route") ||
    normalized.includes("endpoint") ||
    normalized.includes("pages/")
  );
}

function matchesAnyPhrase(normalizedQuestion: string, phrases: string[]): boolean {
  return phrases.some((phrase) => normalizedQuestion.includes(normalizeText(phrase)));
}

function matchesAnyWildcardPhrase(
  normalizedQuestion: string,
  phrases: string[],
): boolean {
  return phrases.some((phrase) => {
    const parts = phrase
      .split("*")
      .map((part) => normalizeText(part))
      .filter((part) => part.length > 0);
    if (parts.length === 0) return false;
    let index = 0;
    for (const part of parts) {
      const next = normalizedQuestion.indexOf(part, index);
      if (next === -1) return false;
      index = next + part.length;
    }
    return true;
  });
}

function applyQuestionClassRule(
  classScores: Map<PrimaryQuestionClass, number>,
  classMatchedRules: Map<PrimaryQuestionClass, string[]>,
  cls: PrimaryQuestionClass,
  delta: number,
  ruleId: string,
): void {
  classScores.set(cls, (classScores.get(cls) ?? 0) + delta);
  const rules = classMatchedRules.get(cls) ?? [];
  rules.push(ruleId);
  classMatchedRules.set(cls, rules);
}

function questionClassRank(cls: KnowledgeQuestionClass): number {
  const tieRank = QUESTION_CLASS_TIE_BREAK.indexOf(cls);
  if (tieRank !== -1) return tieRank;
  return QUESTION_CLASS_TIE_BREAK.length + 1;
}

function breakClassTie(
  a: PrimaryQuestionClass,
  b: PrimaryQuestionClass,
): KnowledgeQuestionClass {
  return questionClassRank(a) <= questionClassRank(b) ? a : b;
}

function buildTopicCandidates(
  rawTokens: string[],
  normalizedTokens: string[],
): Array<{ label: string; score: number; reasons: string[] }> {
  const candidates = new Map<
    string,
    {
      label: string;
      score: number;
      reasons: Set<string>;
    }
  >();

  const pushCandidate = (label: string, score: number, reason: string) => {
    const existing = candidates.get(label);
    if (!existing) {
      candidates.set(label, {
        label,
        score,
        reasons: new Set([reason]),
      });
      return;
    }
    existing.score += score;
    existing.reasons.add(reason);
  };

  for (const token of rawTokens) {
    if (isPathLikeToken(token)) {
      pushCandidate(`path:${token}`, 14, "path-anchor");
    }
    if (isSymbolLikeToken(token)) {
      pushCandidate(`symbol:${token}`, 12, "symbol-anchor");
    }
    if (isRouteLikeToken(token)) {
      pushCandidate(`route:${token}`, 10, "route-anchor");
    }
  }

  for (const [topic, keywords] of Object.entries(DOMAIN_TOPICS)) {
    let hits = 0;
    for (const token of normalizedTokens) {
      if (keywords.some((keyword) => token.includes(normalizeText(keyword)))) {
        hits += 1;
        pushCandidate(topic, 10, `domain-token:${token}`);
      }
    }
    if (hits > 0) {
      pushCandidate(topic, hits * 2, "domain-topic");
    }
  }

  for (const token of normalizedTokens.slice(0, 3)) {
    pushCandidate(token, 6, "query-token");
  }

  return [...candidates.values()]
    .map((candidate) => ({
      label: candidate.label,
      score: candidate.score,
      reasons: [...candidate.reasons].sort((a, b) => a.localeCompare(b)),
    }))
    .sort((a, b) => b.score - a.score || a.label.localeCompare(b.label))
    .slice(0, 5);
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

function scoreRepoIndexSignalBoost(
  intent: KnowledgeAnswerIntent,
  repoSignals: EntryRepoIndexSignals,
): number {
  if (!repoSignals.exists) return 0;

  if (intent === "auth-flow") {
    return Math.min(
      10,
      repoSignals.authHints * 2 +
        repoSignals.serviceSymbols +
        Math.floor(repoSignals.hookSymbols / 2),
    );
  }
  if (intent === "permissions") {
    return Math.min(
      10,
      repoSignals.permissionHints * 2 +
        repoSignals.contextSymbols +
        Math.floor(repoSignals.componentSymbols / 3),
    );
  }
  if (intent === "data-flow") {
    return Math.min(
      10,
      repoSignals.dataHints +
        repoSignals.serviceSymbols +
        Math.floor(repoSignals.storeSymbols / 2),
    );
  }
  if (intent === "failure-debug") {
    return Math.min(8, repoSignals.debugHints + Math.floor(repoSignals.symbolCount / 20));
  }
  return Math.min(4, Math.floor(repoSignals.symbolCount / 30));
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

async function loadRepoIndexSignalsForArtifacts(input: {
  analyzeRepoRootAbs: string;
  artifactsIndex: ArtifactsIndex;
}): Promise<Map<string, EntryRepoIndexSignals>> {
  const signalsByEntry = new Map<string, EntryRepoIndexSignals>();

  for (const run of input.artifactsIndex.runs) {
    for (const entry of run.entries) {
      const repoIndexPath = resolvePath(input.analyzeRepoRootAbs, entry.repoIndex);
      const signals = await loadEntryRepoIndexSignals(repoIndexPath);
      signalsByEntry.set(entryRunKey(run.configDigest, entry), signals);
    }
  }

  return signalsByEntry;
}

async function loadEntryRepoIndexSignals(
  repoIndexPath: string,
): Promise<EntryRepoIndexSignals> {
  if (!existsSync(repoIndexPath)) return emptyRepoIndexSignals();
  let raw: unknown;
  try {
    raw = JSON.parse(await readFile(repoIndexPath, "utf8"));
  } catch {
    return emptyRepoIndexSignals();
  }
  const parsed = AnalyzeRepoIndexSchema.safeParse(raw);
  if (!parsed.success) return emptyRepoIndexSignals();
  return summarizeRepoIndexSignals(parsed.data);
}

function summarizeRepoIndexSignals(repoIndex: {
  fileCount: number;
  symbolCount: number;
  typeCounts: Record<string, number>;
  files: Array<{
    path: string;
    symbols: Array<{ name: string }>;
    exportedSymbols: string[];
  }>;
}): EntryRepoIndexSignals {
  const searchableParts: string[] = [];
  const authKeywords = [
    "auth",
    "oauth",
    "sso",
    "login",
    "logout",
    "session",
    "token",
    "impersonat",
    "firewall",
  ];
  const permissionKeywords = [
    "permission",
    "role",
    "access",
    "guard",
    "rbac",
    "acl",
    "denied",
    "allow",
    "restrict",
  ];
  const dataKeywords = [
    "data",
    "fetch",
    "query",
    "mutation",
    "grpc",
    "service",
    "api",
    "store",
    "state",
  ];
  const debugKeywords = [
    "error",
    "failed",
    "failure",
    "bug",
    "crash",
    "timeout",
    "debug",
  ];

  let authHints = 0;
  let permissionHints = 0;
  let dataHints = 0;
  let debugHints = 0;

  for (const file of repoIndex.files) {
    searchableParts.push(file.path);
    authHints += keywordHits(file.path, authKeywords);
    permissionHints += keywordHits(file.path, permissionKeywords);
    dataHints += keywordHits(file.path, dataKeywords);
    debugHints += keywordHits(file.path, debugKeywords);

    for (const symbol of file.symbols) {
      searchableParts.push(symbol.name);
      authHints += keywordHits(symbol.name, authKeywords);
      permissionHints += keywordHits(symbol.name, permissionKeywords);
      dataHints += keywordHits(symbol.name, dataKeywords);
      debugHints += keywordHits(symbol.name, debugKeywords);
    }
    for (const name of file.exportedSymbols) {
      searchableParts.push(name);
      authHints += keywordHits(name, authKeywords);
      permissionHints += keywordHits(name, permissionKeywords);
      dataHints += keywordHits(name, dataKeywords);
      debugHints += keywordHits(name, debugKeywords);
    }
  }

  const serviceSymbols = repoIndex.typeCounts.service ?? 0;
  const contextSymbols = repoIndex.typeCounts.context ?? 0;
  const storeSymbols =
    (repoIndex.typeCounts.store ?? 0) +
    (repoIndex.typeCounts.store_state ?? 0) +
    (repoIndex.typeCounts.store_getter ?? 0) +
    (repoIndex.typeCounts.store_action ?? 0);
  const hookSymbols = repoIndex.typeCounts.hook ?? 0;
  const componentSymbols = repoIndex.typeCounts.component ?? 0;

  return {
    exists: true,
    fileCount: repoIndex.fileCount,
    symbolCount: repoIndex.symbolCount,
    serviceSymbols,
    contextSymbols,
    storeSymbols,
    hookSymbols,
    componentSymbols,
    authHints,
    permissionHints,
    dataHints,
    debugHints,
    searchText: searchableParts.join(" "),
  };
}

function keywordHits(input: string, keywords: string[]): number {
  const normalized = normalizeText(input);
  return keywords.reduce(
    (count, keyword) => (normalized.includes(normalizeText(keyword)) ? count + 1 : count),
    0,
  );
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

function renderRepoSignal(signals: EntryRepoIndexSignals): string {
  if (!signals.exists) return "repo-index missing";
  return `files=${signals.fileCount}, symbols=${signals.symbolCount}, service=${signals.serviceSymbols}, context=${signals.contextSymbols}, store=${signals.storeSymbols}, auth_hints=${signals.authHints}, permission_hints=${signals.permissionHints}`;
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
      match.repoIndexSignals.exists,
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

function collectCriticalArtifactGaps(
  entryMatches: EntryMatch[],
  artifactEvidenceByEntry: Map<string, EntryArtifactEvidence>,
): StrictArtifactGap[] {
  const gaps = new Map<string, StrictArtifactGap>();
  for (const match of entryMatches) {
    const artifact =
      artifactEvidenceByEntry.get(entryRunKey(match.run.configDigest, match.entry)) ??
      emptyArtifactEvidence(match.entry.finalIndex);
    const label = `${match.run.configDigest}/${match.entry.name}`;
    if (!match.codeExists) {
      const gap: StrictArtifactGap = {
        category: "missing_code_file",
        detail: `${label}: missing code file`,
      };
      gaps.set(`${gap.category}:${gap.detail}`, gap);
    }
    if (!match.graphStats.exists) {
      const gap: StrictArtifactGap = {
        category: "missing_graph",
        detail: `${label}: missing graph`,
      };
      gaps.set(`${gap.category}:${gap.detail}`, gap);
    }
    if (!match.repoIndexSignals.exists) {
      const gap: StrictArtifactGap = {
        category: "missing_repo_index",
        detail: `${label}: missing repo-index`,
      };
      gaps.set(`${gap.category}:${gap.detail}`, gap);
    }
    if (!artifact.finalIndexExists) {
      const gap: StrictArtifactGap = {
        category: "missing_final_index",
        detail: `${label}: missing final index`,
      };
      gaps.set(`${gap.category}:${gap.detail}`, gap);
    }
    if (!artifact.serviceFlowExists) {
      const gap: StrictArtifactGap = {
        category: "missing_service_flow_page",
        detail: `${label}: missing service-flow page`,
      };
      gaps.set(`${gap.category}:${gap.detail}`, gap);
    }
  }
  return [...gaps.values()].sort(
    (a, b) => a.category.localeCompare(b.category) || a.detail.localeCompare(b.detail),
  );
}

function evaluateStrictFailures(
  evaluations: StrictEvaluation[],
  minConfidence: "low" | "medium" | "high",
): StrictIssueRecord[] {
  return evaluations.flatMap((evaluation) =>
    evaluateStrictIssues(evaluation, minConfidence),
  );
}

function evaluateStrictIssues(
  evaluation: StrictEvaluation,
  minConfidence: "low" | "medium" | "high",
): StrictIssueRecord[] {
  const issues: StrictIssueRecord[] = [];
  if (evaluation.questionClass === "unknown_or_ambiguous") {
    issues.push({
      question: evaluation.question,
      questionDigest: evaluation.questionDigest,
      category: "question_class_ambiguous",
      detail: `question class ${evaluation.questionClass} with class confidence ${evaluation.questionClassConfidence}`,
    });
  }
  if (evaluation.evidencePackStatus === "partial") {
    issues.push({
      question: evaluation.question,
      questionDigest: evaluation.questionDigest,
      category: "evidence_pack_incomplete",
      detail:
        evaluation.missingEvidenceRequirements.length === 0
          ? "evidence pack marked partial"
          : `missing requirements: ${evaluation.missingEvidenceRequirements.join(", ")}`,
    });
  }
  if (evaluation.failOpenTriggered) {
    issues.push({
      question: evaluation.question,
      questionDigest: evaluation.questionDigest,
      category: "fail_open_required",
      detail: `fail-open triggered: ${evaluation.failOpenReasons.join(", ")}`,
    });
  }
  const minRank = confidenceRank(minConfidence);
  if (confidenceRank(evaluation.confidence.level) < minRank) {
    issues.push({
      question: evaluation.question,
      questionDigest: evaluation.questionDigest,
      category: "confidence_below_min",
      detail: `confidence ${evaluation.confidence.level} (${evaluation.confidence.score}/100) below required ${minConfidence}`,
    });
  }
  for (const gap of evaluation.missingCriticalArtifacts) {
    issues.push({
      question: evaluation.question,
      questionDigest: evaluation.questionDigest,
      category: gap.category,
      detail: gap.detail,
    });
  }
  return issues;
}

function buildStrictSummary(
  evaluations: StrictEvaluation[],
  minConfidence: "low" | "medium" | "high",
): StrictSummary {
  const issues = evaluateStrictFailures(evaluations, minConfidence);
  const byQuestion = new Set(issues.map((issue) => issue.questionDigest));
  const byCategory = new Map<StrictFailureCategory, number>();
  for (const issue of issues) {
    byCategory.set(issue.category, (byCategory.get(issue.category) ?? 0) + 1);
  }
  return {
    questionCount: evaluations.length,
    failedQuestionCount: byQuestion.size,
    issueCount: issues.length,
    categories: [...byCategory.entries()]
      .map(([category, count]) => ({ category, count }))
      .sort((a, b) => a.category.localeCompare(b.category) || b.count - a.count),
  };
}

function formatStrictIssue(issue: StrictIssueRecord): string {
  return `[${issue.category}] ${issue.question}: ${issue.detail}`;
}

function confidenceRank(level: "low" | "medium" | "high"): number {
  if (level === "high") return 3;
  if (level === "medium") return 2;
  return 1;
}

function summarizeCounts(values: string[]): Array<{ key: string; count: number }> {
  const map = new Map<string, number>();
  for (const value of values) {
    map.set(value, (map.get(value) ?? 0) + 1);
  }
  return [...map.entries()]
    .map(([key, count]) => ({ key, count }))
    .sort((a, b) => a.key.localeCompare(b.key) || a.count - b.count);
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
    if (!match.repoIndexSignals.exists) {
      const repoIndexPath = resolvePath(analyzeRepoRootAbs, match.entry.repoIndex);
      warnings.add(`${label}: missing repo-index artifact ${toPosixPath(repoIndexPath)}`);
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

function escapeTableCell(value: string): string {
  return value.replaceAll("|", "\\|").replace(/\r?\n/g, " ").trim();
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

function emptyRepoIndexSignals(): EntryRepoIndexSignals {
  return {
    exists: false,
    fileCount: 0,
    symbolCount: 0,
    serviceSymbols: 0,
    contextSymbols: 0,
    storeSymbols: 0,
    hookSymbols: 0,
    componentSymbols: 0,
    authHints: 0,
    permissionHints: 0,
    dataHints: 0,
    debugHints: 0,
    searchText: "",
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

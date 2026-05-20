import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { basename, dirname, join, normalize } from "node:path";
import { log } from "../../lib/log.ts";
import {
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

export interface KnowledgeAnswerOptions {
  baseDir?: string;
  knowledgeRoot?: string;
  codeRoot?: string;
  question?: string;
  questionsFile?: string;
  answerOut?: string;
  outDir?: string;
  top?: number;
  force?: boolean;
}

export interface KnowledgeAnswerResult {
  knowledgeRoot: string;
  codeRoot: string;
  answers: Array<{
    question: string;
    outputPath: string;
  }>;
  indexPath?: string;
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
  score: number;
  matchedTokens: string[];
}

interface InsightMatch {
  insight: KnowledgeInsightSummary;
  score: number;
  matchedTokens: string[];
}

export async function runKnowledgeAnswer(
  options: KnowledgeAnswerOptions,
): Promise<KnowledgeAnswerResult> {
  const stage = "knowledge:answer";
  const baseDir = options.baseDir ?? process.cwd();
  const knowledgeRootInput = options.knowledgeRoot ?? ".prism/knowledge";
  const outDirInput = options.outDir ?? ".prism/knowledge/answers";
  const top = options.top ?? 8;
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
  const codeRootAbs = resolveCodeRoot(baseDir, loaded.pack.analyzeRoot, options.codeRoot);
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
  const answers: Array<{ question: string; outputPath: string }> = [];

  for (const [index, question] of questions.entries()) {
    const outputAbs =
      options.answerOut && questions.length === 1
        ? resolvePath(baseDir, options.answerOut)
        : uniqueAnswerPath(outDirAbs, slugifyQuestion(question, index), usedOutputNames);

    const content = renderAnswer({
      question,
      knowledgeRoot: toDisplayPath(baseDir, knowledgeRootAbs),
      codeRoot: toDisplayPath(baseDir, codeRootAbs),
      generatedAt: await resolveGeneratedAt([loaded.packPath, loaded.indexPath]),
      top,
      pack: loaded.pack,
      index: loaded.index,
      codeRootAbs,
    });
    await writeTextIfChanged(outputAbs, content, force);
    answers.push({
      question,
      outputPath: outputAbs,
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

function renderAnswer(input: {
  question: string;
  knowledgeRoot: string;
  codeRoot: string;
  generatedAt: string;
  top: number;
  pack: KnowledgePack;
  index: ArtifactsIndex;
  codeRootAbs: string;
}): string {
  const tokens = tokenize(input.question);
  const entryMatches = rankEntryMatches(
    input.question,
    tokens,
    input.index,
    input.codeRootAbs,
  ).slice(0, input.top);
  const insightMatches = rankInsightMatches(input.question, tokens, input.pack).slice(
    0,
    input.top,
  );

  const questionDigest = createHash("sha1")
    .update(input.question)
    .digest("hex")
    .slice(0, 12);

  const lines: string[] = [];
  lines.push("# Prism Knowledge Answer");
  lines.push("");
  lines.push(`- question: ${input.question}`);
  lines.push(`- question digest: ${questionDigest}`);
  lines.push(`- generated at: ${input.generatedAt}`);
  lines.push(`- knowledge root: \`${input.knowledgeRoot}\``);
  lines.push(`- code root: \`${input.codeRoot}\``);
  lines.push(`- schema version: ${input.pack.schemaVersion}`);
  lines.push(`- top limit: ${input.top}`);
  lines.push("");
  lines.push("## Answer");
  lines.push("");
  lines.push(buildSummaryParagraph(input.question, tokens, entryMatches, insightMatches));
  lines.push("");
  lines.push("## Evidence Entries");
  lines.push("");
  if (entryMatches.length === 0) {
    lines.push("No matching entries found in artifacts-index.");
  } else {
    for (const match of entryMatches) {
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
        `  - lens: ${match.insight.lens}, evidence count: ${match.insight.evidenceCount}, id: ${match.insight.id}`,
      );
      if (match.matchedTokens.length > 0) {
        lines.push(`  - matched tokens: ${match.matchedTokens.join(", ")}`);
      }
    }
  }
  lines.push("");
  lines.push("## Limits");
  lines.push("");
  lines.push(
    "- This answer is deterministic and grounded only in existing Prism knowledge artifacts.",
  );
  lines.push("- It does not infer facts that are absent from artifact evidence.");
  lines.push(
    "- If evidence is thin or missing, re-run `prism analyze` for additional entrypoints and rebuild knowledge.",
  );
  lines.push("");

  return `${lines.join("\n")}\n`;
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
  question: string,
  tokens: string[],
  artifactsIndex: ArtifactsIndex,
  codeRootAbs: string,
): EntryMatch[] {
  const normalizedQuestion = normalizeText(question);
  const matches: EntryMatch[] = [];

  for (const run of artifactsIndex.runs) {
    for (const entry of run.entries) {
      const haystack = normalizeText(`${entry.name} ${entry.path}`);
      const tokenMatches = tokens.filter((token) => haystack.includes(token));
      const codePath = resolvePath(codeRootAbs, entry.path);
      const codeExists = existsSync(codePath);
      let score = tokenMatches.length * 10;
      if (tokenMatches.length > 0 && entry.status === "success") score += 3;
      if (tokenMatches.length > 0 && codeExists) score += 2;
      if (
        tokenMatches.length > 0 &&
        normalizedQuestion.includes(normalizeText(entry.name))
      ) {
        score += 5;
      }
      if (score <= 0) continue;
      matches.push({
        run,
        entry,
        codePath,
        codeExists,
        score,
        matchedTokens: tokenMatches,
      });
    }
  }

  return matches.sort(
    (a, b) =>
      b.score - a.score ||
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
    });
  }

  return matches.sort(
    (a, b) =>
      b.score - a.score ||
      a.insight.entry.localeCompare(b.insight.entry) ||
      a.insight.id.localeCompare(b.insight.id),
  );
}

function tokenize(input: string): string[] {
  const words = normalizeText(input)
    .split(/\s+/)
    .map((word) => word.trim())
    .filter((word) => word.length >= 2)
    .filter((word) => !STOP_WORDS.has(word));
  return [...new Set(words)];
}

function normalizeText(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9/_-]+/g, " ")
    .trim();
}

function deriveServiceFlowPath(finalIndexPath: string): string {
  const parts = normalize(finalIndexPath).split(/[/\\]/);
  if (parts.length < 2) return finalIndexPath;
  parts.pop();
  return join(...parts, "pages", "08-service-flow.md")
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

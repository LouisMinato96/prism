import { readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { log } from "../../lib/log.ts";
import type { KnowledgeAnswerReportManifest } from "./report.ts";
import type { StrictCategory } from "./report/strict.ts";

export interface KnowledgeDiffOptions {
  basePath: string;
  headPath: string;
  strict: boolean;
  json: boolean;
}

export type DiffVerdict = "improved" | "regressed" | "unchanged";

export interface QuestionDelta {
  digest: string;
  type: "added" | "removed" | "changed";
  detail: string;
}

export interface StrictDelta {
  category: StrictCategory;
  type: "new" | "resolved";
  questionDigest: string;
  detail: string;
}

export interface LensDelta {
  lens: string;
  type: "new" | "resolved";
  findingCount: number;
}

export interface ConfidenceDelta {
  digest: string;
  type: "improved" | "regressed" | "unchanged";
  baseLevelOrNull: string | null;
  headLevelOrNull: string | null;
}

export interface DiffResult {
  schemaVersion: 1;
  verdict: DiffVerdict;
  score: number;
  base: { digest: string; questionCount: number; generatedAt: string };
  head: { digest: string; questionCount: number; generatedAt: string };
  questions: QuestionDelta[];
  confidence: ConfidenceDelta[];
  strict: StrictDelta[];
  lenses: LensDelta[];
  pageDelta: { added: number; removed: number };
}

interface QuestionRow {
  digest: string;
  question: string;
  class: string;
  confidence: { level: string; score: number } | null;
}

interface StrictRow {
  questionDigest: string;
  category: string;
  detail: string;
}

interface LensRow {
  lens: string;
  findingCount: number;
}

const WEIGHTS = {
  newStrictIssue: -10,
  resolvedStrictIssue: 5,
  confidenceDrop: -3,
  confidenceImprove: 2,
  newLensFinding: -1,
  resolvedLensFinding: 1,
};

export async function runKnowledgeDiff(
  options: KnowledgeDiffOptions,
): Promise<DiffResult> {
  const stage = "knowledge:diff";

  const baseManifest = await loadManifest(options.basePath);
  const headManifest = await loadManifest(options.headPath);

  log.step(
    `diffing ${baseManifest.digest.slice(0, 8)} → ${headManifest.digest.slice(0, 8)}`,
    stage,
  );

  const baseQuestions = await loadDataFile<{ questions: QuestionRow[] }>(
    options.basePath,
    "questions.json",
  );
  const headQuestions = await loadDataFile<{ questions: QuestionRow[] }>(
    options.headPath,
    "questions.json",
  );

  const baseStrict = await loadDataFile<{ issues: StrictRow[] }>(
    options.basePath,
    "strict-rollup.json",
  );
  const headStrict = await loadDataFile<{ issues: StrictRow[] }>(
    options.headPath,
    "strict-rollup.json",
  );

  const baseLenses = await loadDataFile<{ lenses: LensRow[] }>(
    options.basePath,
    "lens-findings.json",
  );
  const headLenses = await loadDataFile<{ lenses: LensRow[] }>(
    options.headPath,
    "lens-findings.json",
  );

  const questionDeltas = diffQuestions(
    baseQuestions?.questions ?? [],
    headQuestions?.questions ?? [],
  );

  const confidenceDeltas = diffConfidence(
    baseQuestions?.questions ?? [],
    headQuestions?.questions ?? [],
  );

  const strictDeltas = diffStrict(baseStrict?.issues ?? [], headStrict?.issues ?? []);

  const lensDeltas = diffLenses(baseLenses?.lenses ?? [], headLenses?.lenses ?? []);

  const basePages = new Set(baseManifest.pages.map((p) => p.name));
  const headPages = new Set(headManifest.pages.map((p) => p.name));
  const pagesAdded = [...headPages].filter((p) => !basePages.has(p)).length;
  const pagesRemoved = [...basePages].filter((p) => !headPages.has(p)).length;

  const score = computeScore(confidenceDeltas, strictDeltas, lensDeltas);
  const verdict: DiffVerdict =
    score > 0 ? "improved" : score < 0 ? "regressed" : "unchanged";

  return {
    schemaVersion: 1,
    verdict,
    score,
    base: {
      digest: baseManifest.digest,
      questionCount: baseManifest.counts.questions,
      generatedAt: baseManifest.generatedAt,
    },
    head: {
      digest: headManifest.digest,
      questionCount: headManifest.counts.questions,
      generatedAt: headManifest.generatedAt,
    },
    questions: questionDeltas,
    confidence: confidenceDeltas,
    strict: strictDeltas,
    lenses: lensDeltas,
    pageDelta: { added: pagesAdded, removed: pagesRemoved },
  };
}

async function loadManifest(reportPath: string): Promise<KnowledgeAnswerReportManifest> {
  const manifestPath = join(reportPath, "manifest.json");
  if (!existsSync(manifestPath)) {
    throw new Error(`manifest.json missing at ${manifestPath}`);
  }
  return JSON.parse(
    await readFile(manifestPath, "utf8"),
  ) as KnowledgeAnswerReportManifest;
}

async function loadDataFile<T>(reportPath: string, file: string): Promise<T | null> {
  const filePath = join(reportPath, "data", file);
  if (!existsSync(filePath)) return null;
  try {
    return JSON.parse(await readFile(filePath, "utf8")) as T;
  } catch {
    return null;
  }
}

function diffQuestions(base: QuestionRow[], head: QuestionRow[]): QuestionDelta[] {
  const baseDigests = new Map(base.map((q) => [q.digest, q]));
  const headDigests = new Map(head.map((q) => [q.digest, q]));
  const deltas: QuestionDelta[] = [];

  for (const [digest, hq] of headDigests) {
    const bq = baseDigests.get(digest);
    if (!bq) {
      deltas.push({
        digest,
        type: "added",
        detail: `new question: ${hq.question}`,
      });
    } else if (bq.class !== hq.class) {
      deltas.push({
        digest,
        type: "changed",
        detail: `class ${bq.class} → ${hq.class}`,
      });
    }
  }

  for (const [digest, bq] of baseDigests) {
    if (!headDigests.has(digest)) {
      deltas.push({
        digest,
        type: "removed",
        detail: `removed question: ${bq.question}`,
      });
    }
  }

  return deltas.sort(
    (a, b) => a.type.localeCompare(b.type) || a.digest.localeCompare(b.digest),
  );
}

function diffConfidence(base: QuestionRow[], head: QuestionRow[]): ConfidenceDelta[] {
  const baseMap = new Map(base.map((q) => [q.digest, q]));
  const headMap = new Map(head.map((q) => [q.digest, q]));
  const deltas: ConfidenceDelta[] = [];

  const allDigests = new Set([...baseMap.keys(), ...headMap.keys()]);
  for (const digest of [...allDigests].sort()) {
    const bq = baseMap.get(digest);
    const hq = headMap.get(digest);
    if (!bq || !hq) continue;

    const bs = bq.confidence?.score ?? null;
    const hs = hq.confidence?.score ?? null;
    const bl = bq.confidence?.level ?? null;
    const hl = hq.confidence?.level ?? null;

    if (bs === hs) {
      deltas.push({
        digest,
        type: "unchanged",
        baseLevelOrNull: bl,
        headLevelOrNull: hl,
      });
    } else if (bs === null || hs === null) {
      deltas.push({
        digest,
        type: hs !== null ? "improved" : "regressed",
        baseLevelOrNull: bl,
        headLevelOrNull: hl,
      });
    } else if (hs > bs) {
      deltas.push({ digest, type: "improved", baseLevelOrNull: bl, headLevelOrNull: hl });
    } else {
      deltas.push({
        digest,
        type: "regressed",
        baseLevelOrNull: bl,
        headLevelOrNull: hl,
      });
    }
  }

  return deltas;
}

function diffStrict(base: StrictRow[], head: StrictRow[]): StrictDelta[] {
  const baseKeys = new Set(
    base.map((i) => `${i.questionDigest}::${i.category}::${i.detail}`),
  );
  const headKeys = new Set(
    head.map((i) => `${i.questionDigest}::${i.category}::${i.detail}`),
  );
  const deltas: StrictDelta[] = [];

  for (const issue of head) {
    const key = `${issue.questionDigest}::${issue.category}::${issue.detail}`;
    if (!baseKeys.has(key)) {
      deltas.push({
        category: issue.category as StrictCategory,
        type: "new",
        questionDigest: issue.questionDigest,
        detail: issue.detail,
      });
    }
  }

  for (const issue of base) {
    const key = `${issue.questionDigest}::${issue.category}::${issue.detail}`;
    if (!headKeys.has(key)) {
      deltas.push({
        category: issue.category as StrictCategory,
        type: "resolved",
        questionDigest: issue.questionDigest,
        detail: issue.detail,
      });
    }
  }

  return deltas.sort(
    (a, b) => a.type.localeCompare(b.type) || a.category.localeCompare(b.category),
  );
}

function diffLenses(base: LensRow[], head: LensRow[]): LensDelta[] {
  const baseMap = new Map(base.map((l) => [l.lens, l.findingCount]));
  const headMap = new Map(head.map((l) => [l.lens, l.findingCount]));
  const deltas: LensDelta[] = [];

  for (const [lens, headCount] of headMap) {
    const baseCount = baseMap.get(lens) ?? 0;
    if (headCount > baseCount) {
      deltas.push({ lens, type: "new", findingCount: headCount - baseCount });
    }
  }

  for (const [lens, baseCount] of baseMap) {
    const headCount = headMap.get(lens) ?? 0;
    if (baseCount > headCount) {
      deltas.push({ lens, type: "resolved", findingCount: baseCount - headCount });
    }
  }

  return deltas.sort(
    (a, b) => a.type.localeCompare(b.type) || a.lens.localeCompare(b.lens),
  );
}

function computeScore(
  confidence: ConfidenceDelta[],
  strict: StrictDelta[],
  lenses: LensDelta[],
): number {
  let score = 0;

  for (const d of strict) {
    score += d.type === "new" ? WEIGHTS.newStrictIssue : WEIGHTS.resolvedStrictIssue;
  }

  for (const d of confidence) {
    if (d.type === "improved") score += WEIGHTS.confidenceImprove;
    if (d.type === "regressed") score += WEIGHTS.confidenceDrop;
  }

  for (const d of lenses) {
    const weight =
      d.type === "new" ? WEIGHTS.newLensFinding : WEIGHTS.resolvedLensFinding;
    score += weight * d.findingCount;
  }

  return score;
}

export function formatDiffMarkdown(result: DiffResult): string {
  const lines: string[] = [];
  lines.push(`# Knowledge Diff Report`);
  lines.push("");
  lines.push(`**Verdict:** ${result.verdict} (score: ${result.score})`);
  lines.push("");
  lines.push(`| | Base | Head |`);
  lines.push(`|---|---|---|`);
  lines.push(
    `| Digest | \`${result.base.digest.slice(0, 12)}\` | \`${result.head.digest.slice(0, 12)}\` |`,
  );
  lines.push(
    `| Questions | ${result.base.questionCount} | ${result.head.questionCount} |`,
  );
  lines.push(`| Generated | ${result.base.generatedAt} | ${result.head.generatedAt} |`);
  lines.push("");

  if (result.questions.length > 0) {
    lines.push(`## Question Changes (${result.questions.length})`);
    lines.push("");
    for (const q of result.questions) {
      lines.push(`- **${q.type}** \`${q.digest}\`: ${q.detail}`);
    }
    lines.push("");
  }

  const confChanged = result.confidence.filter((c) => c.type !== "unchanged");
  if (confChanged.length > 0) {
    lines.push(`## Confidence Changes (${confChanged.length})`);
    lines.push("");
    for (const c of confChanged) {
      lines.push(
        `- **${c.type}** \`${c.digest}\`: ${c.baseLevelOrNull ?? "none"} → ${c.headLevelOrNull ?? "none"}`,
      );
    }
    lines.push("");
  }

  if (result.strict.length > 0) {
    lines.push(`## Strict Issue Changes (${result.strict.length})`);
    lines.push("");
    for (const s of result.strict) {
      lines.push(`- **${s.type}** [${s.category}] \`${s.questionDigest}\`: ${s.detail}`);
    }
    lines.push("");
  }

  if (result.lenses.length > 0) {
    lines.push(`## Lens Finding Changes (${result.lenses.length})`);
    lines.push("");
    for (const l of result.lenses) {
      lines.push(`- **${l.type}** ${l.lens}: ${l.findingCount} finding(s)`);
    }
    lines.push("");
  }

  if (result.pageDelta.added > 0 || result.pageDelta.removed > 0) {
    lines.push(`## Page Changes`);
    lines.push("");
    if (result.pageDelta.added > 0) lines.push(`- Added: ${result.pageDelta.added}`);
    if (result.pageDelta.removed > 0)
      lines.push(`- Removed: ${result.pageDelta.removed}`);
    lines.push("");
  }

  return lines.join("\n");
}

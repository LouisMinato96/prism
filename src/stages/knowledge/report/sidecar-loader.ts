import { existsSync } from "node:fs";
import { readdir, readFile } from "node:fs/promises";
import { basename, join } from "node:path";

export type QuestionClass =
  | "architecture_storyline"
  | "entrypoint_trace"
  | "dependency_flow"
  | "building_blocks"
  | "reference_lookup"
  | "change_guidance"
  | "unknown_or_ambiguous";

export type ClassConfidence = "high" | "medium" | "low" | "none";
export type EvidencePackStatus = "complete" | "partial";
export type ConfidenceLevel = "low" | "medium" | "high";

export interface NormalizedQuestion {
  digest: string;
  question: string;
  class: QuestionClass;
  classConfidence: ClassConfidence;
  evidencePackStatus: EvidencePackStatus;
  evidencePackRequirements: string[];
  evidencePackSatisfied: string[];
  evidencePackMissing: string[];
  answerJsonPresent: boolean;
  confidence?: { level: ConfidenceLevel; score: number };
  failOpenTriggered?: boolean;
  failOpenReasons: string[];
  intent?: string;
  entries: Array<{
    run: string;
    name: string;
    path: string;
    score: number;
    status: "success" | "failed";
    codeExists: boolean;
  }>;
  insights: Array<{
    severity: string;
    entry: string;
    title: string;
    lens: string;
    occurrences: number;
  }>;
  artifactGaps: Array<{ category: string; detail: string }>;
  markdownPath?: string;
  classificationPath: string;
  evidencePackPath: string;
  jsonPath?: string;
}

export interface SidecarLoadResult {
  questions: NormalizedQuestion[];
  inputPaths: string[];
  warnings: string[];
  malformed: string[];
  classificationCount: number;
  evidencePackCount: number;
  answerJsonCount: number;
  markdownCount: number;
}

export async function loadAnswerSidecars(
  answersDirAbs: string,
): Promise<SidecarLoadResult> {
  const entries = await readdir(answersDirAbs, { withFileTypes: true });

  const classificationByBase = new Map<string, string>();
  const evidencePackByBase = new Map<string, string>();
  const answerJsonByBase = new Map<string, string>();
  const markdownByBase = new Map<string, string>();

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = join(answersDirAbs, entry.name);
    if (entry.name.endsWith(".classification.json")) {
      classificationByBase.set(entry.name.slice(0, -".classification.json".length), full);
    } else if (entry.name.endsWith(".evidence-pack.json")) {
      evidencePackByBase.set(entry.name.slice(0, -".evidence-pack.json".length), full);
    } else if (entry.name.endsWith(".md") && entry.name !== "index.md") {
      markdownByBase.set(entry.name.slice(0, -".md".length), full);
    } else if (entry.name.endsWith(".json")) {
      answerJsonByBase.set(entry.name.slice(0, -".json".length), full);
    }
  }

  const warnings: string[] = [];
  const malformed: string[] = [];
  const questions: NormalizedQuestion[] = [];
  const inputPaths: string[] = [];

  const bases = [...classificationByBase.keys()].sort();
  for (const base of bases) {
    const classificationPath = classificationByBase.get(base)!;
    const evidencePackPath = evidencePackByBase.get(base);
    inputPaths.push(classificationPath);
    if (!evidencePackPath) {
      warnings.push(
        `evidence-pack sidecar missing for "${base}" (expected ${base}.evidence-pack.json)`,
      );
      continue;
    }
    inputPaths.push(evidencePackPath);

    const classification = await safeReadJson(classificationPath, malformed);
    const evidencePack = await safeReadJson(evidencePackPath, malformed);
    if (!classification || !evidencePack) continue;

    const jsonPath = answerJsonByBase.get(base);
    let answerJson: AnswerJson | null = null;
    if (jsonPath) {
      inputPaths.push(jsonPath);
      const raw = await safeReadJson(jsonPath, malformed);
      if (raw) answerJson = raw as AnswerJson;
    } else {
      warnings.push(
        `answer .json sidecar missing for "${base}" (rerun \`prism knowledge answer\` with --emit-json for full rollup)`,
      );
    }

    const markdownPath = markdownByBase.get(base);
    if (markdownPath) inputPaths.push(markdownPath);

    const normalized = buildNormalizedQuestion({
      base,
      classification: classification as Classification,
      evidencePack: evidencePack as EvidencePack,
      answerJson,
      classificationPath,
      evidencePackPath,
      jsonPath,
      markdownPath,
    });
    questions.push(normalized);
  }

  for (const base of evidencePackByBase.keys()) {
    if (!classificationByBase.has(base)) {
      warnings.push(
        `classification sidecar missing for "${base}" (orphan evidence-pack ignored)`,
      );
    }
  }
  for (const base of answerJsonByBase.keys()) {
    if (!classificationByBase.has(base)) {
      warnings.push(
        `classification sidecar missing for "${base}" (orphan answer .json ignored)`,
      );
    }
  }

  questions.sort((a, b) => a.digest.localeCompare(b.digest));
  inputPaths.sort();

  return {
    questions,
    inputPaths,
    warnings: warnings.sort(),
    malformed: malformed.sort(),
    classificationCount: classificationByBase.size,
    evidencePackCount: evidencePackByBase.size,
    answerJsonCount: answerJsonByBase.size,
    markdownCount: markdownByBase.size,
  };
}

interface Classification {
  schemaVersion?: number;
  question: string;
  questionDigest: string;
  class: QuestionClass;
  confidence: ClassConfidence;
}

interface EvidencePack {
  status: EvidencePackStatus;
  requirements?: string[];
  satisfied?: string[];
  missing?: string[];
}

interface AnswerJson {
  questionDigest?: string;
  intent?: string;
  confidence?: { level: ConfidenceLevel; score: number };
  failOpen?: { triggered?: boolean; reasons?: string[] };
  entries?: Array<{
    run?: string;
    name?: string;
    path?: string;
    score?: number;
    status?: "success" | "failed";
    codeExists?: boolean;
  }>;
  insights?: Array<{
    severity?: string;
    entry?: string;
    title?: string;
    lens?: string;
    occurrences?: number;
  }>;
  artifactGaps?: Array<{ category?: string; detail?: string }>;
}

function buildNormalizedQuestion(input: {
  base: string;
  classification: Classification;
  evidencePack: EvidencePack;
  answerJson: AnswerJson | null;
  classificationPath: string;
  evidencePackPath: string;
  jsonPath?: string;
  markdownPath?: string;
}): NormalizedQuestion {
  return {
    digest: input.classification.questionDigest,
    question: input.classification.question,
    class: input.classification.class,
    classConfidence: input.classification.confidence,
    evidencePackStatus: input.evidencePack.status,
    evidencePackRequirements: (input.evidencePack.requirements ?? []).slice().sort(),
    evidencePackSatisfied: (input.evidencePack.satisfied ?? []).slice().sort(),
    evidencePackMissing: (input.evidencePack.missing ?? []).slice().sort(),
    answerJsonPresent: input.answerJson !== null,
    confidence: input.answerJson?.confidence,
    failOpenTriggered: input.answerJson?.failOpen?.triggered,
    failOpenReasons: (input.answerJson?.failOpen?.reasons ?? []).slice().sort(),
    intent: input.answerJson?.intent,
    entries: (input.answerJson?.entries ?? [])
      .map((entry) => ({
        run: entry.run ?? "",
        name: entry.name ?? "",
        path: entry.path ?? "",
        score: entry.score ?? 0,
        status: entry.status ?? "success",
        codeExists: entry.codeExists ?? false,
      }))
      .sort(
        (a, b) =>
          b.score - a.score || a.path.localeCompare(b.path) || a.run.localeCompare(b.run),
      ),
    insights: (input.answerJson?.insights ?? [])
      .map((insight) => ({
        severity: insight.severity ?? "info",
        entry: insight.entry ?? "",
        title: insight.title ?? "",
        lens: insight.lens ?? "",
        occurrences: insight.occurrences ?? 0,
      }))
      .sort(
        (a, b) =>
          a.severity.localeCompare(b.severity) ||
          a.entry.localeCompare(b.entry) ||
          a.title.localeCompare(b.title),
      ),
    artifactGaps: (input.answerJson?.artifactGaps ?? [])
      .map((gap) => ({
        category: gap.category ?? "",
        detail: gap.detail ?? "",
      }))
      .sort(
        (a, b) =>
          a.category.localeCompare(b.category) || a.detail.localeCompare(b.detail),
      ),
    markdownPath: input.markdownPath,
    classificationPath: input.classificationPath,
    evidencePackPath: input.evidencePackPath,
    jsonPath: input.jsonPath,
  };
}

async function safeReadJson(path: string, malformed: string[]): Promise<unknown> {
  if (!existsSync(path)) {
    malformed.push(`missing file: ${path}`);
    return null;
  }
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    malformed.push(
      `invalid JSON at ${path}: ${error instanceof Error ? error.message : String(error)}`,
    );
    return null;
  }
}

export function baseFromMarkdownPath(markdownPath: string): string {
  const name = basename(markdownPath);
  return name.endsWith(".md") ? name.slice(0, -".md".length) : name;
}

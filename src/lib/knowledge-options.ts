export interface ResolvedKnowledgeBuildOptions {
  analyzeRoot: string;
  docsRoot: string;
  outRoot: string;
}

export interface ResolvedKnowledgeAnswerOptions {
  knowledgeRoot: string;
  codeRoot?: string;
  question?: string;
  questionsFile?: string;
  answerOut?: string;
  outDir: string;
  top: number;
  emitJson: boolean;
  strict: boolean;
  minConfidence?: "low" | "medium" | "high";
}

export interface ResolvedKnowledgeAnswerReportOptions {
  knowledgeRoot: string;
  answersDir: string;
  reportOut?: string;
  strict: boolean;
  minConfidence?: "low" | "medium" | "high";
}

export interface ResolvedKnowledgeDiffOptions {
  basePath: string;
  headPath: string;
  strict: boolean;
  json: boolean;
}

export interface ResolvedKnowledgeUpdateOptions {
  repoRoot: string;
  knowledgeRoot: string;
  from: string;
  to: string;
  batchSize: number;
  dryRun: boolean;
}

export function resolveKnowledgeBuildOptions(values: {
  "analyze-root"?: string;
  "docs-root"?: string;
  out?: string;
}): ResolvedKnowledgeBuildOptions {
  return {
    analyzeRoot: cleanOption(values["analyze-root"], ".tmp/analyze"),
    docsRoot: cleanOption(values["docs-root"], "docs/prism"),
    outRoot: cleanOption(values.out, ".prism/knowledge"),
  };
}

export function resolveKnowledgeUpdateOptions(values: {
  "repo-root"?: string;
  "knowledge-root"?: string;
  from?: string;
  to?: string;
  "batch-size"?: string;
  "dry-run"?: boolean;
  apply?: boolean;
}): ResolvedKnowledgeUpdateOptions {
  const repoRoot = cleanOption(values["repo-root"], ".");
  const knowledgeRoot = cleanOption(values["knowledge-root"], ".prism/knowledge");
  const from = cleanOptional(values.from);
  const to = cleanOptional(values.to);
  const batchSizeRaw = cleanOptional(values["batch-size"]);
  const batchSize = batchSizeRaw === undefined ? 20 : Number(batchSizeRaw);
  const dryRun = values.apply === true ? false : values["dry-run"] !== false;

  if (!from) throw new Error("knowledge update requires --from <commit>");
  if (!to) throw new Error("knowledge update requires --to <commit>");
  if (!Number.isInteger(batchSize) || batchSize < 1) {
    throw new Error(`invalid --batch-size value: ${values["batch-size"]}`);
  }

  return {
    repoRoot,
    knowledgeRoot,
    from,
    to,
    batchSize,
    dryRun,
  };
}

export function resolveKnowledgeAnswerReportOptions(values: {
  "knowledge-root"?: string;
  "answers-dir"?: string;
  "report-out"?: string;
  strict?: boolean;
  "min-confidence"?: string;
}): ResolvedKnowledgeAnswerReportOptions {
  const knowledgeRoot = cleanOption(values["knowledge-root"], ".prism/knowledge");
  const answersDir = cleanOption(values["answers-dir"], ".prism/knowledge/answers");
  const reportOut = cleanOptional(values["report-out"]);
  const strict = values.strict === true;
  const minConfidenceRaw = cleanOptional(values["min-confidence"]);

  if (
    minConfidenceRaw !== undefined &&
    minConfidenceRaw !== "low" &&
    minConfidenceRaw !== "medium" &&
    minConfidenceRaw !== "high"
  ) {
    throw new Error(`invalid --min-confidence value: ${values["min-confidence"]}`);
  }
  if (!strict && minConfidenceRaw !== undefined) {
    throw new Error("--min-confidence requires --strict");
  }

  return {
    knowledgeRoot,
    answersDir,
    reportOut,
    strict,
    minConfidence: minConfidenceRaw as "low" | "medium" | "high" | undefined,
  };
}

export function resolveKnowledgeAnswerOptions(values: {
  "knowledge-root"?: string;
  "code-root"?: string;
  question?: string;
  "questions-file"?: string;
  "answer-out"?: string;
  "out-dir"?: string;
  top?: string;
  "emit-json"?: boolean;
  strict?: boolean;
  "min-confidence"?: string;
}): ResolvedKnowledgeAnswerOptions {
  const knowledgeRoot = cleanOption(values["knowledge-root"], ".prism/knowledge");
  const codeRoot = cleanOptional(values["code-root"]);
  const question = cleanOptional(values.question);
  const questionsFile = cleanOptional(values["questions-file"]);
  const answerOut = cleanOptional(values["answer-out"]);
  const outDir = cleanOption(values["out-dir"], ".prism/knowledge/answers");
  const topRaw = cleanOptional(values.top);
  const top = topRaw === undefined ? 8 : Number(topRaw);
  const emitJson = values["emit-json"] === true;
  const strict = values.strict === true;
  const minConfidenceRaw = cleanOptional(values["min-confidence"]);

  if (!Number.isInteger(top) || top < 1) {
    throw new Error(`invalid --top value: ${values.top}`);
  }

  if (!question && !questionsFile) {
    throw new Error("knowledge answer requires --question or --questions-file");
  }
  if (question && questionsFile) {
    throw new Error("knowledge answer accepts either --question or --questions-file");
  }
  if (questionsFile && answerOut) {
    throw new Error("--answer-out is only valid with --question");
  }
  if (
    minConfidenceRaw !== undefined &&
    minConfidenceRaw !== "low" &&
    minConfidenceRaw !== "medium" &&
    minConfidenceRaw !== "high"
  ) {
    throw new Error(`invalid --min-confidence value: ${values["min-confidence"]}`);
  }
  if (!strict && minConfidenceRaw !== undefined) {
    throw new Error("--min-confidence requires --strict");
  }

  return {
    knowledgeRoot,
    codeRoot,
    question,
    questionsFile,
    answerOut,
    outDir,
    top,
    emitJson,
    strict,
    minConfidence: minConfidenceRaw as "low" | "medium" | "high" | undefined,
  };
}

export function resolveKnowledgeDiffOptions(values: {
  base?: string;
  head?: string;
  strict?: boolean;
  json?: boolean;
}): ResolvedKnowledgeDiffOptions {
  const basePath = cleanOptional(values.base);
  const headPath = cleanOptional(values.head);
  const strict = values.strict === true;
  const json = values.json === true;

  if (!basePath) throw new Error("knowledge diff requires --base <path>");
  if (!headPath) throw new Error("knowledge diff requires --head <path>");

  return { basePath, headPath, strict, json };
}

function cleanOption(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

function cleanOptional(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  return trimmed;
}

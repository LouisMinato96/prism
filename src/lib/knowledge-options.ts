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

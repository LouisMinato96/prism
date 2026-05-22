import type { NormalizedQuestion, ConfidenceLevel } from "./sidecar-loader.ts";

export type StrictCategory =
  | "confidence_below_min"
  | "question_class_ambiguous"
  | "evidence_pack_incomplete"
  | "fail_open_required"
  | "missing_code_file"
  | "missing_graph"
  | "missing_repo_index"
  | "missing_final_index"
  | "missing_service_flow_page"
  | "schema_version_mismatch";

export interface StrictIssue {
  questionDigest: string;
  question: string;
  category: StrictCategory;
  detail: string;
}

export interface StrictSummary {
  questionCount: number;
  failedQuestionCount: number;
  issueCount: number;
  categories: Array<{ category: StrictCategory; count: number }>;
}

const CONFIDENCE_RANK: Record<ConfidenceLevel, number> = {
  low: 1,
  medium: 2,
  high: 3,
};

export function evaluateQuestionStrict(
  question: NormalizedQuestion,
  minConfidence: ConfidenceLevel,
): StrictIssue[] {
  const issues: StrictIssue[] = [];

  if (question.class === "unknown_or_ambiguous") {
    issues.push({
      questionDigest: question.digest,
      question: question.question,
      category: "question_class_ambiguous",
      detail: `question class is unknown_or_ambiguous (classConfidence=${question.classConfidence})`,
    });
  }

  if (question.evidencePackStatus === "partial") {
    issues.push({
      questionDigest: question.digest,
      question: question.question,
      category: "evidence_pack_incomplete",
      detail: `evidence pack partial; missing=${question.evidencePackMissing.join(",") || "none"}`,
    });
  }

  if (question.failOpenTriggered === true) {
    issues.push({
      questionDigest: question.digest,
      question: question.question,
      category: "fail_open_required",
      detail: `fail-open triggered; reasons=${question.failOpenReasons.join(",") || "none"}`,
    });
  }

  if (question.confidence) {
    const min = CONFIDENCE_RANK[minConfidence];
    const actual = CONFIDENCE_RANK[question.confidence.level];
    if (actual < min) {
      issues.push({
        questionDigest: question.digest,
        question: question.question,
        category: "confidence_below_min",
        detail: `confidence ${question.confidence.level} (${question.confidence.score}/100) below minimum ${minConfidence}`,
      });
    }
  }

  if (question.answerJsonPresent) {
    const missingPaths = question.entries
      .filter((e) => !e.codeExists)
      .map((e) => e.path)
      .sort();
    if (missingPaths.length > 0) {
      issues.push({
        questionDigest: question.digest,
        question: question.question,
        category: "missing_code_file",
        detail: `${missingPaths.length} entry code file(s) missing: ${missingPaths.join(", ")}`,
      });
    }
  }

  const artifactGapCategories: StrictCategory[] = [
    "missing_graph",
    "missing_repo_index",
    "missing_final_index",
    "missing_service_flow_page",
  ];
  for (const gap of question.artifactGaps) {
    if (artifactGapCategories.includes(gap.category as StrictCategory)) {
      issues.push({
        questionDigest: question.digest,
        question: question.question,
        category: gap.category as StrictCategory,
        detail: gap.detail,
      });
    }
  }

  return issues.sort((a, b) => a.category.localeCompare(b.category));
}

export function buildStrictSummary(
  questions: NormalizedQuestion[],
  issuesByDigest: Map<string, StrictIssue[]>,
): StrictSummary {
  const categoryCounts = new Map<StrictCategory, number>();
  let issueCount = 0;
  let failedQuestionCount = 0;

  for (const question of questions) {
    const issues = issuesByDigest.get(question.digest) ?? [];
    if (issues.length > 0) failedQuestionCount += 1;
    issueCount += issues.length;
    for (const issue of issues) {
      categoryCounts.set(issue.category, (categoryCounts.get(issue.category) ?? 0) + 1);
    }
  }

  const categories = [...categoryCounts.entries()]
    .map(([category, count]) => ({ category, count }))
    .sort((a, b) => a.category.localeCompare(b.category));

  return {
    questionCount: questions.length,
    failedQuestionCount,
    issueCount,
    categories,
  };
}

export const EXPECTED_PACK_SCHEMA_VERSION = 1;

export function evaluatePackStrict(packSchemaVersion: number): StrictIssue[] {
  if (packSchemaVersion !== EXPECTED_PACK_SCHEMA_VERSION) {
    return [
      {
        questionDigest: "*",
        question: "(pack-level)",
        category: "schema_version_mismatch",
        detail: `knowledge-pack schemaVersion=${packSchemaVersion}, expected=${EXPECTED_PACK_SCHEMA_VERSION}`,
      },
    ];
  }
  return [];
}

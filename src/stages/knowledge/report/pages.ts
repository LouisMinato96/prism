import { escapeTableCell, toDisplayPath } from "../../../lib/knowledge-render.ts";
import type { NormalizedQuestion } from "./sidecar-loader.ts";
import type { StrictIssue, StrictSummary } from "./strict.ts";
import type { EntryRollupRow } from "./data.ts";

const TOP_INSIGHTS_PER_QUESTION = 5;
const TOP_ENTRIES_PER_QUESTION = 5;
const TOP_ENTRIES_IN_ROLLUP = 30;

export function renderIndex(input: {
  manifestDigest: string;
  generatedAt: string;
  knowledgeRootDisplay: string;
  answersDirDisplay: string;
  reportRootDisplay: string;
  questions: NormalizedQuestion[];
  strict: boolean;
  minConfidence: string | null;
  strictSummary: StrictSummary | null;
  pageFiles: PageRef[];
  warnings: string[];
  malformed: string[];
  integritySignals: { stale: number; contradiction: number };
}): string {
  const lines: string[] = [];
  lines.push("# Prism Knowledge Answer Report");
  lines.push("");
  lines.push(`- schema version: 1`);
  lines.push(`- digest: \`${input.manifestDigest}\``);
  lines.push(`- generated at: ${input.generatedAt}`);
  lines.push(`- knowledge root: \`${input.knowledgeRootDisplay}\``);
  lines.push(`- answers dir: \`${input.answersDirDisplay}\``);
  lines.push(`- report root: \`${input.reportRootDisplay}\``);
  lines.push(`- question count: ${input.questions.length}`);
  lines.push(
    `- strict mode: ${input.strict ? `enabled (min=${input.minConfidence ?? "medium"})` : "disabled"}`,
  );
  if (input.strict && input.strictSummary) {
    lines.push(
      `- strict fail: ${input.strictSummary.failedQuestionCount}/${input.strictSummary.questionCount} questions, ${input.strictSummary.issueCount} issues`,
    );
  }
  lines.push(
    `- integrity signals: stale=${input.integritySignals.stale}, contradiction=${input.integritySignals.contradiction}`,
  );
  lines.push(`- load warnings: ${input.warnings.length}`);
  lines.push(`- malformed sidecars: ${input.malformed.length}`);
  lines.push("");
  lines.push("## Reading Order");
  lines.push("");
  lines.push("```mermaid");
  lines.push("flowchart TD");
  lines.push("  Overview --> EvidenceMap");
  lines.push("  EvidenceMap --> ClassBreakdown");
  lines.push("  ClassBreakdown --> FollowUp");
  lines.push("  FollowUp --> Strict");
  lines.push("  Strict --> Integrity");
  lines.push("  Integrity --> Diagrams");
  lines.push("  Diagrams --> Questions");
  lines.push("```");
  lines.push("");
  lines.push("## Pages");
  lines.push("");
  for (const page of input.pageFiles) {
    lines.push(`- [${page.title}](${page.relPath}) — ${page.summary}`);
  }
  lines.push("");
  lines.push("## Per-Question Pages");
  lines.push("");
  if (input.questions.length === 0) {
    lines.push("No questions found.");
  } else {
    for (const question of input.questions) {
      lines.push(
        `- [\`${question.digest}\`](questions/${question.digest}.md) — ${question.class} — ${escapeTableCell(question.question)}`,
      );
    }
  }
  lines.push("");
  if (input.warnings.length > 0 || input.malformed.length > 0) {
    lines.push("## Issues During Load");
    lines.push("");
    lines.push("See [`validation-report.md`](validation-report.md).");
    lines.push("");
  }
  lines.push("## Status");
  lines.push("");
  lines.push(
    "Deterministic aggregator (v2.12). Teaching pages, strict gates, diagram index, and glossary.",
  );
  lines.push("");
  return lines.join("\n");
}

export interface PageRef {
  title: string;
  relPath: string;
  summary: string;
}

export function renderValidationReport(input: {
  warnings: string[];
  malformed: string[];
  integritySignals: { stale: string[]; contradiction: string[] };
  questions: NormalizedQuestion[];
}): string {
  const lines: string[] = [];
  lines.push("# Validation Report");
  lines.push("");
  lines.push(`- question count: ${input.questions.length}`);
  lines.push(`- warnings: ${input.warnings.length}`);
  lines.push(`- malformed sidecars: ${input.malformed.length}`);
  lines.push(`- stale-run signals: ${input.integritySignals.stale.length}`);
  lines.push(`- contradiction signals: ${input.integritySignals.contradiction.length}`);
  lines.push("");

  lines.push(...renderListSection("Warnings", input.warnings));
  lines.push(...renderListSection("Malformed Sidecars", input.malformed));
  lines.push(...renderListSection("Stale Run Signals", input.integritySignals.stale));
  lines.push(
    ...renderListSection("Contradiction Signals", input.integritySignals.contradiction),
  );

  const questionsMissingJson = input.questions.filter((q) => !q.answerJsonPresent);
  lines.push(
    ...renderListSection(
      "Questions Without Answer JSON Sidecar",
      questionsMissingJson.map(
        (q) => `${q.digest} — ${q.question} (rerun answer with --emit-json)`,
      ),
    ),
  );

  return lines.join("\n");
}

function renderListSection(title: string, items: string[]): string[] {
  const lines = [`## ${title}`, ""];
  if (items.length === 0) {
    lines.push("None.");
  } else {
    for (const item of items.slice().sort()) {
      lines.push(`- ${item}`);
    }
  }
  lines.push("");
  return lines;
}

export function renderOverview(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 00 Overview");
  lines.push("");
  lines.push(`- question count: ${questions.length}`);
  lines.push("");
  if (questions.length === 0) {
    lines.push("No questions in answers directory.");
    return lines.join("\n") + "\n";
  }
  lines.push(
    "| # | digest | class | class-confidence | answer-confidence | evidence | fail-open | intent | question |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  questions.forEach((question, index) => {
    const answerConfCell = question.confidence
      ? `${question.confidence.level} (${question.confidence.score}/100)`
      : "n/a";
    const failOpenCell =
      question.failOpenTriggered === undefined
        ? "n/a"
        : question.failOpenTriggered
          ? "yes"
          : "no";
    lines.push(
      `| ${index + 1} | \`${question.digest}\` | ${question.class} | ${question.classConfidence} | ${answerConfCell} | ${question.evidencePackStatus} | ${failOpenCell} | ${question.intent ?? "n/a"} | ${escapeTableCell(question.question)} |`,
    );
  });
  lines.push("");
  return lines.join("\n");
}

export function renderEvidenceMap(rollup: EntryRollupRow[]): string {
  const lines: string[] = [];
  lines.push("# 01 Evidence Map");
  lines.push("");
  lines.push(`- entries referenced: ${rollup.length}`);
  lines.push(
    `- showing top ${Math.min(rollup.length, TOP_ENTRIES_IN_ROLLUP)} by total score`,
  );
  lines.push("");
  if (rollup.length === 0) {
    lines.push("No entry evidence available.");
    lines.push("");
    lines.push(
      "(Rerun `prism knowledge answer` with `--emit-json` to populate this map.)",
    );
    return lines.join("\n") + "\n";
  }
  lines.push(
    "| # | entry path | question count | total score | max score | top questions |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- |");
  rollup.slice(0, TOP_ENTRIES_IN_ROLLUP).forEach((row, index) => {
    const topDigests = row.questions
      .slice(0, 3)
      .map((q) => `\`${q.digest}\``)
      .join(", ");
    lines.push(
      `| ${index + 1} | \`${row.path}\` | ${row.questionCount} | ${row.totalScore} | ${row.maxScore} | ${topDigests} |`,
    );
  });
  if (rollup.length > TOP_ENTRIES_IN_ROLLUP) {
    lines.push("");
    lines.push(
      `Showing first ${TOP_ENTRIES_IN_ROLLUP} of ${rollup.length} entries. See \`data/entries-rollup.json\` for full list.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderClassBreakdown(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 02 Class Breakdown");
  lines.push("");
  const counts = new Map<string, NormalizedQuestion[]>();
  for (const question of questions) {
    const bucket = counts.get(question.class) ?? [];
    bucket.push(question);
    counts.set(question.class, bucket);
  }
  const sortedClasses = [...counts.keys()].sort();
  lines.push(`- distinct classes: ${sortedClasses.length}`);
  lines.push("");
  if (questions.length === 0) {
    lines.push("No questions.");
    return lines.join("\n") + "\n";
  }
  lines.push("| class | count |");
  lines.push("| --- | --- |");
  for (const className of sortedClasses) {
    lines.push(`| ${className} | ${counts.get(className)!.length} |`);
  }
  lines.push("");
  for (const className of sortedClasses) {
    lines.push(`## ${className}`);
    lines.push("");
    const bucket = counts
      .get(className)!
      .slice()
      .sort((a, b) => a.digest.localeCompare(b.digest));
    for (const question of bucket) {
      lines.push(
        `- [\`${question.digest}\`](../questions/${question.digest}.md) — ${escapeTableCell(question.question)}`,
      );
    }
    lines.push("");
  }
  return lines.join("\n");
}

export function renderFollowUp(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 03 Follow-Up");
  lines.push("");
  lines.push(
    "Questions flagged as ambiguous, fail-open-triggered, or with partial evidence packs.",
  );
  lines.push("");

  const followUps = questions
    .map((question) => {
      const reasons: string[] = [];
      if (question.class === "unknown_or_ambiguous") reasons.push("ambiguous_class");
      if (question.failOpenTriggered === true) reasons.push("fail_open");
      if (question.evidencePackStatus === "partial") reasons.push("partial_evidence");
      if (question.confidence?.level === "low") reasons.push("low_confidence");
      return { question, reasons };
    })
    .filter((row) => row.reasons.length > 0)
    .sort((a, b) => a.question.digest.localeCompare(b.question.digest));

  lines.push(`- follow-up count: ${followUps.length}`);
  lines.push("");
  if (followUps.length === 0) {
    lines.push("None.");
    return lines.join("\n") + "\n";
  }
  lines.push(
    "| digest | class | confidence | evidence | reasons | missing requirements | question |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- |");
  for (const row of followUps) {
    const confidenceCell = row.question.confidence
      ? `${row.question.confidence.level} (${row.question.confidence.score}/100)`
      : "n/a";
    lines.push(
      `| \`${row.question.digest}\` | ${row.question.class} | ${confidenceCell} | ${row.question.evidencePackStatus} | ${row.reasons.join(", ")} | ${row.question.evidencePackMissing.join(", ") || "none"} | ${escapeTableCell(row.question.question)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderStrictIssues(input: {
  strict: boolean;
  minConfidence: string | null;
  summary: StrictSummary | null;
  issuesByDigest: Map<string, StrictIssue[]>;
  questions: NormalizedQuestion[];
}): string {
  const lines: string[] = [];
  lines.push("# 04 Strict Issues");
  lines.push("");
  if (!input.strict) {
    lines.push(
      "Strict mode disabled. Re-run with `--strict --min-confidence <level>` to populate.",
    );
    lines.push("");
    return lines.join("\n");
  }
  lines.push(`- min confidence: ${input.minConfidence ?? "medium"}`);
  lines.push(`- question count: ${input.summary?.questionCount ?? 0}`);
  lines.push(`- failed question count: ${input.summary?.failedQuestionCount ?? 0}`);
  lines.push(`- issue count: ${input.summary?.issueCount ?? 0}`);
  lines.push("");
  lines.push("## Categories");
  lines.push("");
  if (!input.summary || input.summary.categories.length === 0) {
    lines.push("None.");
    lines.push("");
  } else {
    lines.push("| category | count |");
    lines.push("| --- | --- |");
    for (const category of input.summary.categories) {
      lines.push(`| ${category.category} | ${category.count} |`);
    }
    lines.push("");
  }
  lines.push("## Issues");
  lines.push("");
  const rows: Array<{
    digest: string;
    category: string;
    detail: string;
    question: string;
  }> = [];
  for (const question of input.questions) {
    const issues = input.issuesByDigest.get(question.digest) ?? [];
    for (const issue of issues) {
      rows.push({
        digest: question.digest,
        category: issue.category,
        detail: issue.detail,
        question: question.question,
      });
    }
  }
  if (rows.length === 0) {
    lines.push("None.");
    lines.push("");
    lines.push(
      "Strict gates v2.12 cover: confidence_below_min, question_class_ambiguous, evidence_pack_incomplete, fail_open_required, missing_code_file.",
    );
    lines.push(
      "Missing-artifact gates (graph, repo-index, final-index, service-flow) land in v2.13+.",
    );
    return lines.join("\n") + "\n";
  }
  lines.push("| digest | category | detail | question |");
  lines.push("| --- | --- | --- | --- |");
  for (const row of rows) {
    lines.push(
      `| \`${row.digest}\` | ${row.category} | ${escapeTableCell(row.detail)} | ${escapeTableCell(row.question)} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderIntegritySignals(input: {
  stale: string[];
  contradiction: string[];
}): string {
  const lines: string[] = [];
  lines.push("# 05 Integrity Signals");
  lines.push("");
  lines.push(`- stale-run signals: ${input.stale.length}`);
  lines.push(`- contradiction signals: ${input.contradiction.length}`);
  lines.push("");
  lines.push("## Stale Run Signals");
  lines.push("");
  if (input.stale.length === 0) {
    lines.push("None.");
  } else {
    for (const signal of input.stale.slice().sort()) {
      lines.push(`- ${signal}`);
    }
  }
  lines.push("");
  lines.push("## Contradiction Signals");
  lines.push("");
  if (input.contradiction.length === 0) {
    lines.push("None.");
  } else {
    for (const signal of input.contradiction.slice().sort()) {
      lines.push(`- ${signal}`);
    }
  }
  lines.push("");
  return lines.join("\n");
}

export interface DiagramRef {
  name: string;
  title: string;
  path: string;
  edgeCount: number;
  entry: string;
  runDigest: string;
}

export function renderDiagramIndex(diagrams: DiagramRef[]): string {
  const lines: string[] = [];
  lines.push("# 06 Diagram Index");
  lines.push("");
  lines.push(`- diagrams referenced: ${diagrams.length}`);
  lines.push("");
  if (diagrams.length === 0) {
    lines.push("No diagrams discovered for referenced entries.");
    return lines.join("\n") + "\n";
  }
  lines.push("| run | entry | diagram | edges | path |");
  lines.push("| --- | --- | --- | --- | --- |");
  for (const diagram of diagrams) {
    lines.push(
      `| ${diagram.runDigest} | ${diagram.entry} | ${diagram.name} | ${diagram.edgeCount} | \`${diagram.path}\` |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderQuestionPage(input: {
  question: NormalizedQuestion;
  reportRootAbs: string;
  baseDir: string;
}): string {
  const q = input.question;
  const lines: string[] = [];
  lines.push(`# Question \`${q.digest}\``);
  lines.push("");
  lines.push(`- question: ${q.question}`);
  lines.push(`- class: ${q.class} (confidence=${q.classConfidence})`);
  if (q.confidence) {
    lines.push(`- answer confidence: ${q.confidence.level} (${q.confidence.score}/100)`);
  } else {
    lines.push(`- answer confidence: n/a (no .json sidecar)`);
  }
  lines.push(`- intent: ${q.intent ?? "n/a"}`);
  lines.push(`- evidence pack: ${q.evidencePackStatus}`);
  lines.push(`- requirements: ${q.evidencePackRequirements.join(", ") || "none"}`);
  lines.push(`- satisfied: ${q.evidencePackSatisfied.join(", ") || "none"}`);
  lines.push(`- missing: ${q.evidencePackMissing.join(", ") || "none"}`);
  if (q.failOpenTriggered !== undefined) {
    lines.push(`- fail-open: ${q.failOpenTriggered ? "triggered" : "not-triggered"}`);
    if (q.failOpenReasons.length > 0) {
      lines.push(`- fail-open reasons: ${q.failOpenReasons.join(", ")}`);
    }
  }
  lines.push("");
  lines.push("## Source Files");
  lines.push("");
  lines.push(
    `- markdown: ${q.markdownPath ? "`" + toDisplayPath(input.baseDir, q.markdownPath) + "`" : "n/a"}`,
  );
  lines.push(
    `- classification: \`${toDisplayPath(input.baseDir, q.classificationPath)}\``,
  );
  lines.push(`- evidence-pack: \`${toDisplayPath(input.baseDir, q.evidencePackPath)}\``);
  lines.push(
    `- json: ${q.jsonPath ? "`" + toDisplayPath(input.baseDir, q.jsonPath) + "`" : "n/a"}`,
  );
  lines.push("");
  lines.push("## Top Entries");
  lines.push("");
  if (q.entries.length === 0) {
    lines.push("No entry data available (no .json sidecar).");
  } else {
    lines.push("| # | score | run | name | path | status | code |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- |");
    q.entries.slice(0, TOP_ENTRIES_PER_QUESTION).forEach((entry, index) => {
      lines.push(
        `| ${index + 1} | ${entry.score} | ${entry.run} | ${entry.name} | \`${entry.path}\` | ${entry.status} | ${entry.codeExists ? "exists" : "missing"} |`,
      );
    });
  }
  lines.push("");
  lines.push("## Top Insights");
  lines.push("");
  if (q.insights.length === 0) {
    lines.push("No insight data available (no .json sidecar).");
  } else {
    lines.push("| # | severity | lens | entry | title | occurrences |");
    lines.push("| --- | --- | --- | --- | --- | --- |");
    q.insights.slice(0, TOP_INSIGHTS_PER_QUESTION).forEach((insight, index) => {
      lines.push(
        `| ${index + 1} | ${insight.severity} | ${insight.lens} | ${insight.entry} | ${escapeTableCell(insight.title)} | ${insight.occurrences} |`,
      );
    });
  }
  lines.push("");
  return lines.join("\n");
}

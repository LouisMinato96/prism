import { escapeTableCell, toDisplayPath } from "../../../lib/knowledge-render.ts";
import type { NormalizedQuestion } from "./sidecar-loader.ts";
import type { StrictIssue, StrictSummary } from "./strict.ts";
import type { EntryRollupRow } from "./data.ts";
import type { KnowledgeInsightSummary } from "../../../schemas/knowledge.ts";

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
      "Strict gates v2.13 cover: confidence_below_min, question_class_ambiguous, evidence_pack_incomplete, fail_open_required, missing_code_file, missing_graph, missing_repo_index, missing_final_index, missing_service_flow_page.",
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

export function renderQuestionOverlap(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 07 Question Overlap");
  lines.push("");
  lines.push(
    "Entries that appear in more than one question. Shared entries signal foundational code that multiple investigations converge on.",
  );
  lines.push("");

  const entryQuestions = new Map<string, Set<string>>();
  const entryClasses = new Map<string, Set<string>>();
  for (const question of questions) {
    for (const entry of question.entries) {
      if (!entry.path) continue;
      const digests = entryQuestions.get(entry.path) ?? new Set();
      digests.add(question.digest);
      entryQuestions.set(entry.path, digests);
      const classes = entryClasses.get(entry.path) ?? new Set();
      classes.add(question.class);
      entryClasses.set(entry.path, classes);
    }
  }

  const overlaps = [...entryQuestions.entries()]
    .filter(([, digests]) => digests.size > 1)
    .map(([path, digests]) => ({
      path,
      questionCount: digests.size,
      digests: [...digests].sort(),
      sharedClasses: [...(entryClasses.get(path) ?? [])].sort(),
    }))
    .sort((a, b) => b.questionCount - a.questionCount || a.path.localeCompare(b.path));

  lines.push(`- overlapping entries: ${overlaps.length}`);
  lines.push(`- total entries analyzed: ${entryQuestions.size}`);
  lines.push("");

  if (overlaps.length === 0) {
    lines.push("No entries shared across multiple questions.");
    if (questions.length < 2) {
      lines.push("");
      lines.push(
        "(Cross-question analysis requires 2+ questions. Rerun with `--emit-json` and multiple questions.)",
      );
    }
    return lines.join("\n") + "\n";
  }

  lines.push("| # | entry path | question count | questions | shared classes |");
  lines.push("| --- | --- | --- | --- | --- |");
  overlaps.slice(0, 30).forEach((row, index) => {
    lines.push(
      `| ${index + 1} | \`${row.path}\` | ${row.questionCount} | ${row.digests.map((d) => `\`${d}\``).join(", ")} | ${row.sharedClasses.join(", ")} |`,
    );
  });
  if (overlaps.length > 30) {
    lines.push("");
    lines.push(
      `Showing first 30 of ${overlaps.length} overlapping entries. See \`data/cross-question.json\` for full list.`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

export function renderCoverageGaps(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 08 Coverage Gaps");
  lines.push("");
  lines.push(
    "Aggregate evidence-pack gaps and question-class coverage across all questions.",
  );
  lines.push("");

  const missingRequirements = new Map<string, string[]>();
  for (const question of questions) {
    for (const missing of question.evidencePackMissing) {
      const affected = missingRequirements.get(missing) ?? [];
      affected.push(question.digest);
      missingRequirements.set(missing, affected);
    }
  }

  const classCoverage = new Map<
    string,
    { count: number; lowConfidence: number; noJson: number }
  >();
  for (const question of questions) {
    const entry = classCoverage.get(question.class) ?? {
      count: 0,
      lowConfidence: 0,
      noJson: 0,
    };
    entry.count += 1;
    if (question.confidence?.level === "low") entry.lowConfidence += 1;
    if (!question.answerJsonPresent) entry.noJson += 1;
    classCoverage.set(question.class, entry);
  }

  lines.push(`- unmet requirements: ${missingRequirements.size}`);
  lines.push(`- question classes observed: ${classCoverage.size}`);
  lines.push("");

  lines.push("## Unmet Evidence Requirements");
  lines.push("");
  if (missingRequirements.size === 0) {
    lines.push("All evidence-pack requirements satisfied across all questions.");
    lines.push("");
  } else {
    lines.push("| requirement | affected questions | question digests |");
    lines.push("| --- | --- | --- |");
    const sortedReqs = [...missingRequirements.entries()].sort(
      (a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0]),
    );
    for (const [req, digests] of sortedReqs) {
      lines.push(
        `| ${escapeTableCell(req)} | ${digests.length} | ${digests
          .sort()
          .map((d) => `\`${d}\``)
          .join(", ")} |`,
      );
    }
    lines.push("");
  }

  lines.push("## Class Coverage");
  lines.push("");
  if (classCoverage.size === 0) {
    lines.push("No questions.");
    lines.push("");
  } else {
    lines.push("| class | question count | low-confidence | no-json-sidecar |");
    lines.push("| --- | --- | --- | --- |");
    const sortedClasses = [...classCoverage.entries()].sort((a, b) =>
      a[0].localeCompare(b[0]),
    );
    for (const [cls, stats] of sortedClasses) {
      lines.push(
        `| ${cls} | ${stats.count} | ${stats.lowConfidence} | ${stats.noJson} |`,
      );
    }
    lines.push("");
  }

  return lines.join("\n");
}

export interface InsightCorrelationRow {
  lens: string;
  findingCount: number;
  entryCount: number;
  severityDistribution: Record<string, number>;
  topEntries: string[];
}

export function renderInsightCorrelation(questions: NormalizedQuestion[]): string {
  const lines: string[] = [];
  lines.push("# 09 Insight Correlation");
  lines.push("");
  lines.push(
    "Aggregate insight lenses across all questions. Lenses firing across multiple entries signal systemic issues rather than isolated findings.",
  );
  lines.push("");

  const byLens = new Map<
    string,
    { count: number; entries: Set<string>; severity: Record<string, number> }
  >();
  for (const question of questions) {
    for (const insight of question.insights) {
      const current = byLens.get(insight.lens) ?? {
        count: 0,
        entries: new Set<string>(),
        severity: {},
      };
      current.count += insight.occurrences;
      if (insight.entry) current.entries.add(insight.entry);
      current.severity[insight.severity] = (current.severity[insight.severity] ?? 0) + 1;
      byLens.set(insight.lens, current);
    }
  }

  const rows: InsightCorrelationRow[] = [...byLens.entries()]
    .map(([lens, data]) => ({
      lens,
      findingCount: data.count,
      entryCount: data.entries.size,
      severityDistribution: data.severity,
      topEntries: [...data.entries].sort().slice(0, 5),
    }))
    .sort((a, b) => b.findingCount - a.findingCount || a.lens.localeCompare(b.lens));

  lines.push(`- lenses active: ${rows.length}`);
  lines.push(`- systemic (3+ entries): ${rows.filter((r) => r.entryCount >= 3).length}`);
  lines.push("");

  if (rows.length === 0) {
    lines.push("No insight data available.");
    lines.push("");
    lines.push(
      "(Rerun `prism knowledge answer` with `--emit-json` to populate insight correlation.)",
    );
    return lines.join("\n") + "\n";
  }

  lines.push(
    "| lens | finding count | entry count | high | medium | low | info | top entries |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const row of rows) {
    const topStr = row.topEntries.map((e) => `\`${e}\``).join(", ");
    lines.push(
      `| ${row.lens} | ${row.findingCount} | ${row.entryCount} | ${row.severityDistribution["high"] ?? 0} | ${row.severityDistribution["medium"] ?? 0} | ${row.severityDistribution["low"] ?? 0} | ${row.severityDistribution["info"] ?? 0} | ${topStr} |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}

const CROSS_SLICE_SEVERITY_WEIGHT: Record<string, number> = {
  high: 4,
  medium: 3,
  low: 2,
  info: 1,
};
const TOP_HOTSPOTS = 30;
const TOP_CO_OCCURRENCE = 30;

export function renderCrossSlice(insights: KnowledgeInsightSummary[]): string {
  const lines: string[] = [];
  lines.push("# 30 Cross-Slice Analysis");
  lines.push("");
  lines.push(
    "Repo-wide aggregation across all entries and lenses. Unlike page 09 (question-scoped), this page uses the full knowledge-pack insight set.",
  );
  lines.push("");

  const byEntry = new Map<
    string,
    { lenses: Map<string, number>; severity: Record<string, number>; count: number }
  >();
  for (const insight of insights) {
    const current = byEntry.get(insight.entry) ?? {
      lenses: new Map<string, number>(),
      severity: {},
      count: 0,
    };
    current.count += 1;
    current.lenses.set(insight.lens, (current.lenses.get(insight.lens) ?? 0) + 1);
    current.severity[insight.severity] = (current.severity[insight.severity] ?? 0) + 1;
    byEntry.set(insight.entry, current);
  }

  const severityTotals = { high: 0, medium: 0, low: 0, info: 0 };
  for (const insight of insights) {
    if (insight.severity in severityTotals) {
      severityTotals[insight.severity as keyof typeof severityTotals] += 1;
    }
  }

  const lensEntries = new Map<string, Set<string>>();
  for (const insight of insights) {
    const entries = lensEntries.get(insight.lens) ?? new Set<string>();
    entries.add(insight.entry);
    lensEntries.set(insight.lens, entries);
  }

  lines.push(`- total findings: ${insights.length}`);
  lines.push(`- entries analyzed: ${byEntry.size}`);
  lines.push(`- lenses active: ${lensEntries.size}`);
  lines.push(
    `- severity: high=${severityTotals.high}, medium=${severityTotals.medium}, low=${severityTotals.low}, info=${severityTotals.info}`,
  );
  lines.push("");

  if (insights.length === 0) {
    lines.push("No insight data available.");
    lines.push("");
    lines.push(
      "(Run `prism knowledge build` to generate insights, then regenerate this report.)",
    );
    return lines.join("\n") + "\n";
  }

  lines.push("## Entry Hotspots");
  lines.push("");
  lines.push(
    `Top ${Math.min(byEntry.size, TOP_HOTSPOTS)} entries by severity-weighted score.`,
  );
  lines.push("");
  lines.push(
    "| # | entry | findings | score | high | med | low | info | lens spread | top lenses |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");

  const hotspots = [...byEntry.entries()]
    .map(([entry, data]) => {
      const h = data.severity["high"] ?? 0;
      const m = data.severity["medium"] ?? 0;
      const l = data.severity["low"] ?? 0;
      const inf = data.severity["info"] ?? 0;
      const score =
        h * CROSS_SLICE_SEVERITY_WEIGHT["high"]! +
        m * CROSS_SLICE_SEVERITY_WEIGHT["medium"]! +
        l * CROSS_SLICE_SEVERITY_WEIGHT["low"]! +
        inf * CROSS_SLICE_SEVERITY_WEIGHT["info"]!;
      const topLenses = [...data.lenses.entries()]
        .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
        .slice(0, 5)
        .map(([lens]) => lens);
      return {
        entry,
        count: data.count,
        score,
        h,
        m,
        l,
        inf,
        spread: data.lenses.size,
        topLenses,
      };
    })
    .sort(
      (a, b) => b.score - a.score || b.count - a.count || a.entry.localeCompare(b.entry),
    );

  hotspots.slice(0, TOP_HOTSPOTS).forEach((row, index) => {
    lines.push(
      `| ${index + 1} | \`${row.entry}\` | ${row.count} | ${row.score} | ${row.h} | ${row.m} | ${row.l} | ${row.inf} | ${row.spread} | ${row.topLenses.join(", ")} |`,
    );
  });
  if (byEntry.size > TOP_HOTSPOTS) {
    lines.push("");
    lines.push(
      `Showing first ${TOP_HOTSPOTS} of ${byEntry.size} entries. See \`data/cross-slice.json\` for full list.`,
    );
  }
  lines.push("");

  lines.push("## Lens Co-Occurrence");
  lines.push("");
  lines.push(
    "Lens pairs firing on 2+ shared entries. Signals correlated code quality issues.",
  );
  lines.push("");

  const lensIds = [...lensEntries.keys()].sort();
  const coOccurrence: Array<{
    lensA: string;
    lensB: string;
    sharedCount: number;
    entries: string[];
  }> = [];
  for (let i = 0; i < lensIds.length; i++) {
    for (let j = i + 1; j < lensIds.length; j++) {
      const a = lensEntries.get(lensIds[i]!)!;
      const b = lensEntries.get(lensIds[j]!)!;
      const shared = [...a].filter((e) => b.has(e)).sort();
      if (shared.length >= 2) {
        coOccurrence.push({
          lensA: lensIds[i]!,
          lensB: lensIds[j]!,
          sharedCount: shared.length,
          entries: shared.slice(0, 10),
        });
      }
    }
  }
  coOccurrence.sort(
    (a, b) =>
      b.sharedCount - a.sharedCount ||
      a.lensA.localeCompare(b.lensA) ||
      a.lensB.localeCompare(b.lensB),
  );

  if (coOccurrence.length === 0) {
    lines.push("No lens pairs share 2+ entries.");
  } else {
    lines.push("| lens A | lens B | shared entries | entry list |");
    lines.push("| --- | --- | --- | --- |");
    coOccurrence.slice(0, TOP_CO_OCCURRENCE).forEach((row) => {
      lines.push(
        `| ${row.lensA} | ${row.lensB} | ${row.sharedCount} | ${row.entries.map((e) => `\`${e}\``).join(", ")} |`,
      );
    });
    if (coOccurrence.length > TOP_CO_OCCURRENCE) {
      lines.push("");
      lines.push(
        `Showing first ${TOP_CO_OCCURRENCE} of ${coOccurrence.length} pairs. See \`data/cross-slice.json\`.`,
      );
    }
  }
  lines.push("");

  lines.push("## How to Read This Page");
  lines.push("");
  lines.push(
    "- **Hotspots**: entries with high severity scores are candidates for focused refactoring",
  );
  lines.push(
    "- **Co-occurrence**: lens pairs firing together suggest structural patterns (e.g., bloater + complexity often co-occur in god objects)",
  );
  lines.push("- Full data: see `data/cross-slice.json`");
  lines.push("");

  return lines.join("\n");
}

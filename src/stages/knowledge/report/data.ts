import { writeJsonIfChanged } from "../../../lib/knowledge-render.ts";
import { join } from "node:path";
import type { NormalizedQuestion } from "./sidecar-loader.ts";
import type { StrictIssue, StrictSummary } from "./strict.ts";
import type { KnowledgeInsightSummary } from "../../../schemas/knowledge.ts";

export async function writeDataFiles(input: {
  dataDirAbs: string;
  questions: NormalizedQuestion[];
  issuesByDigest: Map<string, StrictIssue[]>;
  strictSummary: StrictSummary | null;
  insights: KnowledgeInsightSummary[];
  force: boolean;
}): Promise<{
  questionsPath: string;
  entriesRollupPath: string;
  strictRollupPath: string;
  lensFindingsPath: string;
  crossQuestionPath: string;
}> {
  const questionsPath = join(input.dataDirAbs, "questions.json");
  const entriesRollupPath = join(input.dataDirAbs, "entries-rollup.json");
  const strictRollupPath = join(input.dataDirAbs, "strict-rollup.json");
  const lensFindingsPath = join(input.dataDirAbs, "lens-findings.json");
  const crossQuestionPath = join(input.dataDirAbs, "cross-question.json");

  await writeJsonIfChanged(
    questionsPath,
    {
      schemaVersion: 1,
      count: input.questions.length,
      questions: input.questions.map((question) => ({
        digest: question.digest,
        question: question.question,
        class: question.class,
        classConfidence: question.classConfidence,
        evidencePackStatus: question.evidencePackStatus,
        evidencePackRequirements: question.evidencePackRequirements,
        evidencePackSatisfied: question.evidencePackSatisfied,
        evidencePackMissing: question.evidencePackMissing,
        confidence: question.confidence ?? null,
        failOpenTriggered: question.failOpenTriggered ?? null,
        failOpenReasons: question.failOpenReasons,
        intent: question.intent ?? null,
        answerJsonPresent: question.answerJsonPresent,
        entryCount: question.entries.length,
        insightCount: question.insights.length,
      })),
    },
    input.force,
  );

  const rollup = buildEntriesRollup(input.questions);
  await writeJsonIfChanged(
    entriesRollupPath,
    {
      schemaVersion: 1,
      entryCount: rollup.length,
      entries: rollup,
    },
    input.force,
  );

  await writeJsonIfChanged(
    strictRollupPath,
    {
      schemaVersion: 1,
      summary: input.strictSummary,
      issues: input.questions.flatMap((question) =>
        (input.issuesByDigest.get(question.digest) ?? []).map((issue) => ({
          questionDigest: issue.questionDigest,
          category: issue.category,
          detail: issue.detail,
        })),
      ),
    },
    input.force,
  );

  const lensFindingsByLens = buildLensFindingsRollup(input.insights);
  await writeJsonIfChanged(
    lensFindingsPath,
    {
      schemaVersion: 1,
      lensCount: lensFindingsByLens.length,
      lenses: lensFindingsByLens,
    },
    input.force,
  );

  const crossQuestion = buildCrossQuestionData(input.questions);
  await writeJsonIfChanged(crossQuestionPath, crossQuestion, input.force);

  return {
    questionsPath,
    entriesRollupPath,
    strictRollupPath,
    lensFindingsPath,
    crossQuestionPath,
  };
}

export interface EntryRollupRow {
  path: string;
  questionCount: number;
  totalScore: number;
  maxScore: number;
  questions: Array<{
    digest: string;
    run: string;
    name: string;
    score: number;
    status: "success" | "failed";
    codeExists: boolean;
  }>;
}

export function buildEntriesRollup(questions: NormalizedQuestion[]): EntryRollupRow[] {
  const byPath = new Map<string, EntryRollupRow>();
  for (const question of questions) {
    for (const entry of question.entries) {
      if (!entry.path) continue;
      const current =
        byPath.get(entry.path) ??
        ({
          path: entry.path,
          questionCount: 0,
          totalScore: 0,
          maxScore: 0,
          questions: [],
        } satisfies EntryRollupRow);
      current.questionCount += 1;
      current.totalScore += entry.score;
      current.maxScore = Math.max(current.maxScore, entry.score);
      current.questions.push({
        digest: question.digest,
        run: entry.run,
        name: entry.name,
        score: entry.score,
        status: entry.status,
        codeExists: entry.codeExists,
      });
      byPath.set(entry.path, current);
    }
  }

  const rows = [...byPath.values()];
  for (const row of rows) {
    row.questions.sort((a, b) => b.score - a.score || a.digest.localeCompare(b.digest));
  }
  return rows.sort(
    (a, b) =>
      b.totalScore - a.totalScore ||
      b.questionCount - a.questionCount ||
      a.path.localeCompare(b.path),
  );
}

const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

interface LensFindingsGroup {
  lens: string;
  findingCount: number;
  severityDistribution: Record<string, number>;
  findings: Array<{
    entry: string;
    severity: string;
    title: string;
    evidenceCount: number;
    evidenceFile?: string;
    evidenceLine?: number;
  }>;
}

function buildLensFindingsRollup(
  insights: KnowledgeInsightSummary[],
): LensFindingsGroup[] {
  const byLens = new Map<string, KnowledgeInsightSummary[]>();
  for (const insight of insights) {
    const list = byLens.get(insight.lens) ?? [];
    list.push(insight);
    byLens.set(insight.lens, list);
  }
  const groups: LensFindingsGroup[] = [];
  for (const [lens, items] of byLens) {
    const severityDist: Record<string, number> = {};
    for (const item of items) {
      severityDist[item.severity] = (severityDist[item.severity] ?? 0) + 1;
    }
    const sorted = items
      .slice()
      .sort(
        (a, b) =>
          (SEVERITY_ORDER[a.severity] ?? 9) - (SEVERITY_ORDER[b.severity] ?? 9) ||
          a.entry.localeCompare(b.entry) ||
          a.title.localeCompare(b.title),
      );
    groups.push({
      lens,
      findingCount: items.length,
      severityDistribution: severityDist,
      findings: sorted.map((item) => ({
        entry: item.entry,
        severity: item.severity,
        title: item.title,
        evidenceCount: item.evidenceCount,
        ...(item.evidenceFile ? { evidenceFile: item.evidenceFile } : {}),
        ...(item.evidenceLine ? { evidenceLine: item.evidenceLine } : {}),
      })),
    });
  }
  return groups.sort((a, b) => a.lens.localeCompare(b.lens));
}

function buildCrossQuestionData(questions: NormalizedQuestion[]) {
  const entryQuestions = new Map<string, Set<string>>();
  for (const question of questions) {
    for (const entry of question.entries) {
      if (!entry.path) continue;
      const digests = entryQuestions.get(entry.path) ?? new Set();
      digests.add(question.digest);
      entryQuestions.set(entry.path, digests);
    }
  }

  const overlaps = [...entryQuestions.entries()]
    .filter(([, digests]) => digests.size > 1)
    .map(([path, digests]) => ({
      path,
      questionCount: digests.size,
      questions: [...digests].sort(),
    }))
    .sort((a, b) => b.questionCount - a.questionCount || a.path.localeCompare(b.path));

  const missingRequirements = new Map<string, string[]>();
  for (const question of questions) {
    for (const missing of question.evidencePackMissing) {
      const affected = missingRequirements.get(missing) ?? [];
      affected.push(question.digest);
      missingRequirements.set(missing, affected);
    }
  }
  const gaps = [...missingRequirements.entries()]
    .map(([requirement, digests]) => ({
      requirement,
      affectedQuestions: digests.length,
      questions: digests.sort(),
    }))
    .sort(
      (a, b) =>
        b.affectedQuestions - a.affectedQuestions ||
        a.requirement.localeCompare(b.requirement),
    );

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
  const systemicLenses = [...byLens.entries()]
    .filter(([, data]) => data.entries.size >= 3)
    .map(([lens, data]) => ({
      lens,
      findingCount: data.count,
      entryCount: data.entries.size,
      severityDistribution: data.severity,
    }))
    .sort((a, b) => b.findingCount - a.findingCount || a.lens.localeCompare(b.lens));

  return {
    schemaVersion: 1,
    questionCount: questions.length,
    overlap: { count: overlaps.length, entries: overlaps },
    gaps: { count: gaps.length, requirements: gaps },
    systemicLenses: { count: systemicLenses.length, lenses: systemicLenses },
  };
}

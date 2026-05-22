import { writeJsonIfChanged } from "../../../lib/knowledge-render.ts";
import { join } from "node:path";
import type { NormalizedQuestion } from "./sidecar-loader.ts";
import type { StrictIssue, StrictSummary } from "./strict.ts";

export async function writeDataFiles(input: {
  dataDirAbs: string;
  questions: NormalizedQuestion[];
  issuesByDigest: Map<string, StrictIssue[]>;
  strictSummary: StrictSummary | null;
  force: boolean;
}): Promise<{
  questionsPath: string;
  entriesRollupPath: string;
  strictRollupPath: string;
}> {
  const questionsPath = join(input.dataDirAbs, "questions.json");
  const entriesRollupPath = join(input.dataDirAbs, "entries-rollup.json");
  const strictRollupPath = join(input.dataDirAbs, "strict-rollup.json");

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

  return { questionsPath, entriesRollupPath, strictRollupPath };
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

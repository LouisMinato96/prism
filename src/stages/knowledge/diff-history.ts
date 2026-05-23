import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { log } from "../../lib/log.ts";
import { runKnowledgeDiff, type DiffResult, type DiffVerdict } from "./diff.ts";

export interface DiffHistoryEntry {
  timestamp: string;
  baseDigest: string;
  headDigest: string;
  verdict: DiffVerdict;
  score: number;
  questionCount: { base: number; head: number };
  strictIssuesDelta: { new: number; resolved: number };
  lensFindingsDelta: { new: number; resolved: number };
  confidenceDelta: { improved: number; regressed: number };
}

export interface DiffHistory {
  schemaVersion: 1;
  entries: DiffHistoryEntry[];
}

function snapshotFromResult(result: DiffResult): DiffHistoryEntry {
  return {
    timestamp: new Date().toISOString(),
    baseDigest: result.base.digest,
    headDigest: result.head.digest,
    verdict: result.verdict,
    score: result.score,
    questionCount: {
      base: result.base.questionCount,
      head: result.head.questionCount,
    },
    strictIssuesDelta: {
      new: result.strict.filter((s) => s.type === "new").length,
      resolved: result.strict.filter((s) => s.type === "resolved").length,
    },
    lensFindingsDelta: {
      new: result.lenses.filter((l) => l.type === "new").length,
      resolved: result.lenses.filter((l) => l.type === "resolved").length,
    },
    confidenceDelta: {
      improved: result.confidence.filter((c) => c.type === "improved").length,
      regressed: result.confidence.filter((c) => c.type === "regressed").length,
    },
  };
}

export async function loadDiffHistory(path: string): Promise<DiffHistory> {
  if (!existsSync(path)) {
    return { schemaVersion: 1, entries: [] };
  }
  const raw = JSON.parse(await readFile(path, "utf8"));
  return raw as DiffHistory;
}

export async function runKnowledgeDiffHistory(options: {
  basePath: string;
  headPath: string;
  historyPath: string;
}): Promise<DiffHistory> {
  const stage = "knowledge:diff-history";
  log.step("running diff for history snapshot", stage);

  const result = await runKnowledgeDiff({
    basePath: options.basePath,
    headPath: options.headPath,
    strict: false,
    json: false,
  });

  const snapshot = snapshotFromResult(result);
  const history = await loadDiffHistory(options.historyPath);
  history.entries.push(snapshot);

  await writeFile(options.historyPath, JSON.stringify(history, null, 2));
  log.done(`${history.entries.length} entries in history`, stage);
  return history;
}

export function formatDiffHistoryMarkdown(history: DiffHistory): string {
  const lines: string[] = [];
  lines.push("# Diff History Trend");
  lines.push("");

  if (history.entries.length === 0) {
    lines.push("No entries recorded yet.");
    lines.push("");
    return lines.join("\n");
  }

  lines.push(
    "| # | timestamp | verdict | score | questions (base→head) | strict (+/-) | lenses (+/-) | confidence (↑/↓) |",
  );
  lines.push("| --- | --- | --- | --- | --- | --- | --- | --- |");

  for (let i = 0; i < history.entries.length; i++) {
    const e = history.entries[i]!;
    const ts = e.timestamp.slice(0, 19).replace("T", " ");
    lines.push(
      `| ${i + 1} | ${ts} | ${e.verdict} | ${e.score} | ${e.questionCount.base}→${e.questionCount.head} | +${e.strictIssuesDelta.new}/-${e.strictIssuesDelta.resolved} | +${e.lensFindingsDelta.new}/-${e.lensFindingsDelta.resolved} | ↑${e.confidenceDelta.improved}/↓${e.confidenceDelta.regressed} |`,
    );
  }

  lines.push("");
  return lines.join("\n");
}

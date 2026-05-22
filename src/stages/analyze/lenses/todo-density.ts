import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const PATTERN = /\b(TODO|FIXME|HACK|XXX)\b/g;
const LOW_THRESHOLD = 5;
const MEDIUM_THRESHOLD = 15;

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    const text = source.getFullText();
    const matches = text.match(PATTERN);
    const count = matches ? matches.length : 0;
    if (count === 0) continue;

    const severity =
      count >= MEDIUM_THRESHOLD ? "medium" : count >= LOW_THRESHOLD ? "low" : "info";

    counter += 1;
    insights.push({
      id: `todo-density-${counter}`,
      severity,
      lens: "todo-density",
      title: `${count} TODO/FIXME/HACK/XXX markers in ${filePath}`,
      evidence: [{ file: filePath, detail: `${count} markers` }],
      explanation: `File contains ${count} TODO/FIXME/HACK/XXX comments. Accumulation signals deferred work or known issues.`,
      suggestion: "Triage each marker: open a ticket, fix inline, or remove if obsolete.",
      metric: { name: "marker-count", value: count, threshold: LOW_THRESHOLD },
    });
  }

  return insights;
}

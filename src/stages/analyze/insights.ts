import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SourceFile } from "ts-morph";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeInsightsSchema,
  type AnalyzeGraph,
  type AnalyzeInsights,
  type AnalyzeScope,
  type AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import type { AnalyzeDiagram } from "./diagrams.ts";
import { createAnalyzeProject, toAbsolutePath } from "./utils.ts";
import { runLenses } from "./lenses/index.ts";

export async function runAnalyzeInsights(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  graph: AnalyzeGraph,
  diagrams: AnalyzeDiagram[],
  opts: { force?: boolean } = {},
): Promise<AnalyzeInsights> {
  const stage = "analyze:insights";

  if (!opts.force && existsSync(wd.insightsFile())) {
    log.done("cached", stage);
    return AnalyzeInsightsSchema.parse(await Bun.file(wd.insightsFile()).json());
  }

  log.step("running deterministic lenses", stage);

  const project = createAnalyzeProject();
  const sourceFiles = new Map<string, SourceFile>();
  for (const file of scope.files) {
    try {
      const source = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
      sourceFiles.set(file.path, source);
    } catch {
      // skip files that cannot be parsed (lens detectors handle absence)
    }
  }

  const insights = runLenses({
    entry: graph.entry,
    scope,
    symbols,
    graph,
    diagrams,
    sourceFiles,
  }).sort((a, b) => a.id.localeCompare(b.id));

  for (const file of sourceFiles.values()) {
    project.removeSourceFile(file);
  }

  const result: AnalyzeInsights = {
    entry: graph.entry,
    generatedFrom: "graph.json",
    insights,
  };

  await writeFile(wd.insightsFile(), JSON.stringify(result, null, 2));
  log.done(`${insights.length} insights`, stage);
  return result;
}

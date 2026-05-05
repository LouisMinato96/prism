import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Workdir } from "../lib/workdir.ts";
import type { Coverage, Review } from "../schemas/index.ts";
import { callClaude } from "../lib/claude.ts";
import { log } from "../lib/log.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

const AggregateSchema = z.object({
  markdown: z.string(),
});

export async function runAggregate(
  wd: Workdir,
  reviews: Review[],
  coverage: Coverage[],
  meta: { title: string },
  opts: { force?: boolean } = {},
): Promise<string> {
  const stage = "aggregate";

  if (!opts.force && existsSync(wd.finalReport())) {
    log.done("cached", stage);
    return await readFile(wd.finalReport(), "utf8");
  }

  log.step(`aggregating ${reviews.length} reviews`, stage);

  const input = JSON.stringify(
    {
      pr: wd.pr,
      title: meta.title,
      reviews,
      coverage,
    },
    null,
    2,
  );

  const result = await callClaude({
    promptFile: join(PROMPTS_DIR, "aggregate.md"),
    input,
    schema: AggregateSchema,
    tag: stage,
  });

  await writeFile(wd.finalReport(), result.markdown);
  log.done(wd.finalReport(), stage);
  return result.markdown;
}

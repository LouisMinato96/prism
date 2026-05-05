import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import type { Workdir } from "../lib/workdir.ts";
import type { Coverage, Review, Routing } from "../schemas/index.ts";
import type { PrMeta } from "../lib/gh.ts";
import { callClaude } from "../lib/claude.ts";
import { log } from "../lib/log.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

const ArchitectureSchema = z.object({
  markdown: z.string(),
});

export async function runArchitecture(
  wd: Workdir,
  reviews: Review[],
  coverage: Coverage[],
  routing: Routing,
  meta: PrMeta,
  opts: { force?: boolean } = {},
): Promise<string> {
  const stage = "architecture";

  if (!opts.force && existsSync(wd.architectureReport())) {
    log.done("cached", stage);
    return await readFile(wd.architectureReport(), "utf8");
  }

  log.step(`generating architecture diagram`, stage);

  const input = JSON.stringify(
    {
      pr: wd.pr,
      title: meta.title,
      files: meta.files,
      routing,
      reviews,
      coverage,
    },
    null,
    2,
  );

  const result = await callClaude({
    promptFile: join(PROMPTS_DIR, "architecture.md"),
    input,
    schema: ArchitectureSchema,
    tag: stage,
  });

  await writeFile(wd.architectureReport(), result.markdown);
  log.done(wd.architectureReport(), stage);
  return result.markdown;
}

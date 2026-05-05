import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import type { Workdir } from "../lib/workdir.ts";
import { RoutingSchema, type Routing } from "../schemas/index.ts";
import { callClaude } from "../lib/claude.ts";
import { log } from "../lib/log.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

export async function runClassify(
  wd: Workdir,
  files: string[],
  opts: { force?: boolean } = {},
): Promise<Routing> {
  const stage = "classify";

  if (!opts.force && existsSync(wd.routingFile())) {
    log.done("cached", stage);
    return RoutingSchema.parse(await Bun.file(wd.routingFile()).json());
  }

  log.step(`classifying ${files.length} files`, stage);

  const routing = await callClaude({
    promptFile: join(PROMPTS_DIR, "classify.md"),
    input: files.join("\n"),
    schema: RoutingSchema,
    tag: stage,
  });

  await writeFile(wd.routingFile(), JSON.stringify(routing, null, 2));
  log.done(`${routing.routes.length} routed, ${routing.skipped.length} skipped`, stage);
  return routing;
}

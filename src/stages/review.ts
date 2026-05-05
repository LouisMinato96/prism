import { writeFile, readFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import pLimit from "p-limit";
import type { Workdir } from "../lib/workdir.ts";
import {
  ReviewSchema,
  type Review,
  type Routing,
  type Reviewer,
  type FileUnits,
  type Coverage,
} from "../schemas/index.ts";
import { callClaude } from "../lib/claude.ts";
import { Tracker } from "../lib/tracker.ts";
import { config } from "../config.ts";
import { log } from "../lib/log.ts";

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = join(__dirname, "..", "..", "prompts");

interface ReviewTask {
  file: string;
  reviewer: Reviewer;
  units: FileUnits;
  missingUnits?: string[];
}

export async function runReviews(
  wd: Workdir,
  routing: Routing,
  unitsByFile: Map<string, FileUnits>,
  opts: { force?: boolean } = {},
): Promise<Review[]> {
  const stage = "review";
  const tracker = new Tracker(wd);

  const tasks: ReviewTask[] = [];
  for (const route of routing.routes) {
    const units = unitsByFile.get(route.file);
    if (!units) {
      log.warn(`no units for ${route.file}, skipping`, stage);
      continue;
    }
    for (const reviewer of route.reviewers) {
      tasks.push({ file: route.file, reviewer, units });
    }
  }

  log.step(`running ${tasks.length} reviews (concurrency=${config.concurrency})`, stage);

  const limit = pLimit(config.concurrency);
  const results = await Promise.all(
    tasks.map((task) => limit(() => runOne(wd, tracker, task, opts.force))),
  );

  log.done(`${results.filter(Boolean).length}/${tasks.length} reviews`, stage);
  return results.filter((r): r is Review => r !== null);
}

async function runOne(
  wd: Workdir,
  tracker: Tracker,
  task: ReviewTask,
  force: boolean | undefined,
): Promise<Review | null> {
  const { file, reviewer } = task;
  const reviewPath = wd.reviewFor(file, reviewer);

  if (!force && existsSync(reviewPath)) {
    const existing = ReviewSchema.parse(await Bun.file(reviewPath).json());
    return existing;
  }

  await tracker.write({
    file,
    reviewer,
    status: "in_progress",
    iteration: task.missingUnits ? 1 : 0,
    covered: 0,
    total: task.units.units?.length ?? 0,
    updated_at: new Date().toISOString(),
  });

  try {
    const input = await buildInput(task, wd);
    const review = await callClaude({
      promptFile: join(PROMPTS_DIR, `review-${reviewer}.md`),
      input,
      schema: ReviewSchema,
      tag: `review:${reviewer}:${file}`,
      extraContext: task.missingUnits
        ? `Previous attempt did not cover these units: ${task.missingUnits.join(", ")}. Analyze ONLY these.`
        : undefined,
    });

    await writeFile(reviewPath, JSON.stringify(review, null, 2));
    await tracker.write({
      file,
      reviewer,
      status: "done",
      iteration: review.iteration,
      covered: review.units_analyzed.length,
      total: task.units.units?.length ?? 0,
      updated_at: new Date().toISOString(),
    });
    return review;
  } catch (err) {
    const msg = (err as Error).message;
    log.error(`${file} ${reviewer}: ${msg}`, "review");
    await tracker.write({
      file,
      reviewer,
      status: "failed",
      iteration: 0,
      covered: 0,
      total: task.units.units?.length ?? 0,
      updated_at: new Date().toISOString(),
      error: msg,
    });
    return null;
  }
}

/**
 * Re-run reviews for (file, reviewer) pairs where coverage is incomplete.
 * Merges new units_analyzed + findings into existing reviews.
 * Deletes cached review files so runOne re-runs them.
 */
export async function retryIncomplete(
  wd: Workdir,
  existingReviews: Review[],
  incompleteCoverage: Coverage[],
  unitsByFile: Map<string, FileUnits>,
  iteration: number,
): Promise<Review[]> {
  const stage = "retry";
  const tracker = new Tracker(wd);

  const reviewMap = new Map<string, Review>();
  for (const r of existingReviews) {
    reviewMap.set(`${r.file}::${r.reviewer}`, r);
  }

  const tasks: ReviewTask[] = [];
  for (const cov of incompleteCoverage) {
    const units = unitsByFile.get(cov.file);
    if (!units) continue;
    tasks.push({
      file: cov.file,
      reviewer: cov.reviewer,
      units,
      missingUnits: cov.missing,
    });
    // delete cached review so runOne doesn't short-circuit
    const reviewPath = wd.reviewFor(cov.file, cov.reviewer);
    if (existsSync(reviewPath)) {
      await Bun.write(reviewPath + ".prev", await Bun.file(reviewPath).text());
      const { unlink } = await import("node:fs/promises");
      await unlink(reviewPath);
    }
  }

  log.step(`retrying ${tasks.length} reviews (iteration ${iteration})`, stage);

  const limit = pLimit(config.concurrency);
  const retryResults = await Promise.all(
    tasks.map((task) => limit(() => runOne(wd, tracker, task, true))),
  );

  const merged: Review[] = [...existingReviews];
  for (const retry of retryResults) {
    if (!retry) continue;
    const key = `${retry.file}::${retry.reviewer}`;
    const existing = reviewMap.get(key);
    if (existing) {
      const existingNames = new Set(existing.units_analyzed.map((u) => u.name));
      const newUnits = retry.units_analyzed.filter((u) => !existingNames.has(u.name));
      existing.units_analyzed.push(...newUnits);
      existing.findings.push(...retry.findings);
      existing.iteration = iteration;
      // persist merged review
      await writeFile(
        wd.reviewFor(existing.file, existing.reviewer),
        JSON.stringify(existing, null, 2),
      );
    } else {
      merged.push(retry);
    }
  }

  log.done(`${retryResults.filter(Boolean).length}/${tasks.length} retries`, stage);
  return merged;
}

async function buildInput(task: ReviewTask, wd: Workdir): Promise<string> {
  const { file, units } = task;
  const parts: string[] = [
    `FILE: ${file}`,
    "",
    "UNITS TO ANALYZE:",
    JSON.stringify(units.units, null, 2),
    "",
  ];

  const diffPath = wd.diffFor(file);
  if (existsSync(diffPath)) {
    const diff = await readFile(diffPath, "utf8");
    parts.push("DIFF:", diff, "");
  }

  if (existsSync(file)) {
    const source = await readFile(file, "utf8");
    parts.push("SOURCE:", source);
  }

  return parts.join("\n");
}

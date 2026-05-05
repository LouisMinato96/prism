import { parseArgs } from "node:util";
import { Workdir } from "./lib/workdir.ts";
import { log } from "./lib/log.ts";
import { config } from "./config.ts";
import { runFetch } from "./stages/fetch.ts";
import { postPrComment, editPrComment } from "./lib/gh.ts";
import { runEnumerate } from "./stages/enumerate.ts";
import { runClassify } from "./stages/classify.ts";
import { runReviews, retryIncomplete } from "./stages/review.ts";
import { runCoverage } from "./stages/coverage.ts";
import { runAggregate } from "./stages/aggregate.ts";
import { runArchitecture } from "./stages/architecture.ts";
import type { FileUnits } from "./schemas/index.ts";
import type { PrMeta } from "./lib/gh.ts";

function usage(): never {
  console.log(`prism — deterministic LLM-orchestrated PR review harness

USAGE:
  prism review <pr-number> [options]

OPTIONS:
  --force              Re-run all stages, ignoring cached output
  --force-stage <name> Force re-run of a single stage (fetch|enumerate|classify|review|coverage|aggregate|architecture)
  --post               Post the final report as a PR comment via gh
  --edit               Edit the last prism comment instead of posting a new one
  --resume             Default behavior: skip stages with existing output
  --help               Show this message

ENV VARS:
  PRISM_CONCURRENCY    Max parallel reviews (default: 4)
  PRISM_MAX_RETRIES    Claude call retries (default: 3)
  PRISM_MAX_ITER       Coverage retry iterations (default: 2)
  PRISM_VERBOSE=1      Verbose logging
`);
  process.exit(1);
}

async function main() {
  const { values, positionals } = parseArgs({
    args: Bun.argv.slice(2),
    options: {
      force: { type: "boolean", default: false },
      "force-stage": { type: "string" },
      post: { type: "boolean", default: false },
      edit: { type: "boolean", default: false },
      resume: { type: "boolean", default: false },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) usage();

  const [cmd, prArg] = positionals;
  if (cmd !== "review" || !prArg) usage();

  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) {
    log.error(`invalid PR number: ${prArg}`);
    process.exit(1);
  }

  const force = values.force === true;
  const forceStage = values["force-stage"] as string | undefined;
  const isForced = (s: string) => force || forceStage === s;

  const wd = new Workdir(pr);
  await wd.ensureAll();

  log.step(`PR #${pr} → ${wd.root}`, "init");
  log.info(
    `concurrency=${config.concurrency} maxRetries=${config.maxClaudeRetries} maxIter=${config.maxCoverageIterations}`,
    "init",
  );

  // Stage 1: fetch
  const { files, title } = await runFetch(wd, { force: isForced("fetch") });

  // Stage 2: enumerate
  const allUnits = await runEnumerate(wd, files, {
    force: isForced("enumerate"),
  });
  const unitsByFile = new Map<string, FileUnits>(allUnits.map((u) => [u.file, u]));

  // Stage 3: classify
  const routing = await runClassify(wd, files, { force: isForced("classify") });

  // Stage 4: review (parallel fan-out)
  // eslint-disable-next-line prefer-const
  let reviews = await runReviews(wd, routing, unitsByFile, {
    force: isForced("review"),
  });

  // Stage 5: coverage check + retry loop
  let coverage = await runCoverage(wd, reviews, unitsByFile);
  let iter = 0;
  while (iter < config.maxCoverageIterations && coverage.some((c) => !c.complete)) {
    const incomplete = coverage.filter((c) => !c.complete);
    log.step(`iteration ${iter + 1}: ${incomplete.length} incomplete`, "retry");
    reviews = await retryIncomplete(wd, reviews, incomplete, unitsByFile, iter + 1);
    coverage = await runCoverage(wd, reviews, unitsByFile);
    iter++;
  }

  // Stage 6: aggregate
  const report = await runAggregate(
    wd,
    reviews,
    coverage,
    { title },
    {
      force: isForced("aggregate"),
    },
  );

  // Stage 7: architecture diagram
  const meta = (await Bun.file(wd.metaFile()).json()) as PrMeta;
  await runArchitecture(wd, reviews, coverage, routing, meta, {
    force: isForced("architecture"),
  });

  // Stage 8: post to GitHub
  if (values.post || values.edit) {
    const fn = values.edit ? editPrComment : postPrComment;
    const verb = values.edit ? "editing" : "posting";
    log.step(`${verb} comment on PR #${pr}`, "post");
    await fn(pr, report);
    log.done(`comment ${values.edit ? "edited" : "posted"}`, "post");
  }

  // Final summary
  const totalUnits = coverage.reduce((n, c) => n + c.total, 0);
  const coveredUnits = coverage.reduce((n, c) => n + c.covered, 0);
  log.done(
    `coverage ${coveredUnits}/${totalUnits} units across ${reviews.length} reviews`,
    "summary",
  );
  log.done(wd.finalReport(), "report");
  log.done(wd.architectureReport(), "architecture");
}

main().catch((err: Error) => {
  log.error(err.message, "fatal");
  if (config.verbose && err.stack) console.error(err.stack);
  process.exit(1);
});

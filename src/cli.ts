import { parseArgs } from "node:util";
import { Workdir } from "./lib/workdir.ts";
import { log } from "./lib/log.ts";
import { config } from "./config.ts";
import { runFetch } from "./stages/fetch.ts";
import { postPrComment, editPrComment } from "./lib/gh.ts";
import { getMetricsSummary } from "./lib/claude.ts";
import { runEnumerate } from "./stages/enumerate.ts";
import { runClassify } from "./stages/classify.ts";
import { runReviews, retryIncomplete } from "./stages/review.ts";
import { runCoverage } from "./stages/coverage.ts";
import { runAggregate } from "./stages/aggregate.ts";
import { runArchitecture } from "./stages/architecture.ts";
import { loadAnalyzeConfig, resolveAnalyzeInput } from "./lib/analyze-config.ts";
import {
  resolveKnowledgeAnswerOptions,
  resolveKnowledgeBuildOptions,
} from "./lib/knowledge-options.ts";
import {
  DEFAULT_MAX_SCOPED_FILES,
  runAnalyzeEntry,
  runAnalyzeMulti,
} from "./stages/analyze/run.ts";
import { runKnowledgeBuild } from "./stages/knowledge/build.ts";
import { runKnowledgeAnswer } from "./stages/knowledge/answer.ts";
import type { FileUnits } from "./schemas/index.ts";
import type { PrMeta } from "./lib/gh.ts";

function usage(): never {
  console.log(`prism — deterministic LLM-orchestrated PR review harness

USAGE:
  prism review <pr-number> [options]
  prism analyze (--entry <path> | --config <path>) [options]
  prism knowledge build [options]
  prism knowledge answer --question <text> [options]
  prism knowledge answer --questions-file <path> [options]

OPTIONS:
  --force              Re-run all stages, ignoring cached output
  --force-stage <name> Force re-run of a single stage
  --post               Post the final report as a PR comment via gh
  --edit               Edit the last prism comment instead of posting a new one
  --resume             Default behavior: skip stages with existing output
  --entry <path>       Analyze command: entry TS/TSX file
  --config <path>      Analyze command: JSON config defaults for entry/entries/depth/maxFiles/filters
  --depth <n>          Analyze command: traversal depth (default: 2)
  --max-files <n>      Analyze command: max scoped files before failing (default: ${DEFAULT_MAX_SCOPED_FILES})
  --include <patterns> Analyze command: comma-separated include globs
  --exclude <patterns> Analyze command: comma-separated exclude globs
  --analyze-root <path> Knowledge command: analyze artifacts root (default: .tmp/analyze)
  --docs-root <path>    Knowledge command: docs root to scan for artifact links (default: docs/prism)
  --out <path>          Knowledge build command: output root (default: .prism/knowledge)
  --knowledge-root <path> Knowledge answer command: knowledge root (default: .prism/knowledge)
  --code-root <path>    Knowledge answer command: source code repo root for evidence paths
  --question <text>     Knowledge answer command: single question to answer
  --questions-file <path> Knowledge answer command: JSON file with questions array
  --answer-out <path>   Knowledge answer command: output file for single question
  --out-dir <path>      Knowledge answer command: output directory (default: .prism/knowledge/answers)
  --top <n>             Knowledge answer command: max evidence rows per section (default: 8)
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
      entry: { type: "string" },
      config: { type: "string" },
      depth: { type: "string" },
      "max-files": { type: "string" },
      include: { type: "string" },
      exclude: { type: "string" },
      "analyze-root": { type: "string" },
      "docs-root": { type: "string" },
      "knowledge-root": { type: "string" },
      "code-root": { type: "string" },
      question: { type: "string" },
      "questions-file": { type: "string" },
      "answer-out": { type: "string" },
      "out-dir": { type: "string" },
      top: { type: "string" },
      out: { type: "string" },
      help: { type: "boolean", default: false },
    },
    allowPositionals: true,
    strict: false,
  });

  if (values.help || positionals.length === 0) usage();

  const [cmd, subcmd] = positionals;
  const force = values.force === true;
  const forceStage = values["force-stage"] as string | undefined;
  const isForced = (s: string) => force || forceStage === s;

  if (cmd === "knowledge") {
    if (subcmd === "build") {
      const knowledge = resolveKnowledgeBuildOptions({
        "analyze-root": values["analyze-root"] as string | undefined,
        "docs-root": values["docs-root"] as string | undefined,
        out: values.out as string | undefined,
      });
      const result = await runKnowledgeBuild({
        analyzeRoot: knowledge.analyzeRoot,
        docsRoot: knowledge.docsRoot,
        outRoot: knowledge.outRoot,
        force,
      });
      log.done(result.knowledgePackPath, "knowledge-pack");
      log.done(result.artifactsIndexPath, "artifacts-index");
      log.done(result.validationReportPath, "validation");
      return;
    }

    if (subcmd === "answer") {
      let answerOptions: ReturnType<typeof resolveKnowledgeAnswerOptions>;
      try {
        answerOptions = resolveKnowledgeAnswerOptions({
          "knowledge-root": values["knowledge-root"] as string | undefined,
          "code-root": values["code-root"] as string | undefined,
          question: values.question as string | undefined,
          "questions-file": values["questions-file"] as string | undefined,
          "answer-out": values["answer-out"] as string | undefined,
          "out-dir": values["out-dir"] as string | undefined,
          top: values.top as string | undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message, "knowledge:answer");
        process.exit(1);
      }

      const result = await runKnowledgeAnswer({
        knowledgeRoot: answerOptions.knowledgeRoot,
        codeRoot: answerOptions.codeRoot,
        question: answerOptions.question,
        questionsFile: answerOptions.questionsFile,
        answerOut: answerOptions.answerOut,
        outDir: answerOptions.outDir,
        top: answerOptions.top,
        force,
      });
      for (const answer of result.answers) {
        log.done(`${answer.question} -> ${answer.outputPath}`, "answer");
      }
      if (result.indexPath) {
        log.done(result.indexPath, "answers-index");
      }
      return;
    }

    usage();
  }

  if (cmd === "analyze") {
    const configPath = values.config as string | undefined;
    let analyzeConfig = {};
    if (configPath) {
      try {
        analyzeConfig = await loadAnalyzeConfig(configPath);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message, "analyze");
        process.exit(1);
      }
    }

    const analyzeInput = resolveAnalyzeInput(
      {
        entry: values.entry as string | undefined,
        depth: values.depth as string | undefined,
        maxFiles: values["max-files"] as string | undefined,
        include: values.include as string | undefined,
        exclude: values.exclude as string | undefined,
      },
      analyzeConfig,
    );

    if (analyzeInput.entries.length === 0) {
      log.error("missing required --entry <path>", "analyze");
      process.exit(1);
    }

    const depthValue = analyzeInput.depth === undefined ? 2 : Number(analyzeInput.depth);
    if (!Number.isInteger(depthValue) || depthValue < 0) {
      log.error(`invalid analyze depth: ${analyzeInput.depth}`, "analyze");
      process.exit(1);
    }
    const maxFilesValue =
      analyzeInput.maxFiles === undefined
        ? DEFAULT_MAX_SCOPED_FILES
        : Number(analyzeInput.maxFiles);
    if (!Number.isInteger(maxFilesValue) || maxFilesValue < 1) {
      log.error(`invalid analyze maxFiles: ${analyzeInput.maxFiles}`, "analyze");
      process.exit(1);
    }

    if (analyzeInput.entries.length === 1) {
      const entry = analyzeInput.entries[0]!;
      log.step(`analyze ${entry.path} depth=${depthValue}`, "init");
      const result = await runAnalyzeEntry(entry, {
        depth: depthValue,
        include: analyzeInput.include,
        exclude: analyzeInput.exclude,
        maxFiles: maxFilesValue,
        force: {
          forceAll: force,
          forceStage,
        },
      });
      log.done(
        `${result.counts.files} files, ${result.counts.symbols} symbols, ${result.counts.repoIndexFiles} repo-index files, ${result.counts.edges} edges, ${result.counts.diagrams} diagrams, ${result.counts.insights} insights`,
        "summary",
      );
      log.done(result.workdir.repoIndexFile(), "repo-index");
      log.done(result.workdir.graphFile(), "graph");
      log.done(result.workdir.diagrams(), "diagrams");
      log.done(result.workdir.insightsFile(), "insights");
      log.done(result.workdir.finalIndexReport(), "start-here");
      log.done(result.workdir.finalReport(), "detail-report");
      return;
    }

    log.step(
      `analyze ${analyzeInput.entries.length} entries depth=${depthValue}`,
      "init",
    );
    const manifest = await runAnalyzeMulti(analyzeInput, {
      depth: depthValue,
      maxFiles: maxFilesValue,
      force: {
        forceAll: force,
        forceStage,
      },
    });
    const failed = manifest.entries.filter((entry) => entry.status === "failed");
    const succeeded = manifest.entries.length - failed.length;

    log.done(`${succeeded}/${manifest.entries.length} entries succeeded`, "summary");
    for (const entry of manifest.entries) {
      log.done(`${entry.name}: ${entry.status}`, "entry");
      if (entry.error) {
        log.error(entry.error, `entry:${entry.name}`);
      }
    }
    log.done(
      `${config.workdirRoot}/analyze/multi/${manifest.configDigest}/manifest.json`,
      "manifest",
    );
    log.done(
      `${config.workdirRoot}/analyze/multi/${manifest.configDigest}/index.md`,
      "start-here",
    );
    if (failed.length > 0) {
      process.exit(1);
    }
    return;
  }

  const prArg = subcmd;
  if (cmd !== "review" || !prArg) usage();

  const pr = Number(prArg);
  if (!Number.isInteger(pr) || pr <= 0) {
    log.error(`invalid PR number: ${prArg}`);
    process.exit(1);
  }

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

  // Detect systematically-broken reviewers (0% success rate)
  const reviewerStats = new Map<string, { success: number; total: number }>();
  for (const route of routing.routes) {
    for (const reviewer of route.reviewers) {
      const stats = reviewerStats.get(reviewer) ?? { success: 0, total: 0 };
      stats.total++;
      if (reviews.some((r) => r.file === route.file && r.reviewer === reviewer)) {
        stats.success++;
      }
      reviewerStats.set(reviewer, stats);
    }
  }
  const brokenReviewers = new Set<string>();
  for (const [reviewer, stats] of reviewerStats) {
    if (stats.success === 0 && stats.total >= 3) {
      log.warn(
        `reviewer "${reviewer}" 0/${stats.total} success — skipping retries`,
        "retry",
      );
      brokenReviewers.add(reviewer);
    }
  }

  let iter = 0;
  while (iter < config.maxCoverageIterations && coverage.some((c) => !c.complete)) {
    const incomplete = coverage
      .filter((c) => !c.complete)
      .filter((c) => !brokenReviewers.has(c.reviewer));
    if (incomplete.length === 0) break;
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

  // Metrics
  const metrics = getMetricsSummary();
  log.info(
    `API: ${metrics.totalCalls} calls (${metrics.totalAttempts} attempts), ` +
      `${metrics.successes} ok, ${metrics.failures} failed, ` +
      `${(metrics.totalDurationMs / 1000).toFixed(1)}s total`,
    "metrics",
  );
}

main().catch((err: Error) => {
  log.error(err.message, "fatal");
  if (config.verbose && err.stack) console.error(err.stack);
  process.exit(1);
});

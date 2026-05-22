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
  resolveKnowledgeAnswerReportOptions,
  resolveKnowledgeBuildOptions,
  resolveKnowledgeDiffOptions,
  resolveKnowledgeUpdateOptions,
} from "./lib/knowledge-options.ts";
import {
  DEFAULT_MAX_SCOPED_FILES,
  runAnalyzeEntry,
  runAnalyzeMulti,
} from "./stages/analyze/run.ts";
import { runKnowledgeBuild } from "./stages/knowledge/build.ts";
import { runKnowledgeAnswer } from "./stages/knowledge/answer.ts";
import { runKnowledgeAnswerReport } from "./stages/knowledge/report.ts";
import { runKnowledgeUpdate } from "./stages/knowledge/update.ts";
import { runKnowledgeDiff, formatDiffMarkdown } from "./stages/knowledge/diff.ts";
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
  prism knowledge answer-report [options]
  prism knowledge update --from <commit> --to <commit> [options]
  prism knowledge diff --base <path> --head <path> [options]

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
  --repo-root <path>     Knowledge update command: git repo root (default: .)
  --code-root <path>    Knowledge answer command: source code repo root for evidence paths
  --from <commit>       Knowledge update command: starting commit (exclusive)
  --to <commit>         Knowledge update command: ending commit (inclusive)
  --batch-size <n>      Knowledge update command: commit batch size for planning (default: 20)
  --dry-run             Knowledge update command: planning mode (default when --apply is not set)
  --apply               Knowledge update command: execute selective refresh + rebuild (disables dry-run)
  --question <text>     Knowledge answer command: single question to answer
  --questions-file <path> Knowledge answer command: JSON file with questions array
  --answer-out <path>   Knowledge answer command: output file for single question
  --out-dir <path>      Knowledge answer command: output directory (default: .prism/knowledge/answers)
  --top <n>             Knowledge answer command: max evidence rows per section (default: 8)
  --emit-json           Knowledge answer command: also emit machine-readable JSON sidecar(s)
  --strict              Knowledge answer command: fail with non-zero exit when confidence/artifact checks fail
  --min-confidence <low|medium|high> Knowledge answer strict mode: minimum required confidence
  --answers-dir <path>  Knowledge answer-report command: input answers directory (default: .prism/knowledge/answers)
  --report-out <path>   Knowledge answer-report command: output directory (default: <knowledge-root>/answer-reports/<digest>)
  --base <path>         Knowledge diff command: base report directory
  --head <path>         Knowledge diff command: head report directory
  --json                Knowledge diff command: emit machine-readable JSON
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
      "repo-root": { type: "string" },
      "code-root": { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      "batch-size": { type: "string" },
      "dry-run": { type: "boolean" },
      apply: { type: "boolean", default: false },
      question: { type: "string" },
      "questions-file": { type: "string" },
      "answer-out": { type: "string" },
      "out-dir": { type: "string" },
      top: { type: "string" },
      "emit-json": { type: "boolean", default: false },
      strict: { type: "boolean", default: false },
      "min-confidence": { type: "string" },
      "answers-dir": { type: "string" },
      "report-out": { type: "string" },
      base: { type: "string" },
      head: { type: "string" },
      json: { type: "boolean", default: false },
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
          "emit-json": values["emit-json"] === true,
          strict: values.strict === true,
          "min-confidence": values["min-confidence"] as string | undefined,
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
        emitJson: answerOptions.emitJson,
        strict: answerOptions.strict,
        minConfidence: answerOptions.minConfidence,
        force,
      });
      for (const answer of result.answers) {
        log.done(`${answer.question} -> ${answer.outputPath}`, "answer");
        if (answer.jsonOutputPath) {
          log.done(`${answer.question} -> ${answer.jsonOutputPath}`, "answer-json");
        }
      }
      if (result.indexPath) {
        log.done(result.indexPath, "answers-index");
      }
      if (result.strict.failed) {
        const summary = result.strict.summary;
        log.error(
          `strict mode failed with ${result.strict.failures.length} issue(s); minimum confidence: ${result.strict.minConfidence}`,
          "knowledge:strict",
        );
        log.error(
          `STRICT_SUMMARY question_count=${summary.questionCount} failed_question_count=${summary.failedQuestionCount} issue_count=${summary.issueCount} min_confidence=${result.strict.minConfidence}`,
          "knowledge:strict",
        );
        for (const category of summary.categories) {
          log.error(
            `STRICT_CATEGORY category=${category.category} count=${category.count}`,
            "knowledge:strict",
          );
        }
        for (const issue of result.strict.issues) {
          log.error(
            `STRICT_FAILURE question_digest=${issue.questionDigest} category=${issue.category} detail=${issue.detail.replace(/\s+/g, " ").trim()}`,
            "knowledge:strict",
          );
        }
        for (const failure of result.strict.failures) {
          log.error(failure, "knowledge:strict");
        }
        process.exit(1);
      }
      return;
    }

    if (subcmd === "answer-report") {
      let reportOptions: ReturnType<typeof resolveKnowledgeAnswerReportOptions>;
      try {
        reportOptions = resolveKnowledgeAnswerReportOptions({
          "knowledge-root": values["knowledge-root"] as string | undefined,
          "answers-dir": values["answers-dir"] as string | undefined,
          "report-out": values["report-out"] as string | undefined,
          strict: values.strict === true,
          "min-confidence": values["min-confidence"] as string | undefined,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message, "knowledge:answer-report");
        process.exit(1);
      }

      const result = await runKnowledgeAnswerReport({
        knowledgeRoot: reportOptions.knowledgeRoot,
        answersDir: reportOptions.answersDir,
        reportOut: reportOptions.reportOut,
        strict: reportOptions.strict,
        minConfidence: reportOptions.minConfidence,
        force,
      });
      log.done(result.reportRoot, "answer-report");
      if (result.strictFailed) {
        const summary = result.manifest.strictSummary;
        log.error(
          `strict mode failed with ${result.strictIssues.length} issue(s); minimum confidence: ${reportOptions.minConfidence ?? "medium"}`,
          "answer-report:strict",
        );
        if (summary) {
          log.error(
            `STRICT_SUMMARY question_count=${summary.questionCount} failed_question_count=${summary.failedQuestionCount} issue_count=${summary.issueCount} min_confidence=${reportOptions.minConfidence ?? "medium"}`,
            "answer-report:strict",
          );
          for (const category of summary.categories) {
            log.error(
              `STRICT_CATEGORY category=${category.category} count=${category.count}`,
              "answer-report:strict",
            );
          }
        }
        for (const issue of result.strictIssues) {
          log.error(
            `STRICT_FAILURE question_digest=${issue.questionDigest} category=${issue.category} detail=${issue.detail.replace(/\s+/g, " ").trim()}`,
            "answer-report:strict",
          );
        }
        process.exit(1);
      }
      return;
    }

    if (subcmd === "update") {
      let updateOptions: ReturnType<typeof resolveKnowledgeUpdateOptions>;
      try {
        updateOptions = resolveKnowledgeUpdateOptions({
          "repo-root": values["repo-root"] as string | undefined,
          "knowledge-root": values["knowledge-root"] as string | undefined,
          from: values.from as string | undefined,
          to: values.to as string | undefined,
          "batch-size": values["batch-size"] as string | undefined,
          "dry-run": values["dry-run"] === true,
          apply: values.apply === true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message, "knowledge:update");
        process.exit(1);
      }

      const result = await runKnowledgeUpdate({
        repoRoot: updateOptions.repoRoot,
        knowledgeRoot: updateOptions.knowledgeRoot,
        from: updateOptions.from,
        to: updateOptions.to,
        batchSize: updateOptions.batchSize,
        dryRun: updateOptions.dryRun,
        force,
      });
      log.done(result.reportPath, "update-report");
      log.done(result.reportMarkdownPath, "update-report-md");
      return;
    }

    if (subcmd === "diff") {
      let diffOptions: ReturnType<typeof resolveKnowledgeDiffOptions>;
      try {
        diffOptions = resolveKnowledgeDiffOptions({
          base: values.base as string | undefined,
          head: values.head as string | undefined,
          strict: values.strict === true,
          json: values.json === true,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        log.error(message, "knowledge:diff");
        process.exit(1);
      }

      const result = await runKnowledgeDiff(diffOptions);
      if (diffOptions.json) {
        console.log(JSON.stringify(result, null, 2));
      } else {
        console.log(formatDiffMarkdown(result));
      }
      log.done(`verdict: ${result.verdict} (score: ${result.score})`, "knowledge:diff");
      if (diffOptions.strict && result.verdict === "regressed") {
        log.error("regression detected in strict diff mode", "knowledge:diff");
        process.exit(1);
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

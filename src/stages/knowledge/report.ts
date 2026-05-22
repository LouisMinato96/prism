import { existsSync } from "node:fs";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { log } from "../../lib/log.ts";
import {
  contentDigest,
  maxMtimeIso,
  resolvePath,
  toDisplayPath,
  writeJsonIfChanged,
  writeTextIfChanged,
} from "../../lib/knowledge-render.ts";
import { loadAnswerSidecars } from "./report/sidecar-loader.ts";
import {
  buildStrictSummary,
  evaluateQuestionStrict,
  type StrictIssue,
  type StrictSummary,
} from "./report/strict.ts";
import { buildEntriesRollup, writeDataFiles } from "./report/data.ts";
import {
  loadTeachingInput,
  renderGlossaryPage,
  renderTeachingPages,
} from "./report/teaching.ts";
import {
  renderClassBreakdown,
  renderCoverageGaps,
  renderDiagramIndex,
  renderEvidenceMap,
  renderFollowUp,
  renderIndex,
  renderInsightCorrelation,
  renderIntegritySignals,
  renderOverview,
  renderQuestionOverlap,
  renderQuestionPage,
  renderStrictIssues,
  renderValidationReport,
  type DiagramRef,
  type PageRef,
} from "./report/pages.ts";

const KNOWLEDGE_PACK_FILE = "knowledge-pack.json";
const ARTIFACTS_INDEX_FILE = "artifacts-index.json";
const MANIFEST_FILE = "manifest.json";
const INDEX_FILE = "index.md";
const VALIDATION_FILE = "validation-report.md";
const ANSWER_REPORT_SCHEMA_VERSION = 1 as const;

export interface KnowledgeAnswerReportOptions {
  baseDir?: string;
  knowledgeRoot: string;
  answersDir: string;
  reportOut?: string;
  strict: boolean;
  minConfidence?: "low" | "medium" | "high";
  force?: boolean;
}

export interface KnowledgeAnswerReportManifest {
  schemaVersion: typeof ANSWER_REPORT_SCHEMA_VERSION;
  generatedAt: string;
  digest: string;
  knowledgeRoot: string;
  answersDir: string;
  reportRoot: string;
  strict: boolean;
  minConfidence: "low" | "medium" | "high" | null;
  counts: {
    inputs: number;
    questions: number;
    answerSidecars: number;
    classificationSidecars: number;
    evidencePackSidecars: number;
    answerJsonSidecars: number;
    markdownSidecars: number;
    warnings: number;
    malformedSidecars: number;
    questionsWithoutJson: number;
    integritySignalsStale: number;
    integritySignalsContradiction: number;
  };
  strictSummary: StrictSummary | null;
  sources: string[];
  pages: Array<{ name: string; relPath: string }>;
}

export interface KnowledgeAnswerReportResult {
  reportRoot: string;
  manifestPath: string;
  indexPath: string;
  validationReportPath: string;
  manifest: KnowledgeAnswerReportManifest;
  strictIssues: StrictIssue[];
  strictFailed: boolean;
}

export async function runKnowledgeAnswerReport(
  options: KnowledgeAnswerReportOptions,
): Promise<KnowledgeAnswerReportResult> {
  const baseDir = options.baseDir ?? process.cwd();
  const knowledgeRootAbs = resolvePath(baseDir, options.knowledgeRoot);
  const answersDirAbs = resolvePath(baseDir, options.answersDir);
  const force = options.force === true;
  const stage = "knowledge:answer-report";
  const minConfidence = options.minConfidence ?? "medium";

  log.step(`aggregating answers from ${toDisplayPath(baseDir, answersDirAbs)}`, stage);

  const knowledgePackPath = join(knowledgeRootAbs, KNOWLEDGE_PACK_FILE);
  const artifactsIndexPath = join(knowledgeRootAbs, ARTIFACTS_INDEX_FILE);

  if (!existsSync(knowledgePackPath)) {
    throw new Error(`knowledge-pack.json missing at ${knowledgePackPath}`);
  }
  if (!existsSync(artifactsIndexPath)) {
    throw new Error(`artifacts-index.json missing at ${artifactsIndexPath}`);
  }
  if (!existsSync(answersDirAbs)) {
    throw new Error(`answers directory missing at ${answersDirAbs}`);
  }

  const sidecars = await loadAnswerSidecars(answersDirAbs);
  const integritySignals = await loadIntegritySignals(artifactsIndexPath);

  const inputPaths = [
    knowledgePackPath,
    artifactsIndexPath,
    ...sidecars.inputPaths,
  ].sort();
  const digest = await contentDigest(inputPaths);
  const generatedAt = await maxMtimeIso(inputPaths);

  const reportOutAbs = options.reportOut
    ? resolvePath(baseDir, options.reportOut)
    : join(knowledgeRootAbs, "answer-reports", digest);

  await mkdir(reportOutAbs, { recursive: true });
  const pagesDirAbs = join(reportOutAbs, "pages");
  const questionsDirAbs = join(reportOutAbs, "questions");
  const dataDirAbs = join(reportOutAbs, "data");
  await mkdir(pagesDirAbs, { recursive: true });
  await mkdir(questionsDirAbs, { recursive: true });
  await mkdir(dataDirAbs, { recursive: true });

  const issuesByDigest = new Map<string, StrictIssue[]>();
  const allStrictIssues: StrictIssue[] = [];
  if (options.strict) {
    for (const question of sidecars.questions) {
      const issues = evaluateQuestionStrict(question, minConfidence);
      if (issues.length > 0) {
        issuesByDigest.set(question.digest, issues);
        allStrictIssues.push(...issues);
      }
    }
  }
  const strictSummary = options.strict
    ? buildStrictSummary(sidecars.questions, issuesByDigest)
    : null;

  const rollup = buildEntriesRollup(sidecars.questions);
  const diagrams = await loadDiagramsFromArtifactsIndex(artifactsIndexPath, baseDir);

  const pageDescriptors: Array<{
    name: string;
    file: string;
    title: string;
    summary: string;
    content: string;
  }> = [
    {
      name: "overview",
      file: "00-overview.md",
      title: "00 Overview",
      summary: "question table with class/confidence/evidence/fail-open badges",
      content: renderOverview(sidecars.questions),
    },
    {
      name: "evidence-map",
      file: "01-evidence-map.md",
      title: "01 Evidence Map",
      summary: "entries referenced across questions with score totals",
      content: renderEvidenceMap(rollup),
    },
    {
      name: "class-breakdown",
      file: "02-class-breakdown.md",
      title: "02 Class Breakdown",
      summary: "class histogram + per-class question lists",
      content: renderClassBreakdown(sidecars.questions),
    },
    {
      name: "follow-up",
      file: "03-follow-up.md",
      title: "03 Follow-Up",
      summary: "ambiguous, fail-open, partial-evidence, low-confidence questions",
      content: renderFollowUp(sidecars.questions),
    },
    {
      name: "strict-issues",
      file: "04-strict-issues.md",
      title: "04 Strict Issues",
      summary: "strict category table + per-issue rows",
      content: renderStrictIssues({
        strict: options.strict,
        minConfidence: options.strict ? minConfidence : null,
        summary: strictSummary,
        issuesByDigest,
        questions: sidecars.questions,
      }),
    },
    {
      name: "integrity-signals",
      file: "05-integrity-signals.md",
      title: "05 Integrity Signals",
      summary: "stale-run and contradiction signals from artifacts-index",
      content: renderIntegritySignals(integritySignals),
    },
    {
      name: "diagram-index",
      file: "06-diagram-index.md",
      title: "06 Diagram Index",
      summary: "diagrams referenced across questions (full discovery v2.12)",
      content: renderDiagramIndex(diagrams),
    },
    {
      name: "question-overlap",
      file: "07-question-overlap.md",
      title: "07 Question Overlap",
      summary: "entries appearing in multiple questions with shared classes",
      content: renderQuestionOverlap(sidecars.questions),
    },
    {
      name: "coverage-gaps",
      file: "08-coverage-gaps.md",
      title: "08 Coverage Gaps",
      summary: "aggregate unmet evidence requirements and class coverage",
      content: renderCoverageGaps(sidecars.questions),
    },
    {
      name: "insight-correlation",
      file: "09-insight-correlation.md",
      title: "09 Insight Correlation",
      summary: "lens findings aggregated across questions — systemic issues",
      content: renderInsightCorrelation(sidecars.questions),
    },
  ];

  const teachingInput = await loadTeachingInput({
    knowledgePackPath,
    questions: sidecars.questions,
  });
  const teachingPages = renderTeachingPages(teachingInput);
  for (const page of teachingPages) {
    pageDescriptors.push({
      name: page.title,
      file: page.file,
      title: page.title,
      summary: page.summary,
      content: page.content,
    });
  }
  pageDescriptors.push({
    name: "glossary",
    file: "99-glossary.md",
    title: "99 Glossary",
    summary: "lens reference: detection, severity, canonical docs",
    content: renderGlossaryPage(),
  });

  for (const page of pageDescriptors) {
    await writeTextIfChanged(join(pagesDirAbs, page.file), page.content, force);
  }

  for (const question of sidecars.questions) {
    const content = renderQuestionPage({
      question,
      reportRootAbs: reportOutAbs,
      baseDir,
    });
    await writeTextIfChanged(
      join(questionsDirAbs, `${question.digest}.md`),
      content,
      force,
    );
  }

  await writeDataFiles({
    dataDirAbs,
    questions: sidecars.questions,
    issuesByDigest,
    strictSummary,
    insights: teachingInput.insights,
    force,
  });

  const validationReportPath = join(reportOutAbs, VALIDATION_FILE);
  await writeTextIfChanged(
    validationReportPath,
    renderValidationReport({
      warnings: sidecars.warnings,
      malformed: sidecars.malformed,
      integritySignals: {
        stale: integritySignals.stale,
        contradiction: integritySignals.contradiction,
      },
      questions: sidecars.questions,
    }),
    force,
  );

  const pageRefs: PageRef[] = pageDescriptors.map((page) => ({
    title: page.title,
    relPath: `pages/${page.file}`,
    summary: page.summary,
  }));

  const indexContent = renderIndex({
    manifestDigest: digest,
    generatedAt,
    knowledgeRootDisplay: toDisplayPath(baseDir, knowledgeRootAbs),
    answersDirDisplay: toDisplayPath(baseDir, answersDirAbs),
    reportRootDisplay: toDisplayPath(baseDir, reportOutAbs),
    questions: sidecars.questions,
    strict: options.strict,
    minConfidence: options.strict ? minConfidence : null,
    strictSummary,
    pageFiles: pageRefs,
    warnings: sidecars.warnings,
    malformed: sidecars.malformed,
    integritySignals: {
      stale: integritySignals.stale.length,
      contradiction: integritySignals.contradiction.length,
    },
  });
  const indexPath = join(reportOutAbs, INDEX_FILE);
  await writeTextIfChanged(indexPath, indexContent, force);

  const questionsWithoutJson = sidecars.questions.filter(
    (q) => !q.answerJsonPresent,
  ).length;

  const manifest: KnowledgeAnswerReportManifest = {
    schemaVersion: ANSWER_REPORT_SCHEMA_VERSION,
    generatedAt,
    digest,
    knowledgeRoot: toDisplayPath(baseDir, knowledgeRootAbs),
    answersDir: toDisplayPath(baseDir, answersDirAbs),
    reportRoot: toDisplayPath(baseDir, reportOutAbs),
    strict: options.strict,
    minConfidence: options.strict ? minConfidence : null,
    counts: {
      inputs: inputPaths.length,
      questions: sidecars.questions.length,
      answerSidecars:
        sidecars.classificationCount +
        sidecars.evidencePackCount +
        sidecars.answerJsonCount,
      classificationSidecars: sidecars.classificationCount,
      evidencePackSidecars: sidecars.evidencePackCount,
      answerJsonSidecars: sidecars.answerJsonCount,
      markdownSidecars: sidecars.markdownCount,
      warnings: sidecars.warnings.length,
      malformedSidecars: sidecars.malformed.length,
      questionsWithoutJson,
      integritySignalsStale: integritySignals.stale.length,
      integritySignalsContradiction: integritySignals.contradiction.length,
    },
    strictSummary,
    sources: inputPaths.map((p) => toDisplayPath(baseDir, p)),
    pages: pageRefs.map((page) => ({ name: page.title, relPath: page.relPath })),
  };

  const manifestPath = join(reportOutAbs, MANIFEST_FILE);
  await writeJsonIfChanged(manifestPath, manifest, force);

  log.done(manifestPath, "answer-report-manifest");
  log.done(indexPath, "answer-report-index");
  log.done(validationReportPath, "answer-report-validation");

  return {
    reportRoot: reportOutAbs,
    manifestPath,
    indexPath,
    validationReportPath,
    manifest,
    strictIssues: allStrictIssues,
    strictFailed: options.strict && allStrictIssues.length > 0,
  };
}

async function loadIntegritySignals(
  artifactsIndexPath: string,
): Promise<{ stale: string[]; contradiction: string[] }> {
  try {
    const raw = JSON.parse(await readFile(artifactsIndexPath, "utf8")) as {
      integritySignals?: {
        staleRunSignals?: string[];
        contradictionSignals?: string[];
      };
    };
    return {
      stale: (raw.integritySignals?.staleRunSignals ?? []).slice().sort(),
      contradiction: (raw.integritySignals?.contradictionSignals ?? []).slice().sort(),
    };
  } catch {
    return { stale: [], contradiction: [] };
  }
}

async function loadDiagramsFromArtifactsIndex(
  artifactsIndexPath: string,
  baseDir: string,
): Promise<DiagramRef[]> {
  try {
    const raw = JSON.parse(await readFile(artifactsIndexPath, "utf8")) as {
      runs?: Array<{
        configDigest?: string;
        entries?: Array<{
          name?: string;
          status?: string;
          workdir?: string;
        }>;
      }>;
    };
    const diagrams: DiagramRef[] = [];
    for (const run of raw.runs ?? []) {
      const runDigest = run.configDigest ?? "";
      for (const entry of run.entries ?? []) {
        if (entry.status !== "success" || !entry.workdir) continue;
        const manifestPath = join(
          resolvePath(baseDir, entry.workdir),
          "diagrams",
          "manifest.json",
        );
        if (!existsSync(manifestPath)) continue;
        try {
          const items = JSON.parse(await readFile(manifestPath, "utf8")) as Array<{
            name?: string;
            title?: string;
            path?: string;
            edgeCount?: number;
          }>;
          for (const item of items) {
            diagrams.push({
              name: item.name ?? "",
              title: item.title ?? "",
              path: item.path ?? "",
              edgeCount: item.edgeCount ?? 0,
              entry: entry.name ?? "",
              runDigest,
            });
          }
        } catch {
          // skip unreadable diagram manifests
        }
      }
    }
    return diagrams.sort(
      (a, b) =>
        a.runDigest.localeCompare(b.runDigest) ||
        a.entry.localeCompare(b.entry) ||
        a.name.localeCompare(b.name),
    );
  } catch {
    return [];
  }
}

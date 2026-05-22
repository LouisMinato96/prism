import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveKnowledgeAnswerOptions,
  resolveKnowledgeBuildOptions,
  resolveKnowledgeUpdateOptions,
} from "../src/lib/knowledge-options.ts";
import {
  discoverAnalyzeEntryWorkdirs,
  discoverAnalyzeMultiRunRoots,
  runKnowledgeBuild,
} from "../src/stages/knowledge/build.ts";
import {
  classifyQuestionClass,
  classifyIntent,
  runKnowledgeAnswer,
} from "../src/stages/knowledge/answer.ts";
import { runKnowledgeUpdate } from "../src/stages/knowledge/update.ts";

test("knowledge build discovers multi-run and single-entry analyze artifacts", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const multiRuns = await discoverAnalyzeMultiRunRoots(join(baseDir, ".tmp/analyze"));
    const workdirs = await discoverAnalyzeEntryWorkdirs(join(baseDir, ".tmp/analyze"));

    expect(multiRuns).toHaveLength(1);
    expect(multiRuns[0]).toContain("/.tmp/analyze/multi/abc123def456");
    expect(workdirs).toHaveLength(2);
    expect(workdirs.some((dir) => dir.includes("src__app__page.tsx-d2-aaaaaaaa"))).toBe(
      true,
    );
    expect(workdirs.some((dir) => dir.includes("src__missing__Nope.tsx-d2-bbbbbbbb"))).toBe(
      true,
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge build emits pack, index, and validation report with success and failure entries", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const result = await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    expect(existsSync(result.knowledgePackPath)).toBe(true);
    expect(existsSync(result.artifactsIndexPath)).toBe(true);
    expect(existsSync(result.validationReportPath)).toBe(true);

    expect(result.knowledgePack.schemaVersion).toBe(1);
    expect(result.knowledgePack.runs).toHaveLength(1);
    expect(result.knowledgePack.entries.map((entry) => entry.status)).toEqual([
      "success",
      "failed",
    ]);
    expect(result.knowledgePack.entries[0]?.name).toBe("app-page");
    expect(result.knowledgePack.entries[1]?.name).toBe("missing-entry");
    expect(result.knowledgePack.insights).toContainEqual(
      expect.objectContaining({
        runDigest: "abc123def456",
        entry: "app-page",
        title: "Component calls service directly",
      }),
    );
    expect(result.validation.failedEntries).toContainEqual(
      expect.stringContaining("abc123def456/missing-entry"),
    );
    expect(result.validation.partialEntryWorkdirs).toContainEqual(
      expect.stringContaining("abc123def456/missing-entry"),
    );
    expect(result.validation.docsMissingArtifactLinks).toContainEqual(
      expect.stringContaining("docs/prism/index.md"),
    );

    const validationReport = await readFile(result.validationReportPath, "utf8");
    expect(validationReport).toContain("## Failed Entries");
    expect(validationReport).toContain("missing-entry");
    expect(validationReport).toContain("## Missing Expected Files");
    expect(validationReport).toContain("## Docs Missing Artifact Links");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge build records deterministic contradiction signals across runs", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await appendConflictingMultiRunForAppPage(baseDir);
    const result = await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    expect(result.validation.contradictionSignals.length).toBeGreaterThan(0);
    expect(result.validation.contradictionSignals).toContainEqual(
      expect.stringContaining("entry status conflict for src/app/page.tsx"),
    );
    expect(result.validation.contradictionSignals).toContainEqual(
      expect.stringContaining("insight severity conflict for app-page"),
    );
    expect(result.artifactsIndex.integritySignals?.contradictionSignals.length).toBeGreaterThan(
      0,
    );
    const validationReport = await readFile(result.validationReportPath, "utf8");
    expect(validationReport).toContain("## Contradiction Signals");
    expect(validationReport).toContain("entry status conflict for src/app/page.tsx");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge build skips unchanged outputs unless forced", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const first = await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });
    const firstPackStat = await stat(first.knowledgePackPath);
    const firstIndexStat = await stat(first.artifactsIndexPath);
    const firstReportStat = await stat(first.validationReportPath);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: false,
    });
    const secondPackStat = await stat(second.knowledgePackPath);
    const secondIndexStat = await stat(second.artifactsIndexPath);
    const secondReportStat = await stat(second.validationReportPath);
    expect(secondPackStat.mtimeMs).toBe(firstPackStat.mtimeMs);
    expect(secondIndexStat.mtimeMs).toBe(firstIndexStat.mtimeMs);
    expect(secondReportStat.mtimeMs).toBe(firstReportStat.mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 20));
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });
    const forcedPackStat = await stat(first.knowledgePackPath);
    const forcedIndexStat = await stat(first.artifactsIndexPath);
    const forcedReportStat = await stat(first.validationReportPath);
    expect(forcedPackStat.mtimeMs).toBeGreaterThan(secondPackStat.mtimeMs);
    expect(forcedIndexStat.mtimeMs).toBeGreaterThan(secondIndexStat.mtimeMs);
    expect(forcedReportStat.mtimeMs).toBeGreaterThan(secondReportStat.mtimeMs);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge build resolves manifest artifact paths against external analyze repo root", async () => {
  const prismBaseDir = await mkdtemp(join(tmpdir(), "prism-knowledge-runner-"));
  const analyzeRepoDir = await createKnowledgeFixtureProject();
  try {
    const result = await runKnowledgeBuild({
      baseDir: prismBaseDir,
      analyzeRoot: join(analyzeRepoDir, ".tmp/analyze"),
      docsRoot: join(analyzeRepoDir, "docs/prism"),
      outRoot: ".prism/knowledge",
      force: true,
    });

    expect(result.knowledgePack.runs).toHaveLength(1);
    expect(result.knowledgePack.domains.length).toBeGreaterThan(0);
    expect(result.knowledgePack.symbols.length).toBeGreaterThan(0);
    expect(result.knowledgePack.modules.length).toBeGreaterThan(0);
    expect(result.knowledgePack.insights.length).toBeGreaterThan(0);
    expect(result.artifactsIndex.orphanEntryWorkdirs).toHaveLength(0);
  } finally {
    await rm(prismBaseDir, { recursive: true, force: true });
    await rm(analyzeRepoDir, { recursive: true, force: true });
  }
});

test("knowledge options resolver applies defaults and trims custom roots", () => {
  expect(resolveKnowledgeBuildOptions({})).toEqual({
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    outRoot: ".prism/knowledge",
  });

  expect(
    resolveKnowledgeBuildOptions({
      "analyze-root": "  custom/analyze  ",
      "docs-root": " docs/custom ",
      out: " .prism/custom-knowledge ",
    }),
  ).toEqual({
    analyzeRoot: "custom/analyze",
    docsRoot: "docs/custom",
    outRoot: ".prism/custom-knowledge",
  });
});

test("knowledge answer options resolver validates mode and defaults", () => {
  expect(
    resolveKnowledgeAnswerOptions({
      question: "How auth works",
    }),
  ).toEqual({
    knowledgeRoot: ".prism/knowledge",
    codeRoot: undefined,
    question: "How auth works",
    questionsFile: undefined,
    answerOut: undefined,
    outDir: ".prism/knowledge/answers",
    top: 8,
    emitJson: false,
    strict: false,
    minConfidence: undefined,
  });

  expect(() =>
    resolveKnowledgeAnswerOptions({
      question: "x",
      "questions-file": ".tmp/questions.json",
    }),
  ).toThrow("either --question or --questions-file");

  expect(() =>
    resolveKnowledgeAnswerOptions({
      question: "x",
      "min-confidence": "medium",
    }),
  ).toThrow("--min-confidence requires --strict");

  expect(() =>
    resolveKnowledgeAnswerOptions({
      question: "x",
      strict: true,
      "min-confidence": "bad",
    }),
  ).toThrow("invalid --min-confidence value");
});

test("knowledge update options resolver validates defaults and required fields", () => {
  expect(
    resolveKnowledgeUpdateOptions({
      from: "abc1234",
      to: "def5678",
    }),
  ).toEqual({
    repoRoot: ".",
    knowledgeRoot: ".prism/knowledge",
    from: "abc1234",
    to: "def5678",
    batchSize: 20,
    dryRun: true,
  });

  expect(
    resolveKnowledgeUpdateOptions({
      "repo-root": " repo ",
      "knowledge-root": " .prism/custom ",
      from: "abc",
      to: "def",
      "batch-size": "5",
      "dry-run": true,
    }),
  ).toEqual({
    repoRoot: "repo",
    knowledgeRoot: ".prism/custom",
    from: "abc",
    to: "def",
    batchSize: 5,
    dryRun: true,
  });

  expect(
    resolveKnowledgeUpdateOptions({
      from: "abc",
      to: "def",
      apply: true,
    }),
  ).toEqual({
    repoRoot: ".",
    knowledgeRoot: ".prism/knowledge",
    from: "abc",
    to: "def",
    batchSize: 20,
    dryRun: false,
  });

  expect(() =>
    resolveKnowledgeUpdateOptions({
      to: "def",
    }),
  ).toThrow("requires --from");
  expect(() =>
    resolveKnowledgeUpdateOptions({
      from: "abc",
    }),
  ).toThrow("requires --to");
  expect(() =>
    resolveKnowledgeUpdateOptions({
      from: "abc",
      to: "def",
      "batch-size": "0",
    }),
  ).toThrow("invalid --batch-size");
});

test("knowledge update dry-run writes deterministic report artifacts", async () => {
  const baseDir = await createKnowledgeUpdateFixtureProject();
  try {
    const { repoRoot, fromCommit, toCommit } = await resolveFixtureRepoCommits(baseDir);

    const first = await runKnowledgeUpdate({
      baseDir,
      repoRoot,
      knowledgeRoot: ".prism/knowledge",
      from: fromCommit,
      to: toCommit,
      batchSize: 1,
      dryRun: true,
      force: true,
    });

    expect(existsSync(first.reportPath)).toBe(true);
    expect(existsSync(first.reportMarkdownPath)).toBe(true);
    expect(first.report.mode).toBe("dry-run");
    expect(first.report.commitCount).toBe(4);
    expect(first.report.slices).toHaveLength(4);
    expect(first.report.changeCount).toBe(4);
    expect(first.report.changeSummary).toEqual({
      total: 4,
      added: 1,
      modified: 1,
      deleted: 1,
      renamed: 1,
    });
    expect(first.report.impactSummary).toEqual({
      impactedEntries: 2,
      staleEntries: 1,
      unmappedChanges: 1,
    });
    expect(first.report.impacts.map((impact) => impact.entryName)).toEqual([
      "entry-alpha",
      "entry-beta",
    ]);
    expect(first.report.impacts[1]).toEqual(
      expect.objectContaining({
        entryName: "entry-beta",
        stale: true,
      }),
    );
    expect(first.report.unmappedChanges).toEqual([
      expect.objectContaining({
        status: "deleted",
        path: "gamma.ts",
      }),
    ]);
    expect(first.report.changes.map((change) => change.status)).toEqual([
      "modified",
      "added",
      "renamed",
      "deleted",
    ]);
    expect(first.report.changes[2]).toEqual(
      expect.objectContaining({
        status: "renamed",
        previousPath: "beta.ts",
        path: "gamma.ts",
      }),
    );
    expect(first.report.notes.length).toBeGreaterThan(0);

    const firstStat = await stat(first.reportPath);
    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await runKnowledgeUpdate({
      baseDir,
      repoRoot,
      knowledgeRoot: ".prism/knowledge",
      from: fromCommit,
      to: toCommit,
      batchSize: 1,
      dryRun: true,
      force: false,
    });
    const secondStat = await stat(second.reportPath);

    expect(second.reportPath).toBe(first.reportPath);
    expect(second.reportMarkdownPath).toBe(first.reportMarkdownPath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);

    const markdown = await readFile(first.reportMarkdownPath, "utf8");
    expect(markdown).toContain("# Prism Knowledge Update Report");
    expect(markdown).toContain("## Commits");
    expect(markdown).toContain("## Changed Files");
    expect(markdown).toContain("## Impacted Entries");
    expect(markdown).toContain("## Unmapped Changes");
    expect(markdown).toContain("## Planned Batches");
    const state = JSON.parse(
      await readFile(join(baseDir, ".prism/knowledge/state.json"), "utf8"),
    ) as {
      latestMode: string;
      latestReportPath: string;
      appliedUpdates: unknown[];
    };
    expect(state.latestMode).toBe("dry-run");
    expect(state.latestReportPath.endsWith(".json")).toBe(true);
    expect(state.appliedUpdates).toHaveLength(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge update reports missing mapping context when artifacts index is absent", async () => {
  const baseDir = await createKnowledgeUpdateFixtureProject();
  try {
    await rm(join(baseDir, ".prism/knowledge/artifacts-index.json"), { force: true });
    const { repoRoot, fromCommit, toCommit } = await resolveFixtureRepoCommits(baseDir);

    const result = await runKnowledgeUpdate({
      baseDir,
      repoRoot,
      knowledgeRoot: ".prism/knowledge",
      from: fromCommit,
      to: toCommit,
      batchSize: 20,
      dryRun: true,
      force: true,
    });

    expect(result.report.impactSummary).toEqual({
      impactedEntries: 0,
      staleEntries: 0,
      unmappedChanges: result.report.changeCount,
    });
    expect(result.report.notes).toContainEqual(
      expect.stringContaining("Mapping context missing"),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge update apply mode refreshes impacted entries and rebuilds knowledge", async () => {
  const baseDir = await createKnowledgeUpdateFixtureProject();
  try {
    const { repoRoot, fromCommit, toCommit } = await resolveFixtureRepoCommits(baseDir);
    const result = await runKnowledgeUpdate({
      baseDir,
      repoRoot,
      knowledgeRoot: ".prism/knowledge",
      from: fromCommit,
      to: toCommit,
      batchSize: 20,
      dryRun: false,
      force: true,
    });

    expect(result.report.mode).toBe("apply");
    expect(result.report.execution).toEqual(
      expect.objectContaining({
        targetEntries: 1,
        skippedStaleEntries: 1,
        attemptedEntries: 1,
        succeededEntries: 1,
        failedEntries: 0,
        rebuiltKnowledge: true,
      }),
    );
    expect(existsSync(join(baseDir, ".prism/knowledge/knowledge-pack.json"))).toBe(true);
    expect(existsSync(join(baseDir, ".prism/knowledge/artifacts-index.json"))).toBe(true);
    const state = JSON.parse(
      await readFile(join(baseDir, ".prism/knowledge/state.json"), "utf8"),
    ) as {
      latestMode: string;
      lastAppliedReportPath?: string;
      appliedUpdates: Array<{ resolvedFrom: string; resolvedTo: string }>;
    };
    expect(state.latestMode).toBe("apply");
    expect(state.lastAppliedReportPath?.endsWith(".json")).toBe(true);
    expect(state.appliedUpdates).toHaveLength(1);
    expect(state.appliedUpdates[0]).toEqual(
      expect.objectContaining({
        resolvedFrom: result.report.resolvedFrom,
        resolvedTo: result.report.resolvedTo,
      }),
    );
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer classifies deterministic intents and precedence", () => {
  expect(classifyIntent("How does login auth flow work?")).toBe("auth-flow");
  expect(classifyIntent("Which permission guard blocks this route?")).toBe(
    "permissions",
  );
  expect(classifyIntent("Why does this request fail with timeout error?")).toBe(
    "failure-debug",
  );
  expect(classifyIntent("Show data flow for grpc service fetch")).toBe("data-flow");
  expect(classifyIntent("summarize project architecture")).toBe("general");

  // Precedence: auth-flow > permissions > failure-debug > data-flow
  expect(classifyIntent("auth permission failed data flow")).toBe("auth-flow");
  expect(classifyIntent("permission failed data flow")).toBe("permissions");
  expect(classifyIntent("failed data flow")).toBe("failure-debug");
});

test("knowledge answer classifies deterministic question classes for v2.1", () => {
  expect(classifyQuestionClass("How does the auth system work?")).toBe(
    "architecture_storyline",
  );
  expect(classifyQuestionClass("Where is useAuth defined?")).toBe(
    "reference_lookup",
  );
  expect(classifyQuestionClass("What calls deleteOldToken?")).toBe("dependency_flow");
  expect(classifyQuestionClass("Where does login flow start?")).toBe(
    "entrypoint_trace",
  );
  expect(classifyQuestionClass("What files make up auth?")).toBe("building_blocks");
  expect(classifyQuestionClass("How should I add MFA?")).toBe("change_guidance");
  expect(classifyQuestionClass("auth?")).toBe("unknown_or_ambiguous");
});

test("knowledge answer auth-flow intent ranking prefers auth services over workers", async () => {
  const baseDir = await createKnowledgeAnswerRankingFixtureProject();
  try {
    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      codeRoot: "repo",
      question: "How does auth service work?",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });
    const answerPath = result.answers[0]!.outputPath;
    const content = await readFile(answerPath, "utf8");

    const serviceIndex = content.indexOf("| svc-auth |");
    const workerIndex = content.indexOf("| auth-worker |");
    expect(serviceIndex).toBeGreaterThan(-1);
    expect(workerIndex).toBeGreaterThan(-1);
    expect(serviceIndex).toBeLessThan(workerIndex);
    expect(content).toContain("## Executive Answer");
    expect(content).toContain("## How To Read This Answer");
    expect(content).toContain("## Proof References");
    expect(content).toContain("## Raw Evidence Appendix");
    expect(content).toContain("## Auth Flow");
    expect(content).toContain("## Guards & Permissions");
    expect(content).toContain("## Failure Paths");
    expect(content).toContain("## Evidence Map");
    expect(content).toContain("## Missing Artifact Warnings");
    expect(content).toContain("missing graph artifact");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer retrieves entry from repo-index auth hints when path lacks auth token", async () => {
  const baseDir = await createKnowledgeAnswerRepoSignalFixtureProject();
  try {
    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      codeRoot: "repo",
      question: "How does auth flow work?",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });
    const content = await readFile(result.answers[0]!.outputPath, "utf8");

    const alphaIndex = content.indexOf("| svc-alpha |");
    expect(alphaIndex).toBeGreaterThan(-1);
    expect(content).toContain("repo_signal:");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer dedupes repeated insights into grouped evidence rows", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "app service debug",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });

    const content = await readFile(result.answers[0]!.outputPath, "utf8");
    expect(content).toContain("occurrences: 2");
    expect(content).toContain("ids: layer-leak-1, layer-leak-2");
    expect(content).toContain("diagram_signal:");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer writes deterministic evidence file for a single question", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How app page works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });

    expect(result.answers).toHaveLength(1);
    const answerPath = result.answers[0]!.outputPath;
    const classificationPath = result.answers[0]!.classificationOutputPath;
    const evidencePackPath = result.answers[0]!.evidencePackOutputPath;
    expect(existsSync(answerPath)).toBe(true);
    expect(existsSync(classificationPath)).toBe(true);
    expect(existsSync(evidencePackPath)).toBe(true);
    const content = await readFile(answerPath, "utf8");
    expect(content).toContain("# Prism Knowledge Answer");
    expect(content).toContain("How app page works");
    expect(content).toContain("- question class:");
    expect(content).toContain("- class confidence:");
    expect(content).toContain("- intent:");
    expect(content).toContain("- code root:");
    expect(content).toContain("- confidence:");
    expect(content).toContain("code_file:");
    expect(content).toContain("flow_signal:");
    expect(content).toContain("diagram_signal:");
    expect(content).toContain("final_excerpt:");
    expect(content).toContain("service_flow_excerpt:");
    expect(content).toContain("## Executive Answer");
    expect(content).toContain("## How To Read This Answer");
    expect(content).toContain("## Gaps / Uncertainty");
    expect(content).toContain("## Proof References");
    expect(content).toContain("## Raw Evidence Appendix");
    expect(content).toContain("No missing artifacts detected for ranked entries.");
    expect(content).toContain("Auth flow starts at login");
    expect(content).toContain("## Auth Flow");
    expect(content).toContain("## Guards & Permissions");
    expect(content).toContain("## Failure Paths");
    expect(content).toContain("## Evidence Map");
    expect(content).toContain("| rank | run | entry | status | path | start_here | detail |");
    expect(content).toContain("Evidence Entries");
    expect(content).toContain("Evidence Insights");

    const classification = JSON.parse(
      await readFile(classificationPath, "utf8"),
    ) as {
      schemaVersion: number;
      class: string;
      confidence: string;
      classScores: Array<{ class: string; score: number }>;
      topicCandidates: Array<{ label: string; score: number; reasons: string[] }>;
    };
    expect(classification.schemaVersion).toBe(1);
    expect(classification.class.length).toBeGreaterThan(0);
    expect(classification.confidence.length).toBeGreaterThan(0);
    expect(classification.classScores.length).toBeGreaterThan(0);
    expect(classification.topicCandidates.length).toBeGreaterThan(0);

    const evidencePack = JSON.parse(await readFile(evidencePackPath, "utf8")) as {
      status: string;
      requirements: string[];
      satisfied: string[];
      missing: string[];
      sources: Array<{ kind: string; path: string }>;
      codeRootFallback: { used: boolean; maxFiles: number; maxBytesPerFile: number };
    };
    expect(evidencePack.status.length).toBeGreaterThan(0);
    expect(evidencePack.requirements.length).toBeGreaterThan(0);
    expect(Array.isArray(evidencePack.satisfied)).toBe(true);
    expect(Array.isArray(evidencePack.missing)).toBe(true);
    expect(evidencePack.sources.length).toBeGreaterThan(0);
    expect(evidencePack.codeRootFallback.maxFiles).toBe(25);
    expect(evidencePack.codeRootFallback.maxBytesPerFile).toBe(250 * 1024);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer rerun keeps markdown/json/classification/evidence-pack byte-identical", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const first = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How app page works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      emitJson: true,
      force: true,
    });
    const firstAnswer = first.answers[0]!;
    const firstMarkdown = await readFile(firstAnswer.outputPath, "utf8");
    const firstJson = await readFile(firstAnswer.jsonOutputPath!, "utf8");
    const firstClass = await readFile(firstAnswer.classificationOutputPath, "utf8");
    const firstEvidence = await readFile(firstAnswer.evidencePackOutputPath, "utf8");

    const second = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How app page works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      emitJson: true,
      force: false,
    });
    const secondAnswer = second.answers[0]!;
    const secondMarkdown = await readFile(secondAnswer.outputPath, "utf8");
    const secondJson = await readFile(secondAnswer.jsonOutputPath!, "utf8");
    const secondClass = await readFile(secondAnswer.classificationOutputPath, "utf8");
    const secondEvidence = await readFile(secondAnswer.evidencePackOutputPath, "utf8");

    expect(secondMarkdown).toBe(firstMarkdown);
    expect(secondJson).toBe(firstJson);
    expect(secondClass).toBe(firstClass);
    expect(secondEvidence).toBe(firstEvidence);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer evidence pack uses bounded code-root fallback when analyze references are missing", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "Where is foo/bar/ghost.zzz defined?",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });

    const evidencePack = JSON.parse(
      await readFile(result.answers[0]!.evidencePackOutputPath, "utf8"),
    ) as {
      status: string;
      missing: string[];
      codeRootFallback: {
        used: boolean;
        scannedFiles: number;
        matchedFiles: number;
        matchedPaths: string[];
      };
    };
    expect(evidencePack.codeRootFallback.used).toBe(true);
    expect(evidencePack.codeRootFallback.scannedFiles).toBeGreaterThanOrEqual(0);
    expect(Array.isArray(evidencePack.codeRootFallback.matchedPaths)).toBe(true);
    expect(evidencePack.status.length).toBeGreaterThan(0);
    expect(Array.isArray(evidencePack.missing)).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer fallback scanning is bounded by configured max files", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const fallbackTokens: string[] = [];
    await mkdir(join(baseDir, "src/fallback"), { recursive: true });
    for (let index = 0; index < 40; index += 1) {
      const fileRel = `src/fallback/f${String(index).padStart(2, "0")}.ts`;
      await writeFile(
        join(baseDir, fileRel),
        `export const fallback${index} = ${index};\n`,
      );
      fallbackTokens.push(fileRel);
    }

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: `What calls this flow? ${fallbackTokens.join(" ")}`,
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });

    const evidencePack = JSON.parse(
      await readFile(result.answers[0]!.evidencePackOutputPath, "utf8"),
    ) as {
      missing: string[];
      codeRootFallback: {
        used: boolean;
        maxFiles: number;
        scannedFiles: number;
        matchedFiles: number;
        matchedPaths: string[];
      };
    };
    expect(evidencePack.codeRootFallback.used).toBe(true);
    expect(evidencePack.codeRootFallback.maxFiles).toBe(25);
    expect(evidencePack.codeRootFallback.scannedFiles).toBe(
      evidencePack.codeRootFallback.maxFiles,
    );
    expect(evidencePack.codeRootFallback.matchedFiles).toBeLessThanOrEqual(
      evidencePack.codeRootFallback.scannedFiles,
    );
    expect(evidencePack.codeRootFallback.matchedPaths.length).toBe(
      evidencePack.codeRootFallback.matchedFiles,
    );
    expect(evidencePack.missing).toContain("dependency_edges");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer uses standardized truncation markers in human sections", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const artifactsIndexPath = join(baseDir, ".prism/knowledge/artifacts-index.json");
    const artifactsIndex = JSON.parse(await readFile(artifactsIndexPath, "utf8")) as {
      runs: Array<{
        entries: Array<{
          name: string;
          path: string;
          status: "success" | "failed";
          workdir: string;
          scope: string;
          symbols: string;
          repoIndex: string;
          insights: string;
          finalIndex: string;
          finalReport: string;
          symbolDirectoryPage: string;
          moduleDirectoryPage: string;
        }>;
      }>;
    };
    const seed = artifactsIndex.runs[0]!.entries.find(
      (entry) => entry.name === "app-page",
    );
    expect(seed).toBeDefined();
    const expanded = [];
    for (let index = 1; index <= 9; index += 1) {
      const fileRel = `src/app/page-${index}.tsx`;
      await writeFile(
        join(baseDir, fileRel),
        `export default function Page${index}() { return null; }\n`,
      );
      expanded.push({
        ...seed!,
        name: `app-page-${index}`,
        path: fileRel,
      });
    }
    artifactsIndex.runs[0]!.entries = expanded;
    await writeFile(artifactsIndexPath, `${JSON.stringify(artifactsIndex, null, 2)}\n`);

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How does src/app/page-1.tsx work?",
      outDir: ".prism/knowledge/answers",
      top: 9,
      force: true,
    });

    const content = await readFile(result.answers[0]!.outputPath, "utf8");
    expect(content).toContain("- showing 8 of 9 ranked entries");
    expect(content).toContain("- showing 8 of 9 ranked references");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer renders deterministic fail-open guidance for ambiguous prompts", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "auth?",
      outDir: ".prism/knowledge/answers",
      emitJson: true,
      top: 5,
      force: true,
    });

    const content = await readFile(result.answers[0]!.outputPath, "utf8");
    expect(content).toContain("## Fail-Open Guidance");
    expect(content).toContain("question_class_ambiguous");
    expect(content).toContain("candidate topics");
    expect(content).toContain("candidate entries");

    const json = JSON.parse(await readFile(result.answers[0]!.jsonOutputPath!, "utf8")) as {
      failOpen: {
        triggered: boolean;
        reasons: string[];
      };
    };
    expect(json.failOpen.triggered).toBe(true);
    expect(json.failOpen.reasons.length).toBeGreaterThan(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer emits deterministic json when requested", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How app page works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      emitJson: true,
      force: true,
    });

    const jsonPath = result.answers[0]!.jsonOutputPath;
    expect(jsonPath).toBeDefined();
    expect(jsonPath && existsSync(jsonPath)).toBe(true);
    const json = JSON.parse(await readFile(jsonPath!, "utf8")) as {
      schemaVersion: number;
      intent: string;
      entries: unknown[];
      confidence: { level: string; score: number };
      warnings: string[];
      integritySignals: {
        staleRunSignals: string[];
        contradictionSignals: string[];
        relevantSignals: string[];
      };
    };
    expect(json.schemaVersion).toBe(1);
    expect(json.intent).toBe("general");
    expect(Array.isArray(json.entries)).toBe(true);
    expect(json.entries.length).toBeGreaterThan(0);
    expect(json.confidence.level.length).toBeGreaterThan(0);
    expect(Number.isInteger(json.confidence.score)).toBe(true);
    expect(Array.isArray(json.warnings)).toBe(true);
    expect(Array.isArray(json.integritySignals.staleRunSignals)).toBe(true);
    expect(Array.isArray(json.integritySignals.contradictionSignals)).toBe(true);
    expect(Array.isArray(json.integritySignals.relevantSignals)).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer surfaces stale and contradiction signals from artifacts index", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await appendConflictingMultiRunForAppPage(baseDir);
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How app page works",
      outDir: ".prism/knowledge/answers",
      emitJson: true,
      top: 8,
      force: true,
    });

    const content = await readFile(result.answers[0]!.outputPath, "utf8");
    expect(content).toContain("## Staleness & Contradiction Signals");
    expect(content).toContain("entry status conflict for src/app/page.tsx");
    const json = JSON.parse(await readFile(result.answers[0]!.jsonOutputPath!, "utf8")) as {
      integritySignals: {
        contradictionSignals: string[];
        relevantSignals: string[];
      };
    };
    expect(json.integritySignals.contradictionSignals).toContainEqual(
      expect.stringContaining("entry status conflict for src/app/page.tsx"),
    );
    expect(json.integritySignals.relevantSignals.length).toBeGreaterThan(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer strict mode reports failures after writing outputs", async () => {
  const baseDir = await createKnowledgeAnswerRankingFixtureProject();
  try {
    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      codeRoot: "repo",
      question: "How does auth flow work?",
      outDir: ".prism/knowledge/answers",
      top: 5,
      strict: true,
      minConfidence: "high",
      force: true,
    });
    expect(result.answers).toHaveLength(1);
    expect(existsSync(result.answers[0]!.outputPath)).toBe(true);
    expect(result.strict.enabled).toBe(true);
    expect(result.strict.failed).toBe(true);
    expect(result.strict.failures.length).toBeGreaterThan(0);
    expect(result.strict.issues.length).toBeGreaterThan(0);
    expect(result.strict.summary.issueCount).toBeGreaterThan(0);
    expect(result.strict.summary.failedQuestionCount).toBeGreaterThan(0);
    expect(result.strict.summary.categories.length).toBeGreaterThan(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer strict mode surfaces class and fail-open categories", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "auth?",
      outDir: ".prism/knowledge/answers",
      strict: true,
      minConfidence: "high",
      force: true,
    });
    expect(result.strict.failed).toBe(true);
    const categories = result.strict.issues.map((issue) => issue.category);
    expect(categories).toContain("question_class_ambiguous");
    expect(categories).toContain("evidence_pack_incomplete");
    expect(categories).toContain("fail_open_required");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer supports questions file and writes batch index", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    await writeFile(
      join(baseDir, ".tmp", "questions.json"),
      JSON.stringify(
        {
          questions: ["How auth works", "Which entries failed"],
        },
        null,
        2,
      ),
    );

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      questionsFile: ".tmp/questions.json",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });

    expect(result.answers).toHaveLength(2);
    expect(result.indexPath).toBeDefined();
    expect(result.indexPath && existsSync(result.indexPath)).toBe(true);
    const batchIndex = await readFile(result.indexPath!, "utf8");
    expect(batchIndex).toContain("Prism Knowledge Answers");
    expect(batchIndex).toContain("- question count: 2");
    expect(batchIndex).toContain("- answer count: 2");
    expect(batchIndex).toContain("- strict mode: disabled");
    expect(batchIndex).toContain(
      "| # | digest | class | confidence | evidence | fail-open | strict | markdown | json | classification | evidence-pack | question |",
    );
    expect(batchIndex).toContain("## Class Summary");
    expect(batchIndex).toContain("## Evidence-Pack Summary");
    expect(batchIndex).toContain("## Needs Follow-Up");
    expect(batchIndex).toContain(".classification.json");
    expect(batchIndex).toContain(".evidence-pack.json");
    expect(batchIndex).toContain("How auth works");
    expect(batchIndex).toContain("Which entries failed");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer batch index reports strict issues per question", async () => {
  const baseDir = await createKnowledgeAnswerRankingFixtureProject();
  try {
    await writeFile(
      join(baseDir, "questions.json"),
      JSON.stringify(
        {
          questions: ["How does auth flow work?", "How does auth service work?"],
        },
        null,
        2,
      ),
    );

    const result = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      codeRoot: "repo",
      questionsFile: "questions.json",
      outDir: ".prism/knowledge/answers",
      top: 5,
      strict: true,
      minConfidence: "high",
      force: true,
    });

    expect(result.answers).toHaveLength(2);
    expect(result.strict.enabled).toBe(true);
    expect(result.strict.failed).toBe(true);
    expect(result.strict.failures.length).toBeGreaterThan(0);
    expect(result.indexPath).toBeDefined();
    expect(result.indexPath && existsSync(result.indexPath)).toBe(true);
    const batchIndex = await readFile(result.indexPath!, "utf8");
    expect(batchIndex).toContain("- strict mode: enabled (min=high)");
    expect(batchIndex).toContain("## Strict Summary");
    expect(batchIndex).toContain("| category | count |");
    expect(batchIndex).toContain("## Class Summary");
    expect(batchIndex).toContain("## Evidence-Pack Summary");
    expect(batchIndex).toContain("## Needs Follow-Up");
    expect(batchIndex).toContain("## Strict Issues");
    expect(batchIndex).toContain("fail(");
    expect(batchIndex).toContain("code=");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer large strict batch keeps index stable and parse-friendly", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const questions = [
      "How does the auth system work?",
      "Where is useAuth defined?",
      "What calls deleteOldToken?",
      "Where does login flow start?",
      "What files make up auth?",
      "How should I add MFA?",
      "auth?",
      "How app page works",
      "Which entries failed?",
      "Where is src/app/page.tsx defined?",
      "What are failure paths in auth?",
    ];
    await writeFile(
      join(baseDir, ".tmp", "questions-large.json"),
      JSON.stringify({ questions }, null, 2),
    );

    const first = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      questionsFile: ".tmp/questions-large.json",
      outDir: ".prism/knowledge/answers-batch",
      strict: true,
      minConfidence: "high",
      emitJson: true,
      top: 8,
      force: true,
    });
    expect(first.answers).toHaveLength(questions.length);
    expect(first.indexPath).toBeDefined();
    expect(first.indexPath && existsSync(first.indexPath)).toBe(true);
    const firstIndex = await readFile(first.indexPath!, "utf8");
    expect(firstIndex).toContain("- question count: 11");
    expect(firstIndex).toContain("- answer count: 11");
    expect(firstIndex).toContain("- strict mode: enabled (min=high)");
    expect(firstIndex).toContain("## Strict Summary");
    expect(firstIndex).toContain("## Strict Issues");
    expect(firstIndex).toContain("## Class Summary");
    expect(firstIndex).toContain("## Evidence-Pack Summary");
    expect(firstIndex).toContain("## Needs Follow-Up");
    expect(firstIndex).toContain(".classification.json");
    expect(firstIndex).toContain(".evidence-pack.json");

    const second = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      questionsFile: ".tmp/questions-large.json",
      outDir: ".prism/knowledge/answers-batch",
      strict: true,
      minConfidence: "high",
      emitJson: true,
      top: 8,
      force: false,
    });
    const secondIndex = await readFile(second.indexPath!, "utf8");
    expect(secondIndex).toBe(firstIndex);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge answer skips unchanged output unless forced", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    await runKnowledgeBuild({
      baseDir,
      analyzeRoot: ".tmp/analyze",
      docsRoot: "docs/prism",
      outRoot: ".prism/knowledge",
      force: true,
    });

    const first = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How auth works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });
    const firstStat = await stat(first.answers[0]!.outputPath);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const second = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How auth works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: false,
    });
    const secondStat = await stat(second.answers[0]!.outputPath);
    expect(secondStat.mtimeMs).toBe(firstStat.mtimeMs);

    await new Promise((resolve) => setTimeout(resolve, 20));
    const forced = await runKnowledgeAnswer({
      baseDir,
      knowledgeRoot: ".prism/knowledge",
      question: "How auth works",
      outDir: ".prism/knowledge/answers",
      top: 5,
      force: true,
    });
    const forcedStat = await stat(forced.answers[0]!.outputPath);
    expect(forcedStat.mtimeMs).toBeGreaterThan(secondStat.mtimeMs);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge cli parses custom roots and writes output to custom out path", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const proc = Bun.spawnSync({
      cmd: [
        "bun",
        cliPath,
        "knowledge",
        "build",
        "--analyze-root",
        ".tmp/analyze",
        "--docs-root",
        "docs/prism",
        "--out",
        ".prism/custom-knowledge",
        "--force",
      ],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(proc.exitCode).toBe(0);
    const knowledgePackPath = join(baseDir, ".prism/custom-knowledge/knowledge-pack.json");
    const artifactsIndexPath = join(baseDir, ".prism/custom-knowledge/artifacts-index.json");
    const validationReportPath = join(
      baseDir,
      ".prism/custom-knowledge/validation-report.md",
    );
    expect(existsSync(knowledgePackPath)).toBe(true);
    expect(existsSync(artifactsIndexPath)).toBe(true);
    expect(existsSync(validationReportPath)).toBe(true);

    const pack = JSON.parse(await readFile(knowledgePackPath, "utf8")) as {
      analyzeRoot: string;
      docsRoot: string;
    };
    expect(pack.analyzeRoot).toBe(".tmp/analyze");
    expect(pack.docsRoot).toBe("docs/prism");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge cli writes answer output from --question", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const build = Bun.spawnSync({
      cmd: ["bun", cliPath, "knowledge", "build", "--force"],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    const answer = Bun.spawnSync({
      cmd: [
        "bun",
        cliPath,
        "knowledge",
        "answer",
        "--question",
        "How auth works",
        "--out-dir",
        ".prism/knowledge/answers",
        "--emit-json",
        "--force",
      ],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(answer.exitCode).toBe(0);
    const answerPath = join(baseDir, ".prism/knowledge/answers/how-auth-works.md");
    const answerJsonPath = join(baseDir, ".prism/knowledge/answers/how-auth-works.json");
    expect(existsSync(answerPath)).toBe(true);
    expect(existsSync(answerJsonPath)).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge cli strict mode exits non-zero after writing answer files", async () => {
  const baseDir = await createKnowledgeFixtureProject();
  try {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const build = Bun.spawnSync({
      cmd: ["bun", cliPath, "knowledge", "build", "--force"],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(build.exitCode).toBe(0);

    const strictAnswer = Bun.spawnSync({
      cmd: [
        "bun",
        cliPath,
        "knowledge",
        "answer",
        "--question",
        "How app page works",
        "--out-dir",
        ".prism/knowledge/answers",
        "--strict",
        "--min-confidence",
        "high",
        "--force",
      ],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });
    expect(strictAnswer.exitCode).toBe(1);
    const answerPath = join(baseDir, ".prism/knowledge/answers/how-app-page-works.md");
    expect(existsSync(answerPath)).toBe(true);
    const stderr = Buffer.from(strictAnswer.stderr).toString("utf8");
    expect(stderr).toContain("STRICT_SUMMARY");
    expect(stderr).toContain("STRICT_CATEGORY");
    expect(stderr).toContain("STRICT_FAILURE");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("knowledge cli update writes dry-run report artifacts", async () => {
  const baseDir = await createKnowledgeUpdateFixtureProject();
  try {
    const cliPath = fileURLToPath(new URL("../src/cli.ts", import.meta.url));
    const { fromCommit, toCommit } = await resolveFixtureRepoCommits(baseDir);
    const update = Bun.spawnSync({
      cmd: [
        "bun",
        cliPath,
        "knowledge",
        "update",
        "--repo-root",
        "repo",
        "--knowledge-root",
        ".prism/knowledge",
        "--from",
        fromCommit,
        "--to",
        toCommit,
        "--batch-size",
        "2",
        "--dry-run",
        "--force",
      ],
      cwd: baseDir,
      stdout: "pipe",
      stderr: "pipe",
    });

    expect(update.exitCode).toBe(0);
    const out = Buffer.from(update.stdout).toString("utf8");
    expect(out).toContain("[update-report]");
    expect(out).toContain("[update-report-md]");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

async function createKnowledgeUpdateFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-knowledge-update-"));
  const repoRoot = join(baseDir, "repo");
  const knowledgeRoot = join(baseDir, ".prism/knowledge");
  const analyzeRoot = join(baseDir, ".tmp/analyze");
  const multiRunRoot = join(analyzeRoot, "multi", "abc123def456");
  const docsRoot = join(baseDir, "docs/prism");
  await mkdir(repoRoot, { recursive: true });
  await mkdir(knowledgeRoot, { recursive: true });
  await mkdir(multiRunRoot, { recursive: true });
  await mkdir(docsRoot, { recursive: true });

  runGit(repoRoot, ["init", "-q"]);
  runGit(repoRoot, ["config", "user.name", "Prism Test"]);
  runGit(repoRoot, ["config", "user.email", "prism@example.com"]);
  runGit(repoRoot, ["config", "commit.gpgsign", "false"]);

  await writeFile(join(repoRoot, "alpha.ts"), "export const alpha = 1;\n");
  runGit(repoRoot, ["add", "alpha.ts"]);
  runGit(
    repoRoot,
    ["commit", "-m", "feat: add alpha"],
    fixedGitEnv("2026-05-20T00:00:00Z"),
  );

  await writeFile(join(repoRoot, "alpha.ts"), "export const alpha = 2;\n");
  runGit(repoRoot, ["add", "alpha.ts"]);
  runGit(
    repoRoot,
    ["commit", "-m", "chore: tune alpha"],
    fixedGitEnv("2026-05-20T01:00:00Z"),
  );

  await writeFile(join(repoRoot, "beta.ts"), "export const beta = 1;\n");
  runGit(repoRoot, ["add", "beta.ts"]);
  runGit(
    repoRoot,
    ["commit", "-m", "feat: add beta"],
    fixedGitEnv("2026-05-20T02:00:00Z"),
  );

  runGit(repoRoot, ["mv", "beta.ts", "gamma.ts"]);
  runGit(
    repoRoot,
    ["commit", "-m", "refactor: rename beta to gamma"],
    fixedGitEnv("2026-05-20T03:00:00Z"),
  );

  runGit(repoRoot, ["rm", "gamma.ts"]);
  runGit(
    repoRoot,
    ["commit", "-m", "chore: remove gamma"],
    fixedGitEnv("2026-05-20T04:00:00Z"),
  );

  const index = {
    schemaVersion: 1,
    generatedAt: "2026-05-21T00:00:00.000Z",
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    outRoot: ".prism/knowledge",
    multiRunDigest: "abc123def456",
    runs: [
      {
        configDigest: "abc123def456",
        runRoot: ".tmp/analyze/multi/abc123def456",
        manifest: ".tmp/analyze/multi/abc123def456/manifest.json",
        index: ".tmp/analyze/multi/abc123def456/index.md",
        architecture: ".tmp/analyze/multi/abc123def456/architecture.md",
        entries: [
          {
            name: "entry-alpha",
            path: "alpha.ts",
            status: "success",
            workdir: ".tmp/analyze/alpha",
            scope: ".tmp/analyze/alpha/scope/scope.json",
            symbols: ".tmp/analyze/alpha/symbols/symbols.json",
            repoIndex: ".tmp/analyze/alpha/repo-index/repo-index.json",
            insights: ".tmp/analyze/alpha/insights/insights.json",
            finalIndex: ".tmp/analyze/alpha/final/index.md",
            finalReport: ".tmp/analyze/alpha/final/analysis.md",
            symbolDirectoryPage: ".tmp/analyze/alpha/final/pages/11-symbol-directory.md",
            moduleDirectoryPage: ".tmp/analyze/alpha/final/pages/12-module-directory.md",
          },
          {
            name: "entry-beta",
            path: "beta.ts",
            status: "success",
            workdir: ".tmp/analyze/beta",
            scope: ".tmp/analyze/beta/scope/scope.json",
            symbols: ".tmp/analyze/beta/symbols/symbols.json",
            repoIndex: ".tmp/analyze/beta/repo-index/repo-index.json",
            insights: ".tmp/analyze/beta/insights/insights.json",
            finalIndex: ".tmp/analyze/beta/final/index.md",
            finalReport: ".tmp/analyze/beta/final/analysis.md",
            symbolDirectoryPage: ".tmp/analyze/beta/final/pages/11-symbol-directory.md",
            moduleDirectoryPage: ".tmp/analyze/beta/final/pages/12-module-directory.md",
          },
        ],
      },
    ],
    discoveredEntryWorkdirs: [],
    orphanEntryWorkdirs: [],
    docsArtifactLinks: [],
  };
  await writeFile(
    join(knowledgeRoot, "artifacts-index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );
  await writeFile(join(multiRunRoot, "index.md"), "# update fixture\n");
  await writeFile(join(multiRunRoot, "architecture.md"), "# update fixture\n");
  await writeFile(
    join(multiRunRoot, "manifest.json"),
    JSON.stringify(
      {
        configDigest: "abc123def456",
        config: {
          depth: 1,
          maxFiles: 1000,
          include: [],
          exclude: [],
        },
        entries: [
          {
            name: "entry-alpha",
            path: "alpha.ts",
            workdir: ".tmp/analyze/alpha",
            status: "success",
            artifacts: {
              scope: ".tmp/analyze/alpha/scope/scope.json",
              symbols: ".tmp/analyze/alpha/symbols/symbols.json",
              repoIndex: ".tmp/analyze/alpha/repo-index/repo-index.json",
              graph: ".tmp/analyze/alpha/graph/graph.json",
              insights: ".tmp/analyze/alpha/insights/insights.json",
              diagramsManifest: ".tmp/analyze/alpha/diagrams/manifest.json",
              finalIndex: ".tmp/analyze/alpha/final/index.md",
              finalReport: ".tmp/analyze/alpha/final/analysis.md",
            },
          },
          {
            name: "entry-beta",
            path: "beta.ts",
            workdir: ".tmp/analyze/beta",
            status: "success",
            artifacts: {
              scope: ".tmp/analyze/beta/scope/scope.json",
              symbols: ".tmp/analyze/beta/symbols/symbols.json",
              repoIndex: ".tmp/analyze/beta/repo-index/repo-index.json",
              graph: ".tmp/analyze/beta/graph/graph.json",
              insights: ".tmp/analyze/beta/insights/insights.json",
              diagramsManifest: ".tmp/analyze/beta/diagrams/manifest.json",
              finalIndex: ".tmp/analyze/beta/final/index.md",
              finalReport: ".tmp/analyze/beta/final/analysis.md",
            },
          },
        ],
      },
      null,
      2,
    ) + "\n",
  );
  await writeFile(join(docsRoot, "index.md"), "# prism docs\n");

  return baseDir;
}

async function resolveFixtureRepoCommits(baseDir: string): Promise<{
  repoRoot: string;
  fromCommit: string;
  toCommit: string;
}> {
  const repoRoot = join(baseDir, "repo");
  const fromCommit = runGit(repoRoot, ["rev-list", "--max-parents=0", "HEAD"]).trim();
  const toCommit = runGit(repoRoot, ["rev-parse", "HEAD"]).trim();
  return { repoRoot: "repo", fromCommit, toCommit };
}

function runGit(cwd: string, args: string[], env?: Record<string, string>): string {
  const proc = Bun.spawnSync({
    cmd: ["git", ...args],
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: env ? { ...process.env, ...env } : process.env,
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `git ${args.join(" ")} failed: ${Buffer.from(proc.stderr).toString("utf8")}`,
    );
  }
  return Buffer.from(proc.stdout).toString("utf8");
}

function fixedGitEnv(iso: string): Record<string, string> {
  return {
    GIT_AUTHOR_DATE: iso,
    GIT_COMMITTER_DATE: iso,
  };
}

async function createKnowledgeFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-knowledge-fixture-"));
  const analyzeRoot = join(baseDir, ".tmp/analyze");
  const multiRunRoot = join(analyzeRoot, "multi", "abc123def456");
  const successWorkdirRel = ".tmp/analyze/src__app__page.tsx-d2-aaaaaaaa";
  const failedWorkdirRel = ".tmp/analyze/src__missing__Nope.tsx-d2-bbbbbbbb";
  const successWorkdir = join(baseDir, successWorkdirRel);
  const failedWorkdir = join(baseDir, failedWorkdirRel);
  const docsRoot = join(baseDir, "docs/prism");

  await mkdir(multiRunRoot, { recursive: true });
  await mkdir(docsRoot, { recursive: true });
  await mkdir(join(baseDir, "src/app"), { recursive: true });
  await mkdir(join(successWorkdir, "scope"), { recursive: true });
  await mkdir(join(successWorkdir, "symbols"), { recursive: true });
  await mkdir(join(successWorkdir, "repo-index"), { recursive: true });
  await mkdir(join(successWorkdir, "graph"), { recursive: true });
  await mkdir(join(successWorkdir, "insights"), { recursive: true });
  await mkdir(join(successWorkdir, "diagrams"), { recursive: true });
  await mkdir(join(successWorkdir, "final/pages"), { recursive: true });
  await mkdir(join(failedWorkdir, "scope"), { recursive: true });

  const diagramFile = join(successWorkdir, "diagrams", "component-tree.md");
  const serviceFlowDiagramFile = join(successWorkdir, "diagrams", "service-flow.md");
  await writeFile(diagramFile, "# Component Tree\n");
  await writeFile(serviceFlowDiagramFile, "# Service Flow\n");
  await writeFile(
    join(baseDir, "src/app/page.tsx"),
    "export default function Page() { return null; }\n",
  );
  await writeFile(
    join(successWorkdir, "scope", "scope.json"),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        depth: 2,
        include: ["src/**"],
        exclude: [],
        files: [{ path: "src/app/page.tsx", depth: 0 }],
        unresolvedImports: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "symbols", "symbols.json"),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        files: ["src/app/page.tsx"],
        symbols: [
          {
            id: "component:src/app/page.tsx:Page:1",
            type: "component",
            name: "Page",
            file: "src/app/page.tsx",
            line: 1,
            span: [1, 3],
            exported: true,
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "repo-index", "repo-index.json"),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        generatedFrom: {
          scope: "../scope/scope.json",
          symbols: "../symbols/symbols.json",
        },
        fileCount: 1,
        symbolCount: 1,
        typeCounts: {
          component: 1,
          hook: 0,
          context: 0,
          function: 0,
          constant: 0,
          store: 0,
          store_state: 0,
          store_getter: 0,
          store_action: 0,
          class: 0,
          method: 0,
          type: 0,
          service: 0,
        },
        files: [
          {
            path: "src/app/page.tsx",
            symbolCount: 1,
            exportedSymbolCount: 1,
            typeCounts: {
              component: 1,
              hook: 0,
              context: 0,
              function: 0,
              constant: 0,
              store: 0,
              store_state: 0,
              store_getter: 0,
              store_action: 0,
              class: 0,
              method: 0,
              type: 0,
              service: 0,
            },
            symbols: [
              {
                id: "component:src/app/page.tsx:Page:1",
                type: "component",
                name: "Page",
                line: 1,
                exported: true,
              },
            ],
            exportedSymbols: ["Page"],
          },
        ],
        entryFileSymbols: [
          {
            id: "component:src/app/page.tsx:Page:1",
            type: "component",
            name: "Page",
            line: 1,
            exported: true,
          },
        ],
        entryFileExportedSymbols: ["Page"],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "graph", "graph.json"),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        depth: 2,
        nodes: [],
        edges: [],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "insights", "insights.json"),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        generatedFrom: "graph.json",
        insights: [
          {
            id: "layer-leak-1",
            severity: "medium",
            lens: "layering",
            title: "Component calls service directly",
            evidence: [{ from: "component:Page", to: "service:fetchMetrics" }],
            explanation: "example",
            suggestion: "example",
          },
          {
            id: "layer-leak-2",
            severity: "medium",
            lens: "layering",
            title: "Component calls service directly",
            evidence: [
              { from: "component:Dashboard", to: "service:fetchMetrics" },
              { from: "component:Widget", to: "service:fetchMetrics" },
            ],
            explanation: "example",
            suggestion: "example",
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "diagrams", "manifest.json"),
    JSON.stringify(
      [
        {
          name: "component-tree",
          title: "Component Tree",
          path: diagramFile,
          edgeCount: 0,
        },
        {
          name: "service-flow",
          title: "Service Flow",
          path: serviceFlowDiagramFile,
          edgeCount: 4,
        },
      ],
      null,
      2,
    ),
  );
  await writeFile(
    join(successWorkdir, "final", "index.md"),
    [
      "# index",
      "",
      "Auth flow starts at login and creates a session token for the app shell.",
      "",
    ].join("\n"),
  );
  await writeFile(join(successWorkdir, "final", "analysis.md"), "# analysis\n");
  await writeFile(
    join(successWorkdir, "final/pages", "08-service-flow.md"),
    [
      "# Service Flow",
      "",
      "Auth service exchanges credentials for a JWT session token.",
      "",
    ].join("\n"),
  );
  await writeFile(
    join(successWorkdir, "final/pages", "11-symbol-directory.md"),
    "# Symbol Directory\n",
  );
  await writeFile(
    join(successWorkdir, "final/pages", "12-module-directory.md"),
    "# Module Directory\n",
  );

  await writeFile(
    join(failedWorkdir, "scope", "scope.json"),
    JSON.stringify(
      {
        entry: "src/missing/Nope.tsx",
        depth: 2,
        include: [],
        exclude: [],
        files: [{ path: "src/missing/Nope.tsx", depth: 0 }],
        unresolvedImports: [],
      },
      null,
      2,
    ),
  );

  const manifest = {
    configDigest: "abc123def456",
    config: {
      depth: 2,
      maxFiles: 1000,
      include: ["src/**"],
      exclude: [],
    },
    entries: [
      {
        name: "missing-entry",
        path: "src/missing/Nope.tsx",
        workdir: failedWorkdirRel,
        status: "failed",
        artifacts: {
          scope: `${failedWorkdirRel}/scope/scope.json`,
          symbols: `${failedWorkdirRel}/symbols/symbols.json`,
          repoIndex: `${failedWorkdirRel}/repo-index/repo-index.json`,
          graph: `${failedWorkdirRel}/graph/graph.json`,
          insights: `${failedWorkdirRel}/insights/insights.json`,
          diagramsManifest: `${failedWorkdirRel}/diagrams/manifest.json`,
          finalIndex: `${failedWorkdirRel}/final/index.md`,
          finalReport: `${failedWorkdirRel}/final/analysis.md`,
        },
        error: "analyze entry not found: src/missing/Nope.tsx",
      },
      {
        name: "app-page",
        path: "src/app/page.tsx",
        workdir: successWorkdirRel,
        status: "success",
        artifacts: {
          scope: `${successWorkdirRel}/scope/scope.json`,
          symbols: `${successWorkdirRel}/symbols/symbols.json`,
          repoIndex: `${successWorkdirRel}/repo-index/repo-index.json`,
          graph: `${successWorkdirRel}/graph/graph.json`,
          insights: `${successWorkdirRel}/insights/insights.json`,
          diagramsManifest: `${successWorkdirRel}/diagrams/manifest.json`,
          finalIndex: `${successWorkdirRel}/final/index.md`,
          finalReport: `${successWorkdirRel}/final/analysis.md`,
        },
        counts: {
          files: 1,
          symbols: 1,
          edges: 0,
          diagrams: 2,
          insights: 1,
        },
      },
    ],
  };

  await writeFile(join(multiRunRoot, "manifest.json"), JSON.stringify(manifest, null, 2));
  await writeFile(join(multiRunRoot, "index.md"), "# Static Analysis Multi-Entry Index\n");
  await writeFile(
    join(multiRunRoot, "architecture.md"),
    "# Static Analysis Multi-Entry Architecture\n",
  );

  await writeFile(
    join(docsRoot, "index.md"),
    [
      "# Prism Docs",
      "",
      `- [Existing artifact](../../${successWorkdirRel}/final/index.md)`,
      "- [Missing artifact](../../.tmp/analyze/not-found/final/index.md)",
      "",
    ].join("\n"),
  );

  return baseDir;
}

async function appendConflictingMultiRunForAppPage(baseDir: string): Promise<void> {
  const runDigest = "fff222bbb111";
  const runRoot = join(baseDir, ".tmp/analyze/multi", runDigest);
  const successWorkdirRel = ".tmp/analyze/src__app__page.tsx-d2-aaaaaaaa";
  const highInsightsRel = `${successWorkdirRel}/insights/insights-high.json`;
  await mkdir(runRoot, { recursive: true });
  await writeFile(
    join(baseDir, highInsightsRel),
    JSON.stringify(
      {
        entry: "src/app/page.tsx",
        generatedFrom: "graph.json",
        insights: [
          {
            id: "layer-leak-conflict",
            severity: "high",
            lens: "layering",
            title: "Component calls service directly",
            evidence: [{ from: "component:Page", to: "service:fetchMetrics" }],
            explanation: "conflict severity",
            suggestion: "conflict severity",
          },
        ],
      },
      null,
      2,
    ),
  );

  await writeFile(
    join(runRoot, "manifest.json"),
    JSON.stringify(
      {
        configDigest: runDigest,
        config: {
          depth: 2,
          maxFiles: 1000,
          include: ["src/**"],
          exclude: [],
        },
        entries: [
          {
            name: "app-page",
            path: "src/app/page.tsx",
            workdir: successWorkdirRel,
            status: "failed",
            artifacts: {
              scope: `${successWorkdirRel}/scope/scope.json`,
              symbols: `${successWorkdirRel}/symbols/symbols.json`,
              repoIndex: `${successWorkdirRel}/repo-index/repo-index.json`,
              graph: `${successWorkdirRel}/graph/graph.json`,
              insights: highInsightsRel,
              diagramsManifest: `${successWorkdirRel}/diagrams/manifest.json`,
              finalIndex: `${successWorkdirRel}/final/index.md`,
              finalReport: `${successWorkdirRel}/final/analysis.md`,
            },
            error: "synthetic conflict fixture",
          },
        ],
      },
      null,
      2,
    ),
  );
  await writeFile(join(runRoot, "index.md"), "# Static Analysis Multi-Entry Index\n");
  await writeFile(
    join(runRoot, "architecture.md"),
    "# Static Analysis Multi-Entry Architecture\n",
  );
}

async function createKnowledgeAnswerRankingFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-knowledge-ranking-"));
  const knowledgeRoot = join(baseDir, ".prism/knowledge");
  const repoRoot = join(baseDir, "repo");
  await mkdir(knowledgeRoot, { recursive: true });
  await mkdir(join(repoRoot, "src/core/apolloClient/services"), { recursive: true });
  await mkdir(join(repoRoot, "src/workers"), { recursive: true });

  await writeFile(
    join(repoRoot, "src/core/apolloClient/services/auth-service.ts"),
    "export const auth = 1;\n",
  );
  await writeFile(join(repoRoot, "src/workers/authWorker.ts"), "export const w = 1;\n");

  const pack = {
    schemaVersion: 1,
    generatedAt: "2026-05-21T00:00:00.000Z",
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    runs: [],
    entries: [],
    domains: [],
    symbols: [],
    modules: [],
    insights: [],
    docs: [],
  };

  const makeEntry = (name: string, path: string) => ({
    name,
    path,
    status: "success" as const,
    workdir: `.tmp/analyze/${name}`,
    scope: `.tmp/analyze/${name}/scope/scope.json`,
    symbols: `.tmp/analyze/${name}/symbols/symbols.json`,
    repoIndex: `.tmp/analyze/${name}/repo-index/repo-index.json`,
    insights: `.tmp/analyze/${name}/insights/insights.json`,
    finalIndex: `.tmp/analyze/${name}/final/index.md`,
    finalReport: `.tmp/analyze/${name}/final/analysis.md`,
    symbolDirectoryPage: `.tmp/analyze/${name}/final/pages/11-symbol-directory.md`,
    moduleDirectoryPage: `.tmp/analyze/${name}/final/pages/12-module-directory.md`,
  });

  const index = {
    schemaVersion: 1,
    generatedAt: "2026-05-21T00:00:00.000Z",
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    outRoot: ".prism/knowledge",
    multiRunDigest: "abc123def456",
    runs: [
      {
        configDigest: "abc123def456",
        runRoot: ".tmp/analyze/multi/abc123def456",
        manifest: ".tmp/analyze/multi/abc123def456/manifest.json",
        index: ".tmp/analyze/multi/abc123def456/index.md",
        architecture: ".tmp/analyze/multi/abc123def456/architecture.md",
        entries: [
          makeEntry("svc-auth", "src/core/apolloClient/services/auth-service.ts"),
          makeEntry("auth-worker", "src/workers/authWorker.ts"),
        ],
      },
    ],
    discoveredEntryWorkdirs: [],
    orphanEntryWorkdirs: [],
    docsArtifactLinks: [],
  };

  await writeFile(
    join(knowledgeRoot, "knowledge-pack.json"),
    JSON.stringify(pack, null, 2) + "\n",
  );
  await writeFile(
    join(knowledgeRoot, "artifacts-index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );

  return baseDir;
}

async function createKnowledgeAnswerRepoSignalFixtureProject(): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-knowledge-repo-signal-"));
  const knowledgeRoot = join(baseDir, ".prism/knowledge");
  const repoRoot = join(baseDir, "repo");
  const analyzeRoot = join(baseDir, ".tmp/analyze");
  await mkdir(knowledgeRoot, { recursive: true });
  await mkdir(join(repoRoot, "src/core/services"), { recursive: true });
  await mkdir(join(analyzeRoot, "svc-alpha/repo-index"), { recursive: true });
  await mkdir(join(analyzeRoot, "svc-beta/repo-index"), { recursive: true });

  await writeFile(join(repoRoot, "src/core/services/alpha.ts"), "export const a = 1;\n");
  await writeFile(join(repoRoot, "src/core/services/beta.ts"), "export const b = 1;\n");

  const pack = {
    schemaVersion: 1,
    generatedAt: "2026-05-21T00:00:00.000Z",
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    runs: [],
    entries: [],
    domains: [],
    symbols: [],
    modules: [],
    insights: [],
    docs: [],
  };

  const makeEntry = (name: string, path: string) => ({
    name,
    path,
    status: "success" as const,
    workdir: `.tmp/analyze/${name}`,
    scope: `.tmp/analyze/${name}/scope/scope.json`,
    symbols: `.tmp/analyze/${name}/symbols/symbols.json`,
    repoIndex: `.tmp/analyze/${name}/repo-index/repo-index.json`,
    insights: `.tmp/analyze/${name}/insights/insights.json`,
    finalIndex: `.tmp/analyze/${name}/final/index.md`,
    finalReport: `.tmp/analyze/${name}/final/analysis.md`,
    symbolDirectoryPage: `.tmp/analyze/${name}/final/pages/11-symbol-directory.md`,
    moduleDirectoryPage: `.tmp/analyze/${name}/final/pages/12-module-directory.md`,
  });

  const index = {
    schemaVersion: 1,
    generatedAt: "2026-05-21T00:00:00.000Z",
    analyzeRoot: ".tmp/analyze",
    docsRoot: "docs/prism",
    outRoot: ".prism/knowledge",
    multiRunDigest: "abc123def456",
    runs: [
      {
        configDigest: "abc123def456",
        runRoot: ".tmp/analyze/multi/abc123def456",
        manifest: ".tmp/analyze/multi/abc123def456/manifest.json",
        index: ".tmp/analyze/multi/abc123def456/index.md",
        architecture: ".tmp/analyze/multi/abc123def456/architecture.md",
        entries: [
          makeEntry("svc-alpha", "src/core/services/alpha.ts"),
          makeEntry("svc-beta", "src/core/services/beta.ts"),
        ],
      },
    ],
    discoveredEntryWorkdirs: [],
    orphanEntryWorkdirs: [],
    docsArtifactLinks: [],
  };

  const repoIndexWithAuthHints = {
    entry: "src/core/services/alpha.ts",
    generatedFrom: {
      scope: "../scope/scope.json",
      symbols: "../symbols/symbols.json",
    },
    fileCount: 2,
    symbolCount: 3,
    typeCounts: {
      component: 0,
      hook: 0,
      context: 0,
      function: 1,
      constant: 1,
      store: 0,
      store_state: 0,
      store_getter: 0,
      store_action: 0,
      class: 0,
      method: 0,
      type: 0,
      service: 1,
    },
    files: [
      {
        path: "src/core/auth/sessionExchange.ts",
        symbolCount: 2,
        exportedSymbolCount: 1,
        typeCounts: {
          component: 0,
          hook: 0,
          context: 0,
          function: 1,
          constant: 0,
          store: 0,
          store_state: 0,
          store_getter: 0,
          store_action: 0,
          class: 0,
          method: 0,
          type: 0,
          service: 1,
        },
        symbols: [
          { id: "service:1", type: "service", name: "exchangeAuthToken", line: 1, exported: true },
          { id: "fn:1", type: "function", name: "readSession", line: 2, exported: false },
        ],
        exportedSymbols: ["exchangeAuthToken"],
      },
      {
        path: "src/core/services/alpha.ts",
        symbolCount: 1,
        exportedSymbolCount: 1,
        typeCounts: {
          component: 0,
          hook: 0,
          context: 0,
          function: 0,
          constant: 1,
          store: 0,
          store_state: 0,
          store_getter: 0,
          store_action: 0,
          class: 0,
          method: 0,
          type: 0,
          service: 0,
        },
        symbols: [{ id: "const:1", type: "constant", name: "ALPHA", line: 1, exported: true }],
        exportedSymbols: ["ALPHA"],
      },
    ],
    entryFileSymbols: [
      { id: "const:1", type: "constant", name: "ALPHA", line: 1, exported: true },
    ],
    entryFileExportedSymbols: ["ALPHA"],
  };

  const repoIndexNeutral = {
    entry: "src/core/services/beta.ts",
    generatedFrom: {
      scope: "../scope/scope.json",
      symbols: "../symbols/symbols.json",
    },
    fileCount: 1,
    symbolCount: 1,
    typeCounts: {
      component: 0,
      hook: 0,
      context: 0,
      function: 1,
      constant: 0,
      store: 0,
      store_state: 0,
      store_getter: 0,
      store_action: 0,
      class: 0,
      method: 0,
      type: 0,
      service: 0,
    },
    files: [
      {
        path: "src/core/services/beta.ts",
        symbolCount: 1,
        exportedSymbolCount: 1,
        typeCounts: {
          component: 0,
          hook: 0,
          context: 0,
          function: 1,
          constant: 0,
          store: 0,
          store_state: 0,
          store_getter: 0,
          store_action: 0,
          class: 0,
          method: 0,
          type: 0,
          service: 0,
        },
        symbols: [{ id: "fn:2", type: "function", name: "compute", line: 1, exported: true }],
        exportedSymbols: ["compute"],
      },
    ],
    entryFileSymbols: [
      { id: "fn:2", type: "function", name: "compute", line: 1, exported: true },
    ],
    entryFileExportedSymbols: ["compute"],
  };

  await writeFile(
    join(analyzeRoot, "svc-alpha/repo-index/repo-index.json"),
    JSON.stringify(repoIndexWithAuthHints, null, 2) + "\n",
  );
  await writeFile(
    join(analyzeRoot, "svc-beta/repo-index/repo-index.json"),
    JSON.stringify(repoIndexNeutral, null, 2) + "\n",
  );

  await writeFile(
    join(knowledgeRoot, "knowledge-pack.json"),
    JSON.stringify(pack, null, 2) + "\n",
  );
  await writeFile(
    join(knowledgeRoot, "artifacts-index.json"),
    JSON.stringify(index, null, 2) + "\n",
  );

  return baseDir;
}

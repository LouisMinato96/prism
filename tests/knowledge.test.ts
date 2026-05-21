import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  resolveKnowledgeAnswerOptions,
  resolveKnowledgeBuildOptions,
} from "../src/lib/knowledge-options.ts";
import {
  discoverAnalyzeEntryWorkdirs,
  discoverAnalyzeMultiRunRoots,
  runKnowledgeBuild,
} from "../src/stages/knowledge/build.ts";
import {
  classifyIntent,
  runKnowledgeAnswer,
} from "../src/stages/knowledge/answer.ts";

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
    expect(existsSync(answerPath)).toBe(true);
    const content = await readFile(answerPath, "utf8");
    expect(content).toContain("# Prism Knowledge Answer");
    expect(content).toContain("How app page works");
    expect(content).toContain("- intent:");
    expect(content).toContain("- code root:");
    expect(content).toContain("- confidence:");
    expect(content).toContain("code_file:");
    expect(content).toContain("flow_signal:");
    expect(content).toContain("diagram_signal:");
    expect(content).toContain("final_excerpt:");
    expect(content).toContain("service_flow_excerpt:");
    expect(content).toContain("No missing artifacts detected for ranked entries.");
    expect(content).toContain("Auth flow starts at login");
    expect(content).toContain("Evidence Entries");
    expect(content).toContain("Evidence Insights");
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
    };
    expect(json.schemaVersion).toBe(1);
    expect(json.intent).toBe("general");
    expect(Array.isArray(json.entries)).toBe(true);
    expect(json.entries.length).toBeGreaterThan(0);
    expect(json.confidence.level.length).toBeGreaterThan(0);
    expect(Number.isInteger(json.confidence.score)).toBe(true);
    expect(Array.isArray(json.warnings)).toBe(true);
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
    expect(batchIndex).toContain("How auth works");
    expect(batchIndex).toContain("Which entries failed");
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
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

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

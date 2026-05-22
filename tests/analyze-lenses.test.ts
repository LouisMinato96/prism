import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runAnalyzeEntry } from "../src/stages/analyze/run.ts";
import { AnalyzeInsightsSchema } from "../src/schemas/index.ts";
import { readFile } from "node:fs/promises";
import { LENSES } from "../src/stages/analyze/lenses/index.ts";

async function setupFixture(content: string, name = "entry.ts"): Promise<string> {
  const baseDir = await mkdtemp(join(tmpdir(), "prism-lens-"));
  await writeFile(join(baseDir, name), content);
  return baseDir;
}

async function runLensFixture(input: {
  baseDir: string;
  entry?: string;
}): Promise<ReturnType<typeof AnalyzeInsightsSchema.parse>> {
  const result = await runAnalyzeEntry(
    { path: input.entry ?? "entry.ts", name: "fixture" },
    {
      baseDir: input.baseDir,
      depth: 1,
      maxFiles: 50,
      force: { forceAll: true },
    },
  );
  const insightsJson = JSON.parse(await readFile(result.workdir.insightsFile(), "utf8"));
  return AnalyzeInsightsSchema.parse(insightsJson);
}

test("LENSES registry has 8 unique stable ids", () => {
  expect(LENSES.length).toBe(8);
  const ids = LENSES.map((lens) => lens.id);
  expect(new Set(ids).size).toBe(8);
  expect(ids).toEqual([
    "hook-deps-mismatch",
    "complexity-hotspot",
    "type-safety-escape",
    "bloater",
    "dead-code",
    "await-in-loop",
    "security-quick-win",
    "todo-density",
  ]);
});

test("hook-deps-mismatch flags missing dependency in useEffect", async () => {
  const baseDir = await setupFixture(`
import { useEffect } from "react";

export function Component(props: { count: number }) {
  useEffect(() => {
    console.log(props.count);
  }, []);
  return null;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "hook-deps-mismatch");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("medium");
    expect(hits[0]!.docsUrl).toContain("react.dev");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("complexity-hotspot flags deeply branching function with metric", async () => {
  const branches = Array.from(
    { length: 15 },
    (_, i) => `  if (n === ${i}) return ${i};`,
  ).join("\n");
  const baseDir = await setupFixture(`
export function classify(n: number): number {
${branches}
  return -1;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "complexity-hotspot");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.metric?.name).toBe("complexity");
    expect(hits[0]!.metric!.value).toBeGreaterThan(10);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("type-safety-escape counts any, as, non-null assertions", async () => {
  const baseDir = await setupFixture(`
export function loose(): unknown {
  const a: any = 1;
  const b = a as string;
  const c = (b as any) as number;
  const d = (b as any).length!;
  const e = (a as any) as string;
  const f = a as any;
  return [a, b, c, d, e, f];
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "type-safety-escape");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.metric?.value).toBeGreaterThanOrEqual(5);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("bloater flags long parameter list", async () => {
  const baseDir = await setupFixture(`
export function manyParams(a: number, b: number, c: number, d: number, e: number, f: number) {
  return a + b + c + d + e + f;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter(
      (i) => i.lens === "bloater" && i.title.includes("Long parameter list"),
    );
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.metric?.name).toBe("param-count");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("await-in-loop flags await inside for loop but not for-await-of", async () => {
  const baseDir = await setupFixture(`
export async function run(items: number[]) {
  for (const item of items) {
    await Promise.resolve(item);
  }
  for await (const item of items) {
    console.log(item);
  }
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "await-in-loop");
    expect(hits.length).toBe(1);
    expect(hits[0]!.severity).toBe("medium");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("security-quick-win flags eval, new Function, and hardcoded AWS key", async () => {
  const baseDir = await setupFixture(`
export function risky(input: string) {
  eval(input);
  new Function("return 1")();
  const key = "AKIAABCDEFGHIJKLMNOP";
  return key;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "security-quick-win");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const titles = hits.map((i) => i.title);
    expect(titles).toContain("eval() call");
    expect(titles).toContain("new Function() call");
    expect(titles.some((t) => t.includes("aws-access-key"))).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("todo-density flags TODO and FIXME markers", async () => {
  const baseDir = await setupFixture(`
// TODO: fix this
// FIXME: also this
// HACK: short term
export function noop() {
  return 0;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "todo-density");
    expect(hits.length).toBe(1);
    expect(hits[0]!.metric?.name).toBe("marker-count");
    expect(hits[0]!.metric!.value).toBe(3);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("analyze insights are deterministic across runs", async () => {
  const baseDir = await setupFixture(`
import { useEffect } from "react";
export function C(props: { x: number }) {
  useEffect(() => { console.log(props.x); }, []);
  return null;
}
`);
  try {
    const first = await runLensFixture({ baseDir });
    const second = await runLensFixture({ baseDir });
    expect(JSON.stringify(second.insights)).toBe(JSON.stringify(first.insights));
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

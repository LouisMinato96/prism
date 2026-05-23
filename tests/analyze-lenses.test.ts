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

test("LENSES registry has 25 unique stable ids", () => {
  expect(LENSES.length).toBe(25);
  const ids = LENSES.map((lens) => lens.id);
  expect(new Set(ids).size).toBe(25);
  expect(ids).toEqual([
    "hook-deps-mismatch",
    "complexity-hotspot",
    "type-safety-escape",
    "bloater",
    "dead-code",
    "await-in-loop",
    "security-quick-win",
    "todo-density",
    "console-log",
    "unused-imports",
    "promise-error-handling",
    "magic-number",
    "no-floating-promises",
    "duplicate-string-literal",
    "excessive-nesting",
    "implicit-any-return",
    "empty-catch",
    "long-parameter-list",
    "large-file",
    "switch-without-default",
    "layering",
    "react",
    "diagrams",
    "coupling-cycle",
    "coupling-hub",
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

test("console-log flags console.log, console.warn, and debugger statement", async () => {
  const baseDir = await setupFixture(`
export function debug(x: number) {
  console.log("value:", x);
  console.warn("warning");
  console.error("error");
  debugger;
  return x;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "console-log");
    expect(hits.length).toBeGreaterThanOrEqual(4);
    const titles = hits.map((i) => i.title);
    expect(titles).toContain("console.log() call");
    expect(titles).toContain("console.warn() call");
    expect(titles).toContain("console.error() call");
    expect(titles).toContain("debugger statement");
    const logHit = hits.find((i) => i.title === "console.log() call")!;
    expect(logHit.severity).toBe("info");
    const warnHit = hits.find((i) => i.title === "console.warn() call")!;
    expect(warnHit.severity).toBe("low");
    const debugHit = hits.find((i) => i.title === "debugger statement")!;
    expect(debugHit.severity).toBe("medium");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("unused-imports flags unused import but not used ones", async () => {
  const baseDir = await setupFixture(`
import { join } from "node:path";
import { existsSync } from "node:fs";

export function check() {
  return existsSync("/tmp");
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "unused-imports");
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toContain("join");
    expect(hits[0]!.severity).toBe("low");
    expect(hits[0]!.evidence![0]!.detail).toContain("node:path");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("promise-error-handling flags .then() without .catch()", async () => {
  const baseDir = await setupFixture(`
export function run() {
  fetch("/api").then((r) => r.json());
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "promise-error-handling");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("medium");
    expect(hits[0]!.title).toContain(".then()");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("promise-error-handling ignores .then() with .catch() in chain", async () => {
  const baseDir = await setupFixture(`
export function run() {
  fetch("/api").then((r) => r.json()).catch((e) => console.error(e));
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter(
      (i) => i.lens === "promise-error-handling" && i.title.includes(".then()"),
    );
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("magic-number flags numeric literals outside const declarations", async () => {
  const baseDir = await setupFixture(`
export function calc(x: number) {
  return x * 42 + 100 + 200;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "magic-number");
    expect(hits.length).toBeGreaterThanOrEqual(3);
    const values = hits.map((i) => i.title);
    expect(values.some((t) => t.includes("42"))).toBe(true);
    expect(values.some((t) => t.includes("100"))).toBe(true);
    expect(values.some((t) => t.includes("200"))).toBe(true);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("magic-number ignores 0, 1, -1 and const declarations", async () => {
  const baseDir = await setupFixture(`
const MAX = 10;
export function simple(arr: number[]) {
  if (arr.length === 0) return -1;
  return arr[0]! + 1;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "magic-number");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("no-floating-promises flags unhandled async call", async () => {
  const baseDir = await setupFixture(`
async function doWork() {
  return 42;
}
export function run() {
  doWork();
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "no-floating-promises");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toContain("doWork");
    expect(hits[0]!.severity).toBe("medium");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("no-floating-promises ignores awaited and voided calls", async () => {
  const baseDir = await setupFixture(`
async function doWork() {
  return 42;
}
export async function run() {
  await doWork();
  void doWork();
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "no-floating-promises");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("duplicate-string-literal flags string appearing 3+ times", async () => {
  const baseDir = await setupFixture(`
export function build() {
  const a = "application/json";
  const b = "application/json";
  const c = "application/json";
  return [a, b, c];
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "duplicate-string-literal");
    expect(hits.length).toBe(1);
    expect(hits[0]!.title).toContain("application/json");
    expect(hits[0]!.metric?.value).toBe(3);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("duplicate-string-literal ignores strings with fewer than 3 occurrences", async () => {
  const baseDir = await setupFixture(`
export function build() {
  const a = "content-type";
  const b = "content-type";
  return [a, b];
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "duplicate-string-literal");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("excessive-nesting flags deeply nested control flow", async () => {
  const baseDir = await setupFixture(`
export function deep(x: number, items: number[]) {
  if (x > 0) {
    for (const item of items) {
      if (item > 0) {
        try {
          if (item > 10) {
            console.log(item);
          }
        } catch (e) {}
      }
    }
  }
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "excessive-nesting");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.metric?.name).toBe("max-nesting-depth");
    expect(hits[0]!.metric!.value).toBeGreaterThanOrEqual(5);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("excessive-nesting ignores shallow functions", async () => {
  const baseDir = await setupFixture(`
export function shallow(x: number) {
  if (x > 0) {
    for (let i = 0; i < x; i++) {
      console.log(i);
    }
  }
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "excessive-nesting");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("implicit-any-return flags function without return type annotation", async () => {
  const baseDir = await setupFixture(`
export function compute(x: number) {
  return x * 2;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "implicit-any-return");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.title).toContain("compute");
    expect(hits[0]!.severity).toBe("info");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("implicit-any-return ignores functions with explicit return type", async () => {
  const baseDir = await setupFixture(`
export function compute(x: number): number {
  return x * 2;
}
export const add = (a: number, b: number) => a + b;
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "implicit-any-return");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("empty-catch flags catch block with no statements", async () => {
  const baseDir = await setupFixture(`
export function tryParse(json: string) {
  try {
    return JSON.parse(json);
  } catch (e) {
  }
  return null;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "empty-catch");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("medium");
    expect(hits[0]!.title).toContain("Empty catch");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("empty-catch ignores catch blocks with executable statements", async () => {
  const baseDir = await setupFixture(`
export function tryParse(json: string) {
  try {
    return JSON.parse(json);
  } catch (e) {
    console.error(e);
  }
  return null;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "empty-catch");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("long-parameter-list flags function with 5+ parameters", async () => {
  const baseDir = await setupFixture(`
export function createUser(name: string, email: string, age: number, role: string, team: string) {
  return { name, email, age, role, team };
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "long-parameter-list");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("low");
    expect(hits[0]!.metric!.name).toBe("param-count");
    expect(hits[0]!.metric!.value).toBe(5);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("long-parameter-list ignores functions with 4 or fewer parameters", async () => {
  const baseDir = await setupFixture(`
export function add(a: number, b: number, c: number, d: number) {
  return a + b + c + d;
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "long-parameter-list");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("large-file flags file exceeding 300 lines", async () => {
  const lines = Array.from(
    { length: 310 },
    (_, i) => `export const v${i} = ${i};`,
  ).join("\n");
  const baseDir = await setupFixture(lines);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "large-file");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("low");
    expect(hits[0]!.metric!.name).toBe("file-line-count");
    expect(hits[0]!.metric!.value).toBeGreaterThanOrEqual(300);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("large-file ignores files under 300 lines", async () => {
  const baseDir = await setupFixture(`
export const a = 1;
export const b = 2;
export const c = 3;
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "large-file");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("switch-without-default flags switch missing default case", async () => {
  const baseDir = await setupFixture(`
export function classify(x: number) {
  switch (x) {
    case 1: return "one";
    case 2: return "two";
  }
  return "unknown";
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "switch-without-default");
    expect(hits.length).toBeGreaterThan(0);
    expect(hits[0]!.severity).toBe("info");
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

test("switch-without-default ignores switch with default case", async () => {
  const baseDir = await setupFixture(`
export function classify(x: number) {
  switch (x) {
    case 1: return "one";
    case 2: return "two";
    default: return "other";
  }
}
`);
  try {
    const insights = await runLensFixture({ baseDir });
    const hits = insights.insights.filter((i) => i.lens === "switch-without-default");
    expect(hits.length).toBe(0);
  } finally {
    await rm(baseDir, { recursive: true, force: true });
  }
});

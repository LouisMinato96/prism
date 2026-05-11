import { z } from "zod";
import { readFile } from "node:fs/promises";
import { config } from "../config.ts";
import { log } from "./log.ts";

export interface CallClaudeOpts<T> {
  promptFile: string;
  input: string;
  schema: z.ZodSchema<T>;
  extraContext?: string;
  maxRetries?: number;
  tag?: string;
}

interface ClaudeResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

async function spawnClaude(prompt: string, input: string): Promise<ClaudeResult> {
  const proc = Bun.spawn([config.claudeBin, "-p", prompt, "--output-format", "text"], {
    stdin: "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  proc.stdin.write(input);
  await proc.stdin.end();

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);

  return { stdout, stderr, exitCode };
}

function extractJson(text: string): string | null {
  const fenced = text.match(/```(?:json)?\s*\n([\s\S]*?)\n```/);
  if (fenced && fenced[1]) return fenced[1].trim();

  const firstObj = text.indexOf("{");
  const firstArr = text.indexOf("[");
  const start =
    firstObj === -1
      ? firstArr
      : firstArr === -1
        ? firstObj
        : Math.min(firstObj, firstArr);
  if (start === -1) return null;

  const open = text[start]!;
  const close = open === "{" ? "}" : "]";
  const lastClose = text.lastIndexOf(close);
  if (lastClose <= start) return null;

  return text.slice(start, lastClose + 1).trim();
}

export async function callClaude<T>(opts: CallClaudeOpts<T>): Promise<T> {
  const promptTemplate = await readFile(opts.promptFile, "utf8");
  const maxRetries = opts.maxRetries ?? config.maxClaudeRetries;
  const tag = opts.tag ?? "claude";

  let lastError: string | null = null;
  let consecutiveSchemaFailures = 0;
  const startTime = performance.now();
  let attempts = 0;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    attempts++;
    const prompt = buildPrompt(promptTemplate, opts.extraContext, lastError);

    log.debug(`attempt ${attempt + 1}/${maxRetries} (input ${opts.input.length}b)`, tag);

    let result: ClaudeResult;
    try {
      result = await spawnClaude(prompt, opts.input);
    } catch (err) {
      lastError = `spawn failed: ${(err as Error).message}`;
      log.warn(lastError, tag);
      consecutiveSchemaFailures = 0;
      continue;
    }

    if (result.exitCode !== 0) {
      lastError = `claude exited ${result.exitCode}: ${result.stderr.slice(0, 500)}`;
      log.warn(lastError, tag);
      consecutiveSchemaFailures = 0;
      continue;
    }

    const jsonText = extractJson(result.stdout);
    if (!jsonText) {
      lastError = `no JSON found in output. First 300 chars: ${result.stdout.slice(0, 300)}`;
      log.warn(lastError, tag);
      consecutiveSchemaFailures = 0;
      continue;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(jsonText);
    } catch (err) {
      lastError = `JSON.parse failed: ${(err as Error).message}. Text: ${jsonText.slice(0, 300)}`;
      log.warn(lastError, tag);
      consecutiveSchemaFailures = 0;
      continue;
    }

    const validation = opts.schema.safeParse(parsed);
    if (!validation.success) {
      consecutiveSchemaFailures++;
      lastError = `schema validation failed: ${JSON.stringify(validation.error.issues, null, 2)}`;
      log.warn(
        `validation failed (attempt ${attempt + 1}, ${consecutiveSchemaFailures} consecutive)`,
        tag,
      );

      if (consecutiveSchemaFailures >= 2) {
        recordMetric(tag, attempts, startTime, false);
        throw new Error(
          `callClaude(${tag}) fast-failed: ${consecutiveSchemaFailures} consecutive schema validation failures.\nLast error:\n${lastError}`,
        );
      }
      continue;
    }

    recordMetric(tag, attempts, startTime, true);
    return validation.data;
  }

  recordMetric(tag, attempts, startTime, false);
  throw new Error(
    `callClaude(${tag}) exhausted ${maxRetries} retries.\nLast error:\n${lastError}`,
  );
}

export interface CallMetrics {
  tag: string;
  attempts: number;
  durationMs: number;
  success: boolean;
}

const allMetrics: CallMetrics[] = [];

function recordMetric(
  tag: string,
  attempts: number,
  startTime: number,
  success: boolean,
): void {
  allMetrics.push({
    tag,
    attempts,
    durationMs: Math.round(performance.now() - startTime),
    success,
  });
}

export function getMetricsSummary() {
  const totalCalls = allMetrics.length;
  const totalAttempts = allMetrics.reduce((n, m) => n + m.attempts, 0);
  const successes = allMetrics.filter((m) => m.success).length;
  const failures = totalCalls - successes;
  const totalDurationMs = allMetrics.reduce((n, m) => n + m.durationMs, 0);
  return { totalCalls, totalAttempts, successes, failures, totalDurationMs };
}

function buildPrompt(
  template: string,
  extra: string | undefined,
  lastError: string | null,
): string {
  let prompt = template;
  if (extra) {
    prompt += `\n\n## Additional context\n${extra}`;
  }
  if (lastError) {
    prompt += `\n\n## Previous attempt failed\n${lastError}\n\nProduce valid output matching the schema. Output JSON only.`;
  }
  return prompt;
}

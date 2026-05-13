import { readFile } from "node:fs/promises";
import { isAbsolute, resolve } from "node:path";

export interface AnalyzeConfigDefaults {
  entry?: string;
  depth?: number;
  include?: string;
  exclude?: string;
}

export interface AnalyzeCliOverrides {
  entry?: string;
  depth?: string;
  include?: string;
  exclude?: string;
}

export interface ResolvedAnalyzeInput {
  entry?: string;
  depth?: string;
  include?: string;
  exclude?: string;
}

export async function loadAnalyzeConfig(
  configPath: string,
  cwd: string = process.cwd(),
): Promise<AnalyzeConfigDefaults> {
  const resolvedPath = isAbsolute(configPath) ? configPath : resolve(cwd, configPath);

  let rawText: string;
  try {
    rawText = await readFile(resolvedPath, "utf8");
  } catch (error) {
    throw new Error(`unable to read analyze config at ${resolvedPath}`);
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error(`invalid analyze config JSON at ${resolvedPath}`);
  }

  return parseAnalyzeConfigObject(parsed, resolvedPath);
}

export function parseAnalyzeConfigObject(
  value: unknown,
  source: string = "analyze config",
): AnalyzeConfigDefaults {
  if (!isRecord(value)) {
    throw new Error(`invalid analyze config at ${source}: expected an object`);
  }

  const allowedKeys = new Set(["entry", "depth", "include", "exclude"]);
  for (const key of Object.keys(value)) {
    if (!allowedKeys.has(key)) {
      throw new Error(`invalid analyze config at ${source}: unknown key "${key}"`);
    }
  }

  const config: AnalyzeConfigDefaults = {};
  if (value.entry !== undefined) {
    if (typeof value.entry !== "string" || value.entry.trim().length === 0) {
      throw new Error(
        `invalid analyze config at ${source}: "entry" must be a non-empty string`,
      );
    }
    config.entry = value.entry.trim();
  }

  if (value.depth !== undefined) {
    if (
      typeof value.depth !== "number" ||
      !Number.isInteger(value.depth) ||
      value.depth < 0
    ) {
      throw new Error(
        `invalid analyze config at ${source}: "depth" must be a non-negative integer`,
      );
    }
    config.depth = value.depth;
  }

  if (value.include !== undefined) {
    config.include = normalizePatternValue(value.include, "include", source);
  }

  if (value.exclude !== undefined) {
    config.exclude = normalizePatternValue(value.exclude, "exclude", source);
  }

  return config;
}

export function resolveAnalyzeInput(
  cli: AnalyzeCliOverrides,
  config: AnalyzeConfigDefaults,
): ResolvedAnalyzeInput {
  return {
    entry: cli.entry ?? config.entry,
    depth: cli.depth ?? (config.depth === undefined ? undefined : String(config.depth)),
    include: cli.include ?? config.include,
    exclude: cli.exclude ?? config.exclude,
  };
}

function normalizePatternValue(
  value: unknown,
  field: "include" | "exclude",
  source: string,
): string {
  if (typeof value === "string") {
    return value;
  }

  if (!Array.isArray(value)) {
    throw new Error(
      `invalid analyze config at ${source}: "${field}" must be a string or string[]`,
    );
  }

  const normalized = value.map((item) => {
    if (typeof item !== "string") {
      throw new Error(
        `invalid analyze config at ${source}: "${field}" array items must be strings`,
      );
    }
    return item;
  });
  return normalized.join(",");
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

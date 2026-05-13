import { existsSync, readFileSync, statSync } from "node:fs";
import { dirname, extname, isAbsolute, join, relative, resolve, sep } from "node:path";
import { Project } from "ts-morph";
import type { AnalyzeEdgeType, AnalyzeNodeType } from "../../schemas/index.ts";

export const ANALYZE_EXTS = [".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"] as const;
export const ANALYZE_EXT_SET = new Set<string>(ANALYZE_EXTS);

const COMPOUND_SUFFIXES = [
  ".types",
  ".styles",
  ".helpers",
  ".constants",
  ".context",
  ".hooks",
] as const;

interface TsconfigPaths {
  baseUrl: string;
  paths: Record<string, string[]>;
}

export function createAnalyzeProject(): Project {
  return new Project({
    compilerOptions: { allowJs: true, jsx: 1 /* Preserve */ },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });
}

export function toRelativePath(baseDir: string, path: string): string {
  return relative(baseDir, path).split(sep).join("/");
}

export function toAbsolutePath(baseDir: string, path: string): string {
  return isAbsolute(path) ? path : resolve(baseDir, path);
}

export function normalizeEntry(baseDir: string, entry: string): string {
  return toRelativePath(baseDir, toAbsolutePath(baseDir, entry));
}

export function isAnalyzableFile(path: string): boolean {
  return ANALYZE_EXT_SET.has(extname(path));
}

export function fileNodeId(file: string): string {
  return `file:${file}`;
}

export function symbolId(
  type: Exclude<AnalyzeNodeType, "file">,
  file: string,
  name: string,
  line: number,
): string {
  return `${type}:${file}:${name}:${line}`;
}

export function edgeId(
  type: AnalyzeEdgeType,
  from: string,
  to: string,
  line?: number,
): string {
  return `${type}:${from}->${to}${line ? `:${line}` : ""}`;
}

export function resolveRelativeImport(
  baseDir: string,
  fromFile: string,
  specifier: string,
): string | null {
  if (!specifier.startsWith(".")) return null;

  const fromAbs = toAbsolutePath(baseDir, fromFile);
  const base = resolve(dirname(fromAbs), specifier);
  return resolveCandidate(baseDir, base);
}

export function resolveProjectImport(baseDir: string, specifier: string): string | null {
  if (specifier.startsWith(".")) return null;

  const tsconfig = readTsconfigPaths(baseDir);
  if (!tsconfig) return null;

  for (const [pattern, targets] of Object.entries(tsconfig.paths)) {
    const match = matchPathPattern(pattern, specifier);
    if (!match) continue;

    for (const target of targets) {
      const replaced = applyPathTarget(target, match);
      const base = resolve(baseDir, tsconfig.baseUrl, replaced);
      const resolved = resolveCandidate(baseDir, base);
      if (resolved) return resolved;
    }
  }

  const baseUrlResolved = resolveCandidate(
    baseDir,
    resolve(baseDir, tsconfig.baseUrl, specifier),
  );
  if (baseUrlResolved) return baseUrlResolved;

  return null;
}

export function resolveImport(
  baseDir: string,
  fromFile: string,
  specifier: string,
): string | null {
  return (
    resolveRelativeImport(baseDir, fromFile, specifier) ??
    resolveProjectImport(baseDir, specifier)
  );
}

function candidatePaths(base: string): string[] {
  if (ANALYZE_EXT_SET.has(extname(base))) return [base];

  return [
    ...ANALYZE_EXTS.map((ext) => `${base}${ext}`),
    ...COMPOUND_SUFFIXES.flatMap((suffix) =>
      ANALYZE_EXTS.map((ext) => `${base}${suffix}${ext}`),
    ),
    ...ANALYZE_EXTS.map((ext) => join(base, `index${ext}`)),
  ];
}

function resolveCandidate(baseDir: string, base: string): string | null {
  const found = candidatePaths(base).find((candidate) => existsSync(candidate));
  if (!found) return null;

  const stat = statSync(found);
  if (!stat.isFile()) return null;
  return toRelativePath(baseDir, found);
}

function readTsconfigPaths(baseDir: string): TsconfigPaths | null {
  const path = ["tsconfig.json", "jsconfig.json"]
    .map((file) => join(baseDir, file))
    .find((file) => existsSync(file));
  if (!path) return null;

  try {
    const json = JSON.parse(readFileSync(path, "utf8")) as {
      compilerOptions?: {
        baseUrl?: string;
        paths?: Record<string, string[]>;
      };
    };
    return {
      baseUrl: json.compilerOptions?.baseUrl ?? ".",
      paths: json.compilerOptions?.paths ?? {},
    };
  } catch {
    return null;
  }
}

function matchPathPattern(pattern: string, specifier: string): string[] | null {
  const wildcardCount = pattern.split("*").length - 1;
  if (wildcardCount === 0) return pattern === specifier ? [] : null;
  if (wildcardCount > 1) return null;

  const [prefix, suffix = ""] = pattern.split("*");
  if (!specifier.startsWith(prefix) || !specifier.endsWith(suffix)) return null;
  return [specifier.slice(prefix.length, specifier.length - suffix.length)];
}

function applyPathTarget(target: string, matches: string[]): string {
  let result = target;
  for (const match of matches) {
    result = result.replace("*", match);
  }
  return result;
}

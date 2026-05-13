export interface AnalyzeScopeFilters {
  include: string[];
  exclude: string[];
}

export function parsePatternList(value: string | undefined): string[] {
  if (!value) return [];
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);
}

export function shouldIncludePath(path: string, filters: AnalyzeScopeFilters): boolean {
  const included =
    filters.include.length === 0 ||
    filters.include.some((pattern) => matchesGlob(path, pattern));
  if (!included) return false;
  return !filters.exclude.some((pattern) => matchesGlob(path, pattern));
}

export function matchesGlob(path: string, pattern: string): boolean {
  const normalizedPath = normalizePath(path);
  const normalizedPattern = normalizePath(pattern);
  const regex = globToRegExp(normalizedPattern);
  return regex.test(normalizedPath);
}

function normalizePath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\/+/, "");
}

function globToRegExp(pattern: string): RegExp {
  let source = "^";
  for (let index = 0; index < pattern.length; index++) {
    const char = pattern[index];
    const next = pattern[index + 1];

    if (char === "*" && next === "*") {
      source += ".*";
      index++;
      continue;
    }

    if (char === "*") {
      source += "[^/]*";
      continue;
    }

    source += escapeRegExp(char);
  }
  source += "$";
  return new RegExp(source);
}

function escapeRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, "\\$&");
}

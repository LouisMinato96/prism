import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { SourceFile } from "ts-morph";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeScopeSchema,
  type AnalyzeScope,
  type ScopeFile,
  type UnresolvedImport,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import {
  createAnalyzeProject,
  isAnalyzableFile,
  normalizeEntry,
  resolveImport,
  toAbsolutePath,
} from "./utils.ts";
import { shouldIncludePath, type AnalyzeScopeFilters } from "./filters.ts";

export async function runAnalyzeScope(
  wd: AnalyzeWorkdir,
  opts: { force?: boolean; filters?: AnalyzeScopeFilters } = {},
): Promise<AnalyzeScope> {
  const stage = "analyze:scope";
  const filters = opts.filters ?? { include: [], exclude: [] };

  if (!opts.force && existsSync(wd.scopeFile())) {
    log.done("cached", stage);
    return AnalyzeScopeSchema.parse(await Bun.file(wd.scopeFile()).json());
  }

  const entry = normalizeEntry(wd.baseDir, wd.entry);
  const entryAbs = toAbsolutePath(wd.baseDir, entry);
  if (!existsSync(entryAbs)) {
    throw new Error(`analyze entry not found: ${entry}`);
  }
  if (!isAnalyzableFile(entry)) {
    throw new Error(`analyze entry must be TS/JS: ${entry}`);
  }

  log.step(`scoping ${entry} to depth ${wd.depth}`, stage);

  const project = createAnalyzeProject();
  const files = new Map<string, ScopeFile>();
  const unresolvedImports: UnresolvedImport[] = [];
  const queue: ScopeFile[] = [{ path: entry, depth: 0 }];

  while (queue.length > 0) {
    const current = queue.shift()!;
    const existing = files.get(current.path);
    if (existing && existing.depth <= current.depth) continue;
    files.set(current.path, current);

    if (current.depth >= wd.depth) continue;

    const sourceFile = project.addSourceFileAtPath(
      toAbsolutePath(wd.baseDir, current.path),
    );
    for (const moduleRef of moduleReferences(sourceFile)) {
      const resolved = resolveImport(wd.baseDir, current.path, moduleRef.specifier);
      if (!resolved) {
        if (!moduleRef.specifier.startsWith(".")) continue;
        unresolvedImports.push({
          from: current.path,
          specifier: moduleRef.specifier,
          line: moduleRef.line,
          reason: `project ${moduleRef.kind} could not be resolved`,
        });
        continue;
      }

      if (!isAnalyzableFile(resolved)) continue;
      if (!shouldIncludePath(resolved, filters)) continue;
      queue.push({
        path: resolved,
        depth: current.depth + 1,
        via: current.path,
      });
    }
    project.removeSourceFile(sourceFile);
  }

  const result: AnalyzeScope = {
    entry,
    depth: wd.depth,
    include: filters.include,
    exclude: filters.exclude,
    files: [...files.values()].sort(
      (a, b) => a.depth - b.depth || a.path.localeCompare(b.path),
    ),
    unresolvedImports,
  };

  await writeFile(wd.entryFile(), JSON.stringify({ entry, depth: wd.depth }, null, 2));
  await writeFile(wd.scopeFile(), JSON.stringify(result, null, 2));
  log.done(`${result.files.length} files`, stage);
  return result;
}

interface ModuleReference {
  kind: "import" | "export";
  specifier: string;
  line: number;
}

function moduleReferences(sourceFile: SourceFile): ModuleReference[] {
  return [
    ...sourceFile.getImportDeclarations().map((decl) => ({
      kind: "import" as const,
      specifier: decl.getModuleSpecifierValue(),
      line: decl.getStartLineNumber(),
    })),
    ...sourceFile
      .getExportDeclarations()
      .map((decl): ModuleReference | null => {
        const specifier = decl.getModuleSpecifierValue();
        if (!specifier) return null;
        return {
          kind: "export",
          specifier,
          line: decl.getStartLineNumber(),
        };
      })
      .filter((item): item is ModuleReference => item !== null),
  ];
}

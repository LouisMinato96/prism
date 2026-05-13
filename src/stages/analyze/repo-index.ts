import { existsSync } from "node:fs";
import { writeFile } from "node:fs/promises";
import { relative } from "node:path";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeRepoIndexSchema,
  type AnalyzeRepoIndex,
  type AnalyzeRepoIndexFile,
  type AnalyzeRepoIndexSymbol,
  type AnalyzeRepoIndexSymbolType,
  type AnalyzeScope,
  type AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";

export const ANALYZE_REPO_INDEX_TYPES: AnalyzeRepoIndexSymbolType[] = [
  "component",
  "hook",
  "context",
  "function",
  "constant",
  "store",
  "store_state",
  "store_getter",
  "store_action",
  "class",
  "method",
  "type",
  "service",
];

export async function runAnalyzeRepoIndex(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  opts: { force?: boolean } = {},
): Promise<AnalyzeRepoIndex> {
  const stage = "analyze:repo-index";

  if (!opts.force && existsSync(wd.repoIndexFile())) {
    log.done("cached", stage);
    return AnalyzeRepoIndexSchema.parse(await Bun.file(wd.repoIndexFile()).json());
  }

  log.step(
    `indexing ${symbols.symbols.length} symbols from ${scope.files.length} files`,
    stage,
  );

  const symbolsByFile = new Map<string, AnalyzeRepoIndexSymbol[]>();
  for (const symbol of symbols.symbols.slice().sort(compareSymbols)) {
    const current = symbolsByFile.get(symbol.file) ?? [];
    current.push({
      id: symbol.id,
      type: symbol.type,
      name: symbol.name,
      line: symbol.line,
      exported: symbol.exported,
    });
    symbolsByFile.set(symbol.file, current);
  }

  const files = scope.files
    .slice()
    .sort((a, b) => a.path.localeCompare(b.path))
    .map((file) => buildFileSummary(file.path, symbolsByFile.get(file.path) ?? []));

  const entryFile = files.find((file) => file.path === scope.entry);
  const result: AnalyzeRepoIndex = {
    entry: scope.entry,
    generatedFrom: {
      scope: relative(wd.repoIndex(), wd.scopeFile()),
      symbols: relative(wd.repoIndex(), wd.symbolsFile()),
    },
    fileCount: files.length,
    symbolCount: symbols.symbols.length,
    typeCounts: countTypes(symbols.symbols),
    files,
    entryFileSymbols: entryFile?.symbols ?? [],
    entryFileExportedSymbols: entryFile?.exportedSymbols ?? [],
  };

  await writeFile(wd.repoIndexFile(), JSON.stringify(result, null, 2));
  log.done(`${result.fileCount} files, ${result.symbolCount} symbols`, stage);
  return result;
}

function buildFileSummary(
  path: string,
  symbols: AnalyzeRepoIndexSymbol[],
): AnalyzeRepoIndexFile {
  const sortedSymbols = symbols.slice().sort(compareSymbols);
  return {
    path,
    symbolCount: sortedSymbols.length,
    exportedSymbolCount: sortedSymbols.filter((symbol) => symbol.exported).length,
    typeCounts: countTypes(sortedSymbols),
    symbols: sortedSymbols,
    exportedSymbols: sortedSymbols
      .filter((symbol) => symbol.exported)
      .map((symbol) => symbol.name),
  };
}

function countTypes(
  symbols: Pick<AnalyzeRepoIndexSymbol, "type">[],
): Record<AnalyzeRepoIndexSymbolType, number> {
  const counts = Object.fromEntries(
    ANALYZE_REPO_INDEX_TYPES.map((type) => [type, 0]),
  ) as Record<AnalyzeRepoIndexSymbolType, number>;
  for (const symbol of symbols) {
    counts[symbol.type] += 1;
  }
  return counts;
}

function compareSymbols(
  a: Pick<AnalyzeRepoIndexSymbol, "line" | "name" | "type" | "id">,
  b: Pick<AnalyzeRepoIndexSymbol, "line" | "name" | "type" | "id">,
): number {
  return (
    a.line - b.line ||
    a.type.localeCompare(b.type) ||
    a.name.localeCompare(b.name) ||
    a.id.localeCompare(b.id)
  );
}

import { SyntaxKind } from "ts-morph";
import type { AnalyzeInsight } from "../../../schemas/index.ts";
import type { LensInput } from "./index.ts";

const DOCS_URL = "https://typescript-eslint.io/rules/no-unused-vars/";

export function detect(input: LensInput): AnalyzeInsight[] {
  const insights: AnalyzeInsight[] = [];
  let counter = 0;

  for (const [filePath, source] of [...input.sourceFiles.entries()].sort(([a], [b]) =>
    a.localeCompare(b),
  )) {
    for (const decl of source.getImportDeclarations()) {
      const namedImports = decl.getNamedImports();
      const defaultImport = decl.getDefaultImport();
      const namespaceImport = decl.getNamespaceImport();

      const candidates: Array<{ name: string; line: number }> = [];

      if (defaultImport) {
        candidates.push({
          name: defaultImport.getText(),
          line: defaultImport.getStartLineNumber(),
        });
      }

      if (namespaceImport) {
        candidates.push({
          name: namespaceImport.getText(),
          line: namespaceImport.getStartLineNumber(),
        });
      }

      for (const named of namedImports) {
        const alias = named.getAliasNode();
        candidates.push({
          name: alias ? alias.getText() : named.getName(),
          line: named.getStartLineNumber(),
        });
      }

      for (const candidate of candidates) {
        if (isUsedInFile(source, candidate.name, decl.getStart())) {
          continue;
        }
        counter += 1;
        insights.push({
          id: `unused-imports-${counter}`,
          severity: "low",
          lens: "unused-imports",
          title: `Unused import: ${candidate.name}`,
          evidence: [
            {
              file: filePath,
              line: candidate.line,
              symbol: candidate.name,
              detail: `from "${decl.getModuleSpecifierValue()}"`,
            },
          ],
          explanation: `Import "${candidate.name}" is not referenced elsewhere in the file. May be a leftover from refactoring.`,
          suggestion:
            "Remove the unused import. If it is a type-only import used only in erased positions, this may be a false positive — add an explicit `type` qualifier.",
          docsUrl: DOCS_URL,
        });
      }
    }
  }

  return insights;
}

function isUsedInFile(
  source: import("ts-morph").SourceFile,
  name: string,
  importStart: number,
): boolean {
  for (const id of source.getDescendantsOfKind(SyntaxKind.Identifier)) {
    if (id.getText() !== name) continue;
    if (id.getStart() <= importStart) continue;

    const parent = id.getParent();
    if (!parent) continue;

    const parentKind = parent.getKind();
    if (
      parentKind === SyntaxKind.ImportSpecifier ||
      parentKind === SyntaxKind.ImportClause ||
      parentKind === SyntaxKind.NamespaceImport
    ) {
      continue;
    }

    return true;
  }
  return false;
}

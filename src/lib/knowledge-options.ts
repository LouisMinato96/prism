export interface ResolvedKnowledgeBuildOptions {
  analyzeRoot: string;
  docsRoot: string;
  outRoot: string;
}

export function resolveKnowledgeBuildOptions(values: {
  "analyze-root"?: string;
  "docs-root"?: string;
  out?: string;
}): ResolvedKnowledgeBuildOptions {
  return {
    analyzeRoot: cleanOption(values["analyze-root"], ".tmp/analyze"),
    docsRoot: cleanOption(values["docs-root"], "docs/prism"),
    outRoot: cleanOption(values.out, ".prism/knowledge"),
  };
}

function cleanOption(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  if (!trimmed) return fallback;
  return trimmed;
}

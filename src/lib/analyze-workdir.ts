import { createHash } from "node:crypto";
import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "../config.ts";

export class AnalyzeWorkdir {
  readonly root: string;

  constructor(
    public readonly entry: string,
    public readonly depth: number,
    public readonly baseDir: string = process.cwd(),
  ) {
    const hash = createHash("sha1").update(`${entry}:${depth}`).digest("hex").slice(0, 8);
    this.root = join(
      baseDir,
      config.workdirRoot,
      "analyze",
      `${this.safe(entry)}-d${depth}-${hash}`,
    );
  }

  raw = () => join(this.root, "raw");
  scope = () => join(this.root, "scope");
  symbols = () => join(this.root, "symbols");
  repoIndex = () => join(this.root, "repo-index");
  graph = () => join(this.root, "graph");
  insights = () => join(this.root, "insights");
  diagrams = () => join(this.root, "diagrams");
  final = () => join(this.root, "final");
  finalPages = () => join(this.final(), "pages");

  entryFile = () => join(this.raw(), "entry.json");
  scopeFile = () => join(this.scope(), "scope.json");
  astManifestFile = () => join(this.symbols(), "ast-manifest.json");
  symbolsFile = () => join(this.symbols(), "symbols.json");
  repoIndexFile = () => join(this.repoIndex(), "repo-index.json");
  referencesFile = () => join(this.graph(), "references.json");
  graphFile = () => join(this.graph(), "graph.json");
  insightsFile = () => join(this.insights(), "insights.json");
  diagramManifestFile = () => join(this.diagrams(), "manifest.json");
  diagramFile = (name: string) => join(this.diagrams(), `${name}.md`);
  finalIndexReport = () => join(this.final(), "index.md");
  finalReport = () => join(this.final(), "analysis.md");
  finalPage = (name: string) => join(this.finalPages(), name);

  async ensureAll(): Promise<void> {
    const dirs = [
      this.raw(),
      this.scope(),
      this.symbols(),
      this.repoIndex(),
      this.graph(),
      this.insights(),
      this.diagrams(),
      this.final(),
      this.finalPages(),
    ];
    await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));
  }

  private safe(value: string): string {
    return value.replace(/[^a-zA-Z0-9._-]+/g, "__").slice(0, 80);
  }
}

import { z } from "zod";
import {
  AnalyzeInsightSeveritySchema,
  AnalyzeRepoIndexSymbolTypeSchema,
} from "./analyze.ts";

export const KnowledgeSchemaVersion = 1 as const;

export const AnalyzeMultiManifestEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  workdir: z.string(),
  status: z.enum(["success", "failed"]),
  artifacts: z.object({
    scope: z.string(),
    symbols: z.string(),
    repoIndex: z.string(),
    graph: z.string(),
    insights: z.string(),
    diagramsManifest: z.string(),
    finalIndex: z.string(),
    finalReport: z.string(),
  }),
  counts: z
    .object({
      files: z.number().int().nonnegative(),
      symbols: z.number().int().nonnegative(),
      edges: z.number().int().nonnegative(),
      diagrams: z.number().int().nonnegative(),
      insights: z.number().int().nonnegative(),
    })
    .optional(),
  error: z.string().optional(),
});
export type AnalyzeMultiManifestEntry = z.infer<typeof AnalyzeMultiManifestEntrySchema>;

export const AnalyzeMultiManifestSchema = z.object({
  configDigest: z.string(),
  config: z.object({
    depth: z.number().int().nonnegative(),
    maxFiles: z.number().int().positive(),
    include: z.array(z.string()),
    exclude: z.array(z.string()),
  }),
  entries: z.array(AnalyzeMultiManifestEntrySchema),
});
export type AnalyzeMultiManifest = z.infer<typeof AnalyzeMultiManifestSchema>;

export const AnalyzeDiagramSchema = z.object({
  name: z.string(),
  title: z.string(),
  path: z.string(),
  edgeCount: z.number().int().nonnegative(),
});
export type AnalyzeDiagram = z.infer<typeof AnalyzeDiagramSchema>;

export const KnowledgeRunSummarySchema = z.object({
  configDigest: z.string(),
  runRoot: z.string(),
  manifest: z.string(),
  index: z.string(),
  architecture: z.string(),
  entryCount: z.number().int().nonnegative(),
  succeededCount: z.number().int().nonnegative(),
  failedCount: z.number().int().nonnegative(),
});
export type KnowledgeRunSummary = z.infer<typeof KnowledgeRunSummarySchema>;

export const KnowledgeEntrySummarySchema = z.object({
  runDigest: z.string(),
  name: z.string(),
  path: z.string(),
  status: z.enum(["success", "failed"]),
  workdir: z.string(),
  artifacts: AnalyzeMultiManifestEntrySchema.shape.artifacts,
  counts: AnalyzeMultiManifestEntrySchema.shape.counts,
  error: z.string().optional(),
});
export type KnowledgeEntrySummary = z.infer<typeof KnowledgeEntrySummarySchema>;

export const KnowledgeDomainSummarySchema = z.object({
  runDigest: z.string(),
  entry: z.string(),
  folder: z.string(),
  files: z.number().int().nonnegative(),
  symbols: z.number().int().nonnegative(),
  exportedSymbols: z.number().int().nonnegative(),
});
export type KnowledgeDomainSummary = z.infer<typeof KnowledgeDomainSummarySchema>;

export const KnowledgeSymbolSummarySchema = z.object({
  runDigest: z.string(),
  entry: z.string(),
  type: AnalyzeRepoIndexSymbolTypeSchema,
  count: z.number().int().nonnegative(),
});
export type KnowledgeSymbolSummary = z.infer<typeof KnowledgeSymbolSummarySchema>;

export const KnowledgeModuleSummarySchema = z.object({
  runDigest: z.string(),
  entry: z.string(),
  path: z.string(),
  symbolCount: z.number().int().nonnegative(),
  exportedSymbolCount: z.number().int().nonnegative(),
});
export type KnowledgeModuleSummary = z.infer<typeof KnowledgeModuleSummarySchema>;

export const KnowledgeInsightSummarySchema = z.object({
  runDigest: z.string(),
  entry: z.string(),
  id: z.string(),
  severity: AnalyzeInsightSeveritySchema,
  lens: z.string(),
  title: z.string(),
  evidenceCount: z.number().int().nonnegative(),
});
export type KnowledgeInsightSummary = z.infer<typeof KnowledgeInsightSummarySchema>;

export const KnowledgeDocSummarySchema = z.object({
  path: z.string(),
  artifactLinks: z.number().int().nonnegative(),
  missingArtifactLinks: z.number().int().nonnegative(),
});
export type KnowledgeDocSummary = z.infer<typeof KnowledgeDocSummarySchema>;

export const KnowledgePackSchema = z.object({
  schemaVersion: z.literal(KnowledgeSchemaVersion),
  generatedAt: z.string(),
  analyzeRoot: z.string(),
  docsRoot: z.string(),
  runs: z.array(KnowledgeRunSummarySchema),
  entries: z.array(KnowledgeEntrySummarySchema),
  domains: z.array(KnowledgeDomainSummarySchema),
  symbols: z.array(KnowledgeSymbolSummarySchema),
  modules: z.array(KnowledgeModuleSummarySchema),
  insights: z.array(KnowledgeInsightSummarySchema),
  docs: z.array(KnowledgeDocSummarySchema),
});
export type KnowledgePack = z.infer<typeof KnowledgePackSchema>;

export const ArtifactIndexEntrySchema = z.object({
  name: z.string(),
  path: z.string(),
  status: z.enum(["success", "failed"]),
  workdir: z.string(),
  scope: z.string(),
  symbols: z.string(),
  repoIndex: z.string(),
  insights: z.string(),
  finalIndex: z.string(),
  finalReport: z.string(),
  symbolDirectoryPage: z.string(),
  moduleDirectoryPage: z.string(),
});
export type ArtifactIndexEntry = z.infer<typeof ArtifactIndexEntrySchema>;

export const ArtifactIndexRunSchema = z.object({
  configDigest: z.string(),
  runRoot: z.string(),
  manifest: z.string(),
  index: z.string(),
  architecture: z.string(),
  entries: z.array(ArtifactIndexEntrySchema),
});
export type ArtifactIndexRun = z.infer<typeof ArtifactIndexRunSchema>;

export const ArtifactLinkSchema = z.object({
  sourceDoc: z.string(),
  link: z.string(),
  resolved: z.string(),
  exists: z.boolean(),
});
export type ArtifactLink = z.infer<typeof ArtifactLinkSchema>;

export const ArtifactIntegritySignalsSchema = z.object({
  staleRunSignals: z.array(z.string()),
  contradictionSignals: z.array(z.string()),
});
export type ArtifactIntegritySignals = z.infer<typeof ArtifactIntegritySignalsSchema>;

export const ArtifactsIndexSchema = z.object({
  schemaVersion: z.literal(KnowledgeSchemaVersion),
  generatedAt: z.string(),
  analyzeRoot: z.string(),
  docsRoot: z.string(),
  outRoot: z.string(),
  multiRunDigest: z.string(),
  runs: z.array(ArtifactIndexRunSchema),
  discoveredEntryWorkdirs: z.array(z.string()),
  orphanEntryWorkdirs: z.array(z.string()),
  docsArtifactLinks: z.array(ArtifactLinkSchema),
  integritySignals: ArtifactIntegritySignalsSchema.optional(),
});
export type ArtifactsIndex = z.infer<typeof ArtifactsIndexSchema>;

export const KnowledgeQuestionsFileSchema = z.union([
  z.array(z.string()),
  z.object({
    questions: z.array(z.string()),
  }),
]);
export type KnowledgeQuestionsFile = z.infer<typeof KnowledgeQuestionsFileSchema>;

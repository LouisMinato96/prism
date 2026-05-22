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

export const KnowledgeQuestionClassSchema = z.enum([
  "architecture_storyline",
  "entrypoint_trace",
  "dependency_flow",
  "building_blocks",
  "reference_lookup",
  "change_guidance",
  "unknown_or_ambiguous",
]);
export type KnowledgeQuestionClass = z.infer<typeof KnowledgeQuestionClassSchema>;

export const KnowledgeQuestionClassConfidenceSchema = z.enum([
  "high",
  "medium",
  "low",
  "none",
]);
export type KnowledgeQuestionClassConfidence = z.infer<
  typeof KnowledgeQuestionClassConfidenceSchema
>;

export const KnowledgeQuestionClassScoreSchema = z.object({
  class: KnowledgeQuestionClassSchema,
  score: z.number().int(),
  matchedRules: z.array(z.string()),
});
export type KnowledgeQuestionClassScore = z.infer<
  typeof KnowledgeQuestionClassScoreSchema
>;

export const KnowledgeQuestionTopicCandidateSchema = z.object({
  label: z.string(),
  score: z.number().int().nonnegative(),
  reasons: z.array(z.string()),
});
export type KnowledgeQuestionTopicCandidate = z.infer<
  typeof KnowledgeQuestionTopicCandidateSchema
>;

export const KnowledgeQuestionClassificationSchema = z.object({
  schemaVersion: z.literal(KnowledgeSchemaVersion),
  generatedAt: z.string(),
  question: z.string(),
  questionDigest: z.string(),
  normalizedQuestion: z.string(),
  class: KnowledgeQuestionClassSchema,
  confidence: KnowledgeQuestionClassConfidenceSchema,
  score: z.number().int(),
  delta: z.number().int().nonnegative(),
  matchedRules: z.array(z.string()),
  classScores: z.array(KnowledgeQuestionClassScoreSchema),
  topicCandidates: z.array(KnowledgeQuestionTopicCandidateSchema),
});
export type KnowledgeQuestionClassification = z.infer<
  typeof KnowledgeQuestionClassificationSchema
>;

export const KnowledgeUpdateCommitSchema = z.object({
  sha: z.string(),
  shortSha: z.string(),
  authoredAt: z.string(),
  subject: z.string(),
});
export type KnowledgeUpdateCommit = z.infer<typeof KnowledgeUpdateCommitSchema>;

export const KnowledgeUpdateSliceSchema = z.object({
  index: z.number().int().nonnegative(),
  fromCommit: z.string(),
  toCommit: z.string(),
  commitCount: z.number().int().nonnegative(),
});
export type KnowledgeUpdateSlice = z.infer<typeof KnowledgeUpdateSliceSchema>;

export const KnowledgeUpdateChangeStatusSchema = z.enum([
  "added",
  "modified",
  "deleted",
  "renamed",
]);
export type KnowledgeUpdateChangeStatus = z.infer<
  typeof KnowledgeUpdateChangeStatusSchema
>;

export const KnowledgeUpdateFileChangeSchema = z.object({
  commitSha: z.string(),
  commitShortSha: z.string(),
  status: KnowledgeUpdateChangeStatusSchema,
  path: z.string(),
  previousPath: z.string().optional(),
});
export type KnowledgeUpdateFileChange = z.infer<typeof KnowledgeUpdateFileChangeSchema>;

export const KnowledgeUpdateChangeSummarySchema = z.object({
  total: z.number().int().nonnegative(),
  added: z.number().int().nonnegative(),
  modified: z.number().int().nonnegative(),
  deleted: z.number().int().nonnegative(),
  renamed: z.number().int().nonnegative(),
});
export type KnowledgeUpdateChangeSummary = z.infer<
  typeof KnowledgeUpdateChangeSummarySchema
>;

export const KnowledgeUpdateImpactReasonSchema = z.enum([
  "entry-path-exact",
  "entry-path-rename-previous",
  "entry-path-rename-next",
]);
export type KnowledgeUpdateImpactReason = z.infer<
  typeof KnowledgeUpdateImpactReasonSchema
>;

export const KnowledgeUpdateEntryImpactMatchSchema = z.object({
  commitSha: z.string(),
  commitShortSha: z.string(),
  status: KnowledgeUpdateChangeStatusSchema,
  path: z.string(),
  previousPath: z.string().optional(),
  reason: KnowledgeUpdateImpactReasonSchema,
  staleSignal: z.boolean(),
});
export type KnowledgeUpdateEntryImpactMatch = z.infer<
  typeof KnowledgeUpdateEntryImpactMatchSchema
>;

export const KnowledgeUpdateEntryImpactSchema = z.object({
  runDigest: z.string(),
  entryName: z.string(),
  entryPath: z.string(),
  workdir: z.string(),
  status: z.enum(["success", "failed"]),
  stale: z.boolean(),
  matches: z.array(KnowledgeUpdateEntryImpactMatchSchema),
});
export type KnowledgeUpdateEntryImpact = z.infer<typeof KnowledgeUpdateEntryImpactSchema>;

export const KnowledgeUpdateImpactSummarySchema = z.object({
  impactedEntries: z.number().int().nonnegative(),
  staleEntries: z.number().int().nonnegative(),
  unmappedChanges: z.number().int().nonnegative(),
});
export type KnowledgeUpdateImpactSummary = z.infer<
  typeof KnowledgeUpdateImpactSummarySchema
>;

export const KnowledgeUpdateExecutionSchema = z.object({
  targetEntries: z.number().int().nonnegative(),
  skippedStaleEntries: z.number().int().nonnegative(),
  attemptedEntries: z.number().int().nonnegative(),
  succeededEntries: z.number().int().nonnegative(),
  failedEntries: z.number().int().nonnegative(),
  rebuiltKnowledge: z.boolean(),
  failures: z.array(z.string()),
});
export type KnowledgeUpdateExecution = z.infer<typeof KnowledgeUpdateExecutionSchema>;

export const KnowledgeStateAppliedUpdateSchema = z.object({
  generatedAt: z.string(),
  from: z.string(),
  to: z.string(),
  resolvedFrom: z.string(),
  resolvedTo: z.string(),
  reportPath: z.string(),
});
export type KnowledgeStateAppliedUpdate = z.infer<
  typeof KnowledgeStateAppliedUpdateSchema
>;

export const KnowledgeStateSchema = z.object({
  schemaVersion: z.literal(KnowledgeSchemaVersion),
  updatedAt: z.string(),
  latestReportPath: z.string(),
  latestMode: z.enum(["dry-run", "apply"]),
  latestRange: z.object({
    from: z.string(),
    to: z.string(),
    resolvedFrom: z.string(),
    resolvedTo: z.string(),
  }),
  lastAppliedReportPath: z.string().optional(),
  appliedUpdates: z.array(KnowledgeStateAppliedUpdateSchema),
});
export type KnowledgeState = z.infer<typeof KnowledgeStateSchema>;

export const KnowledgeUpdateReportSchema = z.object({
  schemaVersion: z.literal(KnowledgeSchemaVersion),
  generatedAt: z.string(),
  mode: z.enum(["dry-run", "apply"]),
  repoRoot: z.string(),
  knowledgeRoot: z.string(),
  from: z.string(),
  to: z.string(),
  resolvedFrom: z.string(),
  resolvedTo: z.string(),
  batchSize: z.number().int().positive(),
  dryRun: z.boolean(),
  commitCount: z.number().int().nonnegative(),
  commits: z.array(KnowledgeUpdateCommitSchema),
  changeCount: z.number().int().nonnegative(),
  changes: z.array(KnowledgeUpdateFileChangeSchema),
  changeSummary: KnowledgeUpdateChangeSummarySchema,
  impactSummary: KnowledgeUpdateImpactSummarySchema,
  impacts: z.array(KnowledgeUpdateEntryImpactSchema),
  unmappedChanges: z.array(KnowledgeUpdateFileChangeSchema),
  execution: KnowledgeUpdateExecutionSchema.optional(),
  slices: z.array(KnowledgeUpdateSliceSchema),
  notes: z.array(z.string()),
});
export type KnowledgeUpdateReport = z.infer<typeof KnowledgeUpdateReportSchema>;

import { z } from "zod";

export const AnalyzeNodeTypeSchema = z.enum([
  "file",
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
]);
export type AnalyzeNodeType = z.infer<typeof AnalyzeNodeTypeSchema>;

export const AnalyzeEdgeTypeSchema = z.enum([
  "imports",
  "exports",
  "renders",
  "calls",
  "uses_hook",
  "uses_context",
  "provides_context",
  "reads_constant",
  "uses_type",
  "wraps",
  "selects_by",
  "routes_to",
  "fallback_routes_to",
  "uses_store",
  "reads_store",
  "writes_store",
  "store_has_state",
  "store_has_getter",
  "store_has_action",
  "invokes_store_action",
]);
export type AnalyzeEdgeType = z.infer<typeof AnalyzeEdgeTypeSchema>;

export const ScopeFileSchema = z.object({
  path: z.string(),
  depth: z.number().int().nonnegative(),
  via: z.string().optional(),
});
export type ScopeFile = z.infer<typeof ScopeFileSchema>;

export const UnresolvedImportSchema = z.object({
  from: z.string(),
  specifier: z.string(),
  line: z.number().int().positive(),
  reason: z.string(),
});
export type UnresolvedImport = z.infer<typeof UnresolvedImportSchema>;

export const AnalyzeScopeSchema = z.object({
  entry: z.string(),
  depth: z.number().int().nonnegative(),
  include: z.array(z.string()).optional(),
  exclude: z.array(z.string()).optional(),
  files: z.array(ScopeFileSchema),
  unresolvedImports: z.array(UnresolvedImportSchema),
});
export type AnalyzeScope = z.infer<typeof AnalyzeScopeSchema>;

export const AnalyzeSymbolSchema = z.object({
  id: z.string(),
  type: AnalyzeNodeTypeSchema.exclude(["file"]),
  name: z.string(),
  file: z.string(),
  line: z.number().int().positive(),
  span: z.tuple([z.number().int().positive(), z.number().int().positive()]),
  exported: z.boolean(),
});
export type AnalyzeSymbol = z.infer<typeof AnalyzeSymbolSchema>;

export const AnalyzeSymbolsSchema = z.object({
  entry: z.string(),
  files: z.array(z.string()),
  symbols: z.array(AnalyzeSymbolSchema),
});
export type AnalyzeSymbols = z.infer<typeof AnalyzeSymbolsSchema>;

export const AnalyzeRepoIndexSymbolTypeSchema = AnalyzeNodeTypeSchema.exclude(["file"]);
export type AnalyzeRepoIndexSymbolType = z.infer<typeof AnalyzeRepoIndexSymbolTypeSchema>;

export const AnalyzeRepoIndexSymbolSchema = z.object({
  id: z.string(),
  type: AnalyzeRepoIndexSymbolTypeSchema,
  name: z.string(),
  line: z.number().int().positive(),
  exported: z.boolean(),
});
export type AnalyzeRepoIndexSymbol = z.infer<typeof AnalyzeRepoIndexSymbolSchema>;

export const AnalyzeRepoIndexFileSchema = z.object({
  path: z.string(),
  symbolCount: z.number().int().nonnegative(),
  exportedSymbolCount: z.number().int().nonnegative(),
  typeCounts: z.record(AnalyzeRepoIndexSymbolTypeSchema, z.number().int().nonnegative()),
  symbols: z.array(AnalyzeRepoIndexSymbolSchema),
  exportedSymbols: z.array(z.string()),
});
export type AnalyzeRepoIndexFile = z.infer<typeof AnalyzeRepoIndexFileSchema>;

export const AnalyzeRepoIndexSchema = z.object({
  entry: z.string(),
  generatedFrom: z.object({
    scope: z.string(),
    symbols: z.string(),
  }),
  fileCount: z.number().int().nonnegative(),
  symbolCount: z.number().int().nonnegative(),
  typeCounts: z.record(AnalyzeRepoIndexSymbolTypeSchema, z.number().int().nonnegative()),
  files: z.array(AnalyzeRepoIndexFileSchema),
  entryFileSymbols: z.array(AnalyzeRepoIndexSymbolSchema),
  entryFileExportedSymbols: z.array(z.string()),
});
export type AnalyzeRepoIndex = z.infer<typeof AnalyzeRepoIndexSchema>;

export const AnalyzeNodeSchema = z.object({
  id: z.string(),
  type: AnalyzeNodeTypeSchema,
  name: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  span: z.tuple([z.number().int().positive(), z.number().int().positive()]).optional(),
  exported: z.boolean().optional(),
});
export type AnalyzeNode = z.infer<typeof AnalyzeNodeSchema>;

export const AnalyzeEdgeSchema = z.object({
  id: z.string(),
  type: AnalyzeEdgeTypeSchema,
  from: z.string(),
  to: z.string(),
  file: z.string().optional(),
  line: z.number().int().positive().optional(),
  label: z.string().optional(),
});
export type AnalyzeEdge = z.infer<typeof AnalyzeEdgeSchema>;

export const AnalyzeGraphSchema = z.object({
  entry: z.string(),
  depth: z.number().int().nonnegative(),
  nodes: z.array(AnalyzeNodeSchema),
  edges: z.array(AnalyzeEdgeSchema),
});
export type AnalyzeGraph = z.infer<typeof AnalyzeGraphSchema>;

export const AnalyzeInsightSeveritySchema = z.enum(["high", "medium", "low", "info"]);
export type AnalyzeInsightSeverity = z.infer<typeof AnalyzeInsightSeveritySchema>;

export const AnalyzeInsightEvidenceSchema = z.object({
  edge: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  node: z.string().optional(),
  diagram: z.string().optional(),
});
export type AnalyzeInsightEvidence = z.infer<typeof AnalyzeInsightEvidenceSchema>;

export const AnalyzeInsightSchema = z.object({
  id: z.string(),
  severity: AnalyzeInsightSeveritySchema,
  lens: z.string(),
  title: z.string(),
  evidence: z.array(AnalyzeInsightEvidenceSchema),
  explanation: z.string(),
  suggestion: z.string().optional(),
});
export type AnalyzeInsight = z.infer<typeof AnalyzeInsightSchema>;

export const AnalyzeInsightsSchema = z.object({
  entry: z.string(),
  generatedFrom: z.string(),
  insights: z.array(AnalyzeInsightSchema),
});
export type AnalyzeInsights = z.infer<typeof AnalyzeInsightsSchema>;

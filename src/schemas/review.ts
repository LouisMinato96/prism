import { z } from "zod";
import { ReviewerSchema } from "./routing.ts";
import { UnitKindSchema } from "./units.ts";

export const SeveritySchema = z.enum(["high", "medium", "low", "info"]);
export type Severity = z.infer<typeof SeveritySchema>;

export const AnalyzedUnitSchema = z.object({
  kind: UnitKindSchema,
  name: z.string(),
  line: z.number().int().positive(),
});
export type AnalyzedUnit = z.infer<typeof AnalyzedUnitSchema>;

export const FindingSchema = z.object({
  unit: z.string(),
  severity: SeveritySchema,
  category: z.string(),
  line: z.number().int().positive().optional(),
  issue: z.string(),
  suggestion: z.string().optional(),
});
export type Finding = z.infer<typeof FindingSchema>;

export const ReviewSchema = z.object({
  file: z.string(),
  reviewer: ReviewerSchema,
  units_analyzed: z.array(AnalyzedUnitSchema),
  findings: z.array(FindingSchema),
  iteration: z.number().int().nonnegative(),
});
export type Review = z.infer<typeof ReviewSchema>;

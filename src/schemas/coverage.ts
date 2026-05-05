import { z } from "zod";
import { ReviewerSchema } from "./routing.ts";

export const CoverageSchema = z.object({
  file: z.string(),
  reviewer: ReviewerSchema,
  total: z.number().int().nonnegative(),
  covered: z.number().int().nonnegative(),
  missing: z.array(z.string()),
  complete: z.boolean(),
  iteration: z.number().int().nonnegative(),
});
export type Coverage = z.infer<typeof CoverageSchema>;

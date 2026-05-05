import { z } from "zod";

export const ReviewerSchema = z.enum(["solid", "patterns", "react", "nextjs"]);
export type Reviewer = z.infer<typeof ReviewerSchema>;

export const FileRoutingSchema = z.object({
  file: z.string(),
  reviewers: z.array(ReviewerSchema),
  rationale: z.string().optional(),
});
export type FileRouting = z.infer<typeof FileRoutingSchema>;

export const RoutingSchema = z.object({
  routes: z.array(FileRoutingSchema),
  skipped: z.array(
    z.object({
      file: z.string(),
      reason: z.string(),
    }),
  ),
});
export type Routing = z.infer<typeof RoutingSchema>;

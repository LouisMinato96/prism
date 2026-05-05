import { z } from "zod";

export const UnitKindSchema = z.enum([
  "function",
  "component",
  "hook",
  "class",
  "method",
]);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const UnitSchema = z.object({
  kind: UnitKindSchema,
  name: z.string(),
  line: z.number().int().positive(),
  span: z.tuple([z.number().int().positive(), z.number().int().positive()]),
});
export type Unit = z.infer<typeof UnitSchema>;

export const FileUnitsSchema = z.object({
  file: z.string(),
  units: z.array(UnitSchema).nullable(),
  reason: z.string().optional(),
});
export type FileUnits = z.infer<typeof FileUnitsSchema>;

import type { SourceFile } from "ts-morph";
import type {
  AnalyzeGraph,
  AnalyzeInsight,
  AnalyzeScope,
  AnalyzeSymbols,
} from "../../../schemas/index.ts";
import type { AnalyzeDiagram } from "../diagrams.ts";
import { detect as hookDepsMismatch } from "./hook-deps-mismatch.ts";
import { detect as complexityHotspot } from "./complexity-hotspot.ts";
import { detect as typeSafetyEscape } from "./type-safety-escape.ts";
import { detect as bloater } from "./bloater.ts";
import { detect as deadCode } from "./dead-code.ts";
import { detect as awaitInLoop } from "./await-in-loop.ts";
import { detect as securityQuickWin } from "./security-quick-win.ts";
import { detect as todoDensity } from "./todo-density.ts";
import { detect as consoleLog } from "./console-log.ts";
import { detect as unusedImports } from "./unused-imports.ts";
import { detect as promiseErrorHandling } from "./promise-error-handling.ts";
import { detect as magicNumber } from "./magic-number.ts";

export interface LensInput {
  entry: string;
  scope: AnalyzeScope;
  symbols: AnalyzeSymbols;
  graph: AnalyzeGraph;
  diagrams: AnalyzeDiagram[];
  sourceFiles: Map<string, SourceFile>;
}

export interface Lens {
  id: string;
  detect(input: LensInput): AnalyzeInsight[];
}

export const LENSES: readonly Lens[] = [
  { id: "hook-deps-mismatch", detect: hookDepsMismatch },
  { id: "complexity-hotspot", detect: complexityHotspot },
  { id: "type-safety-escape", detect: typeSafetyEscape },
  { id: "bloater", detect: bloater },
  { id: "dead-code", detect: deadCode },
  { id: "await-in-loop", detect: awaitInLoop },
  { id: "security-quick-win", detect: securityQuickWin },
  { id: "todo-density", detect: todoDensity },
  { id: "console-log", detect: consoleLog },
  { id: "unused-imports", detect: unusedImports },
  { id: "promise-error-handling", detect: promiseErrorHandling },
  { id: "magic-number", detect: magicNumber },
];

export function runLenses(input: LensInput): AnalyzeInsight[] {
  return LENSES.flatMap((lens) => lens.detect(input));
}

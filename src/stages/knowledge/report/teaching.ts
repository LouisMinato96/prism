import {
  KnowledgePackSchema,
  type KnowledgePack,
  type KnowledgeInsightSummary,
} from "../../../schemas/knowledge.ts";
import { escapeTableCell } from "../../../lib/knowledge-render.ts";
import type { NormalizedQuestion } from "./sidecar-loader.ts";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";

const SEVERITY_RANK: Record<string, number> = { high: 0, medium: 1, low: 2, info: 3 };

export interface TeachingInput {
  insights: KnowledgeInsightSummary[];
  entryPathByName: Map<string, string>;
  referencedEntryPaths: Set<string>;
  filterEnabled: boolean;
}

export async function loadTeachingInput(input: {
  knowledgePackPath: string;
  questions: NormalizedQuestion[];
}): Promise<TeachingInput> {
  const pack = await loadKnowledgePack(input.knowledgePackPath);
  const entryPathByName = new Map<string, string>();
  for (const entry of pack?.entries ?? []) {
    if (!entryPathByName.has(entry.name)) {
      entryPathByName.set(entry.name, entry.path);
    }
  }
  const referenced = new Set<string>();
  let anySidecarJson = false;
  for (const question of input.questions) {
    if (question.answerJsonPresent) anySidecarJson = true;
    for (const entry of question.entries) {
      if (entry.path) referenced.add(entry.path);
    }
  }
  return {
    insights: pack?.insights ?? [],
    entryPathByName,
    referencedEntryPaths: referenced,
    filterEnabled: anySidecarJson && referenced.size > 0,
  };
}

async function loadKnowledgePack(path: string): Promise<KnowledgePack | null> {
  if (!existsSync(path)) return null;
  try {
    const raw = JSON.parse(await readFile(path, "utf8"));
    return KnowledgePackSchema.parse(raw);
  } catch {
    return null;
  }
}

interface TeachingPage {
  file: string;
  title: string;
  summary: string;
  content: string;
}

export interface TeachingTopic {
  file: string;
  title: string;
  summary: string;
  lensIds: string[];
  intro: string;
  guidance: string;
  references: Array<{ label: string; url: string }>;
}

const TOPICS: TeachingTopic[] = [
  {
    file: "10-react-standards.md",
    title: "10 React Standards",
    summary: "React hook + component rule violations grouped by entry",
    lensIds: ["hook-deps-mismatch", "react"],
    intro:
      "React relies on hooks following stable ordering and deps arrays staying in sync with referenced identifiers. These findings come from deterministic AST walks and may have false positives without full scope resolution.",
    guidance:
      "Resolve missing deps by adding the identifier OR restructuring (lift state, useRef for mutable refs, useCallback memoization). Direction violations (hook depends on component) indicate inverted layering — move shared logic into a hook or utility.",
    references: [
      {
        label: "eslint-plugin-react-hooks (recommended preset)",
        url: "https://react.dev/reference/eslint-plugin-react-hooks",
      },
      { label: "Rules of React", url: "https://react.dev/reference/rules" },
    ],
  },
  {
    file: "11-typescript-standards.md",
    title: "11 TypeScript Standards",
    summary: "Type-safety escape density per file",
    lensIds: ["type-safety-escape"],
    intro:
      "Counts uses of `any`, `as` casts, and `!` non-null assertions. These escape the type system and shift correctness checks to runtime.",
    guidance:
      "Prefer concrete types over `any`. Replace `as` with type guards or schema validation at boundaries. Replace `!` with proper null handling.",
    references: [
      {
        label: "typescript-eslint no-explicit-any",
        url: "https://typescript-eslint.io/rules/no-explicit-any/",
      },
      {
        label: "typescript-eslint no-non-null-assertion",
        url: "https://typescript-eslint.io/rules/no-non-null-assertion/",
      },
    ],
  },
  {
    file: "12-security.md",
    title: "12 Security",
    summary: "dangerouslySetInnerHTML, eval, hardcoded secret patterns",
    lensIds: ["security-quick-win"],
    intro:
      "Detects high-signal security risks: HTML injection sinks, dynamic code execution, and hardcoded credential patterns (AWS, GCP, GitHub, OpenAI).",
    guidance:
      "Sanitize HTML inputs with vetted libraries (e.g. DOMPurify). Replace eval / new Function with explicit lookups. Rotate any hardcoded secrets and load from environment or secret store.",
    references: [
      {
        label: "SonarSource TypeScript security rules",
        url: "https://rules.sonarsource.com/typescript/type/vulnerability/",
      },
      {
        label: "OWASP secrets management",
        url: "https://owasp.org/www-community/vulnerabilities/Use_of_hard-coded_password",
      },
    ],
  },
  {
    file: "13-performance.md",
    title: "13 Performance",
    summary: "await-in-loop serialization opportunities",
    lensIds: ["await-in-loop"],
    intro:
      "Awaiting inside a for/while/do/for-of loop forces serial execution. If iterations are independent, fan them out with `Promise.all` for parallel speedup.",
    guidance:
      "Replace with `await Promise.all(items.map(async (item) => ...))` when iterations do not depend on each other. Keep serial when ordering or rate-limit matters; in that case `for await of` is the intentional form.",
    references: [
      {
        label: "MDN: await operator",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await",
      },
      {
        label: "MDN: Promise.all",
        url: "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Promise/all",
      },
    ],
  },
  {
    file: "14-bloaters.md",
    title: "14 Bloater Smells",
    summary: "Long files, long functions, long parameter lists, large classes",
    lensIds: ["bloater"],
    intro:
      "Bloaters accumulate over time as code evolves. Symptoms: things get harder to read, change, and test. Thresholds are conservative — single hits are rarely critical; clusters signal real debt.",
    guidance:
      "Apply Extract Function, Extract Class, Replace Parameter with Object, Decompose Conditional. Refactor in small steps with tests around the unit.",
    references: [
      {
        label: "Refactoring.guru: Bloaters",
        url: "https://refactoring.guru/refactoring/smells/bloaters",
      },
      { label: "Fowler refactoring catalog", url: "https://refactoring.com/catalog/" },
    ],
  },
  {
    file: "15-complexity-hotspots.md",
    title: "15 Complexity Hotspots",
    summary: "Functions with high cyclomatic / cognitive complexity (ranked)",
    lensIds: ["complexity-hotspot"],
    intro:
      "Cyclomatic complexity counts independent control-flow paths. Cognitive complexity (SonarQube) adds nesting penalties — a closer proxy for human readability. High values predict more bugs and harder maintenance.",
    guidance:
      "Extract sub-functions for each logical step. Replace nested conditionals with early returns. Replace branching on type tags with polymorphism or table lookup.",
    references: [
      {
        label: "SonarQube cognitive complexity whitepaper",
        url: "https://www.sonarsource.com/resources/cognitive-complexity/",
      },
      {
        label: "Wikipedia: cyclomatic complexity",
        url: "https://en.wikipedia.org/wiki/Cyclomatic_complexity",
      },
    ],
  },
  {
    file: "16-coupling-cohesion.md",
    title: "16 Coupling & Cohesion",
    summary: "Cycles, hubs, layer leaks, dead exports across the analyzed slice",
    lensIds: ["coupling", "layering", "dead-code"],
    intro:
      "Architectural signals from the dependency graph. Cycles complicate change. Hubs concentrate risk. Layer leaks (component → service direct calls) skip designed seams. Dead exports may be removable or signal missing call sites.",
    guidance:
      "Break cycles via a lower-level boundary. Split hubs by responsibility. Route layer-crossing calls through hooks / explicit data layers. Verify dead exports are truly unused before deleting (external consumers may exist outside the analyzed scope).",
    references: [
      {
        label: "Martin: Stable Abstractions Principle",
        url: "https://en.wikipedia.org/wiki/Package_principles#Stable-Abstractions_Principle",
      },
      {
        label: "Fowler: removeDeadCode",
        url: "https://refactoring.com/catalog/removeDeadCode.html",
      },
    ],
  },
  {
    file: "17-todo-debt.md",
    title: "17 Tech Debt Markers",
    summary: "TODO / FIXME / HACK / XXX density per file",
    lensIds: ["todo-density"],
    intro:
      "Comment markers signal deferred work. Useful as a fast triage view: dense files often hide accumulated issues nobody owns.",
    guidance:
      "Convert each marker into a ticketed task, fix inline, or remove if obsolete. Track delta over time as a debt health metric.",
    references: [
      {
        label: "Steve McConnell on TODOs (Code Complete 2)",
        url: "https://stevemcconnell.com/cc2/",
      },
    ],
  },
];

export function renderTeachingPages(input: TeachingInput): TeachingPage[] {
  return TOPICS.map((topic) => ({
    file: topic.file,
    title: topic.title,
    summary: topic.summary,
    content: renderTopic(topic, input),
  }));
}

function renderTopic(topic: TeachingTopic, input: TeachingInput): string {
  const matchingInsights = filterInsights(topic.lensIds, input);
  const lines: string[] = [];
  lines.push(`# ${topic.title}`);
  lines.push("");
  lines.push(topic.intro);
  lines.push("");
  lines.push(`- lenses: ${topic.lensIds.join(", ")}`);
  lines.push(`- finding count: ${matchingInsights.length}`);
  const affected = new Set(matchingInsights.map((i) => i.entry));
  lines.push(`- entries affected: ${affected.size}`);
  const severityDist = countBySeverity(matchingInsights);
  lines.push(
    `- severity: high=${severityDist.high}, medium=${severityDist.medium}, low=${severityDist.low}, info=${severityDist.info}`,
  );
  if (input.filterEnabled) {
    lines.push(
      `- filtered to entries referenced by ranked answers (${input.referencedEntryPaths.size} entry paths)`,
    );
  } else {
    lines.push(
      "- showing all entries (no `.json` sidecars to filter against; rerun answer with `--emit-json` for focused view)",
    );
  }
  lines.push("");
  lines.push("## Findings");
  lines.push("");
  if (matchingInsights.length === 0) {
    lines.push("No findings for this topic in the analyzed slice.");
    lines.push("");
  } else {
    lines.push("| # | severity | entry | file | line | title | detail | metric | docs |");
    lines.push("| --- | --- | --- | --- | --- | --- | --- | --- | --- |");
    matchingInsights.slice(0, 50).forEach((insight, index) => {
      const metricCell = insight.metric
        ? `${insight.metric.name}=${insight.metric.value} (>${insight.metric.threshold})`
        : "-";
      const docsCell = insight.docsUrl ? `[ref](${insight.docsUrl})` : "-";
      lines.push(
        `| ${index + 1} | ${insight.severity} | ${insight.entry} | ${insight.evidenceFile ? `\`${insight.evidenceFile}\`` : "-"} | ${insight.evidenceLine ?? "-"} | ${escapeTableCell(insight.title)} | ${insight.evidenceDetail ? escapeTableCell(insight.evidenceDetail) : "-"} | ${metricCell} | ${docsCell} |`,
      );
    });
    if (matchingInsights.length > 50) {
      lines.push("");
      lines.push(
        `Showing first 50 of ${matchingInsights.length}. See \`data/lens-findings.json\` for full list.`,
      );
    }
  }
  lines.push("");
  lines.push("## How to Read These Findings");
  lines.push("");
  lines.push(topic.guidance);
  lines.push("");
  lines.push("## Canonical References");
  lines.push("");
  for (const ref of topic.references) {
    lines.push(`- [${ref.label}](${ref.url})`);
  }
  lines.push("");
  return lines.join("\n");
}

function filterInsights(
  lensIds: string[],
  input: TeachingInput,
): KnowledgeInsightSummary[] {
  const lensSet = new Set(lensIds);
  return input.insights
    .filter((insight) => lensSet.has(insight.lens))
    .filter((insight) => {
      if (!input.filterEnabled) return true;
      const path = input.entryPathByName.get(insight.entry);
      if (!path) return true;
      return input.referencedEntryPaths.has(path);
    })
    .sort(
      (a, b) =>
        (SEVERITY_RANK[a.severity] ?? 99) - (SEVERITY_RANK[b.severity] ?? 99) ||
        (b.metric?.value ?? 0) - (a.metric?.value ?? 0) ||
        (a.evidenceFile ?? "").localeCompare(b.evidenceFile ?? "") ||
        (a.evidenceLine ?? 0) - (b.evidenceLine ?? 0) ||
        a.id.localeCompare(b.id),
    );
}

function countBySeverity(insights: KnowledgeInsightSummary[]): {
  high: number;
  medium: number;
  low: number;
  info: number;
} {
  const counts = { high: 0, medium: 0, low: 0, info: 0 };
  for (const insight of insights) {
    if (insight.severity in counts) counts[insight.severity as keyof typeof counts] += 1;
  }
  return counts;
}

export function renderGlossaryPage(): string {
  const lines: string[] = [];
  lines.push("# 99 Glossary");
  lines.push("");
  lines.push(
    "Reference for every deterministic insight lens used in this report. Each lens detects specific patterns via AST or graph analysis (no LLM at detection time).",
  );
  lines.push("");
  for (const entry of GLOSSARY) {
    lines.push(`## ${entry.id}`);
    lines.push("");
    lines.push(entry.description);
    lines.push("");
    lines.push(`- severity ladder: ${entry.severityLadder}`);
    lines.push(`- typical metric: ${entry.metric}`);
    lines.push(`- canonical reference: [${entry.docsLabel}](${entry.docsUrl})`);
    lines.push("");
  }
  return lines.join("\n");
}

interface GlossaryEntry {
  id: string;
  description: string;
  severityLadder: string;
  metric: string;
  docsLabel: string;
  docsUrl: string;
}

const GLOSSARY: GlossaryEntry[] = [
  {
    id: "hook-deps-mismatch",
    description:
      "Walks useEffect/useCallback/useMemo/useLayoutEffect calls. Flags identifiers referenced inside the callback that are missing from the deps array, or in the deps array but unreferenced.",
    severityLadder: "medium when deps missing (stale closure risk), low when only extras",
    metric: "none (categorical)",
    docsLabel: "eslint-plugin-react-hooks",
    docsUrl: "https://react.dev/reference/eslint-plugin-react-hooks",
  },
  {
    id: "complexity-hotspot",
    description:
      "Computes cyclomatic complexity (branch count) and a simplified cognitive complexity (branches + nesting penalty) per function. Reports the higher of the two.",
    severityLadder: "low ≥10, medium ≥15, high ≥25",
    metric: "complexity = max(cyclomatic, cognitive)",
    docsLabel: "SonarQube cognitive complexity",
    docsUrl: "https://www.sonarsource.com/resources/cognitive-complexity/",
  },
  {
    id: "type-safety-escape",
    description:
      "Counts `any` type references, `as` cast expressions, and `!` non-null assertions per file. Higher density indicates more runtime-only correctness reliance.",
    severityLadder: "info <5, low 5–14, medium ≥15",
    metric: "escapes = any + as + non-null per file",
    docsLabel: "typescript-eslint no-explicit-any",
    docsUrl: "https://typescript-eslint.io/rules/no-explicit-any/",
  },
  {
    id: "bloater",
    description:
      "Detects classic Fowler bloater smells: long files (>500 LoC), long functions (>50 LoC), long parameter lists (>4), large classes (>20 methods).",
    severityLadder: "low single-finding, medium when sustained or class-size hit",
    metric: "file-loc / function-loc / param-count / method-count",
    docsLabel: "Refactoring.guru: Bloaters",
    docsUrl: "https://refactoring.guru/refactoring/smells/bloaters",
  },
  {
    id: "dead-code",
    description:
      "Pure graph analysis. Identifies exported symbols (excluding the entry file) that have zero incoming graph edges within the analyzed scope.",
    severityLadder: "low (may have consumers outside scope)",
    metric: "none (categorical)",
    docsLabel: "Fowler: removeDeadCode",
    docsUrl: "https://refactoring.com/catalog/removeDeadCode.html",
  },
  {
    id: "await-in-loop",
    description:
      "Detects await expressions inside for/while/do/for-of loops (excludes intentional for-await-of). Forces serial execution where parallel may be possible.",
    severityLadder: "medium",
    metric: "none (categorical)",
    docsLabel: "MDN: await",
    docsUrl:
      "https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Operators/await",
  },
  {
    id: "security-quick-win",
    description:
      "Detects high-signal security risks: dangerouslySetInnerHTML JSX attrs, eval() calls, new Function() calls, and hardcoded secrets matching AWS/GCP/GitHub/OpenAI key patterns.",
    severityLadder: "high",
    metric: "none (categorical)",
    docsLabel: "SonarSource TypeScript vulnerabilities",
    docsUrl: "https://rules.sonarsource.com/typescript/type/vulnerability/",
  },
  {
    id: "todo-density",
    description:
      "Counts TODO / FIXME / HACK / XXX comment markers per file. Reflects deferred work and accumulated tech debt.",
    severityLadder: "info <5, low 5–14, medium ≥15",
    metric: "marker-count per file",
    docsLabel: "Code Complete (McConnell)",
    docsUrl: "https://stevemcconnell.com/cc2/",
  },
  {
    id: "layering",
    description:
      "Detects `calls` edges from a component node to a service node. Signals presentation/integration mixing.",
    severityLadder: "medium",
    metric: "none (categorical)",
    docsLabel: "Clean Architecture (Uncle Bob)",
    docsUrl:
      "https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html",
  },
  {
    id: "react",
    description:
      "Detects direction violations where a hook depends on a component (reverse of expected React dependency direction).",
    severityLadder: "high",
    metric: "none (categorical)",
    docsLabel: "Rules of React",
    docsUrl: "https://react.dev/reference/rules",
  },
  {
    id: "coupling",
    description:
      "Aggregates cycles in the architecture graph plus high fan-in / fan-out symbols. Cycles indicate change-amplifying loops. Hubs concentrate risk.",
    severityLadder: "high for cycles, low fan-out, info fan-in",
    metric: "none (categorical)",
    docsLabel: "Wikipedia: Coupling",
    docsUrl: "https://en.wikipedia.org/wiki/Coupling_(computer_programming)",
  },
  {
    id: "diagrams",
    description:
      "Flags rendered diagrams that have zero edges — typically signals an extraction gap or an architectural relationship not used in this slice.",
    severityLadder: "info",
    metric: "none (categorical)",
    docsLabel: "Prism analyze docs",
    docsUrl: "https://github.com/anthropics/prism",
  },
];

const num = (key: string, fallback: number): number => {
  const v = process.env[key];
  if (v === undefined || v === "") return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) {
    throw new Error(`Invalid number for ${key}: ${v}`);
  }
  return n;
};

const str = (key: string, fallback: string): string => process.env[key] ?? fallback;

export const config = {
  concurrency: num("PRISM_CONCURRENCY", 4),
  maxClaudeRetries: num("PRISM_MAX_RETRIES", 3),
  maxCoverageIterations: num("PRISM_MAX_ITER", 2),
  claudeBin: str("PRISM_CLAUDE_BIN", "claude"),
  ghBin: str("PRISM_GH_BIN", "gh"),
  workdirRoot: str("PRISM_WORKDIR", ".tmp"),
  verbose: process.env.PRISM_VERBOSE === "1",
} as const;

export type Config = typeof config;

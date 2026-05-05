import { config } from "../config.ts";

const PREFIX = {
  info: "  ",
  step: "→ ",
  done: "✓ ",
  warn: "! ",
  error: "✗ ",
} as const;

type Level = keyof typeof PREFIX;

const write = (level: Level, msg: string, stage?: string) => {
  const stagePart = stage ? `[${stage}] ` : "";
  const line = `${PREFIX[level]}${stagePart}${msg}`;
  if (level === "error" || level === "warn") {
    console.error(line);
  } else {
    console.log(line);
  }
};

export const log = {
  info: (msg: string, stage?: string) => write("info", msg, stage),
  step: (msg: string, stage?: string) => write("step", msg, stage),
  done: (msg: string, stage?: string) => write("done", msg, stage),
  warn: (msg: string, stage?: string) => write("warn", msg, stage),
  error: (msg: string, stage?: string) => write("error", msg, stage),
  debug: (msg: string, stage?: string) => {
    if (config.verbose) write("info", msg, stage);
  },
};

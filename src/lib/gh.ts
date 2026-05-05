import { config } from "../config.ts";

async function ghRun(args: string[]): Promise<string> {
  const proc = Bun.spawn([config.ghBin, ...args], {
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(`gh ${args.join(" ")} exited ${exitCode}\nstderr:\n${stderr}`);
  }
  return stdout;
}

export interface PrFile {
  path: string;
  additions: number;
  deletions: number;
  changeType?: string;
}

export interface PrMeta {
  number: number;
  title: string;
  body: string;
  headRefName: string;
  baseRefName: string;
  files: PrFile[];
}

export async function fetchPrMeta(pr: number): Promise<PrMeta> {
  const json = await ghRun([
    "pr",
    "view",
    String(pr),
    "--json",
    "number,title,body,headRefName,baseRefName,files",
  ]);
  return JSON.parse(json) as PrMeta;
}

export async function fetchPrDiff(pr: number): Promise<string> {
  return await ghRun(["pr", "diff", String(pr)]);
}

export async function postPrComment(pr: number, body: string): Promise<string> {
  return await ghRun(["pr", "comment", String(pr), "--body", body]);
}

export async function editPrComment(pr: number, body: string): Promise<string> {
  return await ghRun(["pr", "comment", String(pr), "--body", body, "--edit-last"]);
}

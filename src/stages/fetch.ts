import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import type { Workdir } from "../lib/workdir.ts";
import { fetchPrMeta, fetchPrDiff } from "../lib/gh.ts";
import { log } from "../lib/log.ts";

export interface FetchResult {
  files: string[];
  title: string;
}

export async function runFetch(
  wd: Workdir,
  opts: { force?: boolean } = {},
): Promise<FetchResult> {
  const stage = "fetch";

  if (!opts.force && existsSync(wd.metaFile()) && existsSync(wd.diffFile())) {
    log.done("cached", stage);
    const meta = await Bun.file(wd.metaFile()).json();
    const diff = await Bun.file(wd.diffFile()).text();
    await splitDiffs(wd, diff);
    return {
      files: meta.files.map((f: { path: string }) => f.path),
      title: meta.title,
    };
  }

  log.step(`fetching PR #${wd.pr} via gh`, stage);
  const meta = await fetchPrMeta(wd.pr);
  const diff = await fetchPrDiff(wd.pr);

  await writeFile(wd.metaFile(), JSON.stringify(meta, null, 2));
  await writeFile(wd.diffFile(), diff);
  await writeFile(wd.filesList(), meta.files.map((f) => f.path).join("\n") + "\n");

  await splitDiffs(wd, diff);

  log.done(`${meta.files.length} files, ${diff.length}b diff`, stage);
  return { files: meta.files.map((f) => f.path), title: meta.title };
}

/**
 * Split a unified diff into per-file patches.
 * Each file's diff starts with `diff --git a/... b/...`.
 */
async function splitDiffs(wd: Workdir, fullDiff: string): Promise<void> {
  const chunks = fullDiff.split(/^(?=diff --git )/m);
  for (const chunk of chunks) {
    const match = chunk.match(/^diff --git a\/(.+?) b\//);
    if (!match || !match[1]) continue;
    const file = match[1];
    await writeFile(wd.diffFor(file), chunk);
  }
}

import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import { dirname, join, normalize, relative } from "node:path";

export function resolvePath(baseDir: string, path: string): string {
  if (path.startsWith("/")) return normalize(path);
  return normalize(join(baseDir, path));
}

export function toDisplayPath(baseDir: string, path: string): string {
  const rel = relative(baseDir, path).split("\\").join("/");
  if (rel === "") return ".";
  if (!rel.startsWith("../") && rel !== "..") return rel;
  return path.split("\\").join("/");
}

export function escapeTableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\s+/g, " ").trim();
}

export async function writeTextIfChanged(
  outputAbs: string,
  content: string,
  force: boolean,
): Promise<void> {
  await mkdir(dirname(outputAbs), { recursive: true });
  if (!force && existsSync(outputAbs)) {
    const current = await readFile(outputAbs, "utf8");
    if (current === content) return;
  }
  await writeFile(outputAbs, content);
}

export async function writeJsonIfChanged(
  outputAbs: string,
  value: unknown,
  force: boolean,
): Promise<void> {
  await writeTextIfChanged(outputAbs, `${JSON.stringify(value, null, 2)}\n`, force);
}

export async function contentDigest(paths: string[]): Promise<string> {
  const hash = createHash("sha1");
  for (const path of paths.slice().sort()) {
    hash.update(path);
    hash.update("\n");
    if (existsSync(path)) {
      hash.update(await readFile(path));
    }
    hash.update("\n");
  }
  return hash.digest("hex").slice(0, 12);
}

export async function maxMtimeIso(paths: string[]): Promise<string> {
  let maxMtimeMs = 0;
  for (const path of paths) {
    if (!existsSync(path)) continue;
    const mtimeMs = (await stat(path)).mtimeMs;
    if (mtimeMs > maxMtimeMs) maxMtimeMs = mtimeMs;
  }
  if (maxMtimeMs <= 0) return new Date(0).toISOString();
  return new Date(maxMtimeMs).toISOString();
}

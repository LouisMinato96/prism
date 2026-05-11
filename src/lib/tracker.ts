import { writeFile, readFile, readdir, rename } from "node:fs/promises";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { Workdir } from "./workdir.ts";

export type TaskStatus = "pending" | "in_progress" | "done" | "failed";

export interface TaskRecord {
  file: string;
  reviewer: string;
  status: TaskStatus;
  iteration: number;
  covered: number;
  total: number;
  updated_at: string;
  error?: string;
}

export class Tracker {
  constructor(private readonly wd: Workdir) {}

  async write(rec: TaskRecord): Promise<void> {
    const path = this.wd.taskStatusFor(rec.file, rec.reviewer);
    const tmp = `${path}.tmp`;
    await writeFile(tmp, JSON.stringify(rec, null, 2));
    await rename(tmp, path);
  }

  async read(file: string, reviewer: string): Promise<TaskRecord | null> {
    const path = this.wd.taskStatusFor(file, reviewer);
    if (!existsSync(path)) return null;
    return JSON.parse(await readFile(path, "utf8")) as TaskRecord;
  }

  async snapshot(): Promise<TaskRecord[]> {
    const dir = this.wd.tasks();
    if (!existsSync(dir)) return [];
    const files = await readdir(dir);
    const records = await Promise.all(
      files
        .filter((f) => f.endsWith(".status"))
        .map(async (f) => JSON.parse(await readFile(join(dir, f), "utf8")) as TaskRecord),
    );
    return records;
  }

  async pendingTasks(): Promise<TaskRecord[]> {
    const all = await this.snapshot();
    return all.filter((t) => t.status === "pending" || t.status === "in_progress");
  }

  async incompleteTasks(maxIter: number): Promise<TaskRecord[]> {
    const all = await this.snapshot();
    return all.filter((t) => t.covered < t.total && t.iteration < maxIter);
  }
}

import { join } from "node:path";
import { mkdir } from "node:fs/promises";
import { config } from "../config.ts";

export class Workdir {
  readonly root: string;

  constructor(
    public readonly pr: number,
    baseDir: string = process.cwd(),
  ) {
    this.root = join(baseDir, config.workdirRoot, `pr-${pr}`);
  }

  raw = () => join(this.root, "raw");
  diffs = () => join(this.root, "diffs");
  units = () => join(this.root, "units");
  reviews = () => join(this.root, "reviews");
  coverage = () => join(this.root, "coverage");
  tasks = () => join(this.root, "tasks");
  final = () => join(this.root, "final");

  metaFile = () => join(this.raw(), "meta.json");
  diffFile = () => join(this.raw(), "full.patch");
  filesList = () => join(this.raw(), "files.txt");
  routingFile = () => join(this.raw(), "routing.json");
  finalReport = () => join(this.final(), `pr-review-${this.pr}.md`);
  architectureReport = () => join(this.final(), `pr-architecture-${this.pr}.md`);

  unitsFor = (file: string) => join(this.units(), `${this.safe(file)}.json`);

  diffFor = (file: string) => join(this.diffs(), `${this.safe(file)}.patch`);

  reviewFor = (file: string, reviewer: string) =>
    join(this.reviews(), `${this.safe(file)}.${reviewer}.json`);

  coverageFor = (file: string, reviewer: string) =>
    join(this.coverage(), `${this.safe(file)}.${reviewer}.json`);

  taskStatusFor = (file: string, reviewer: string) =>
    join(this.tasks(), `${this.safe(file)}.${reviewer}.status`);

  private safe(file: string): string {
    return file.replace(/[\/\\]/g, "__");
  }

  async ensureAll(): Promise<void> {
    const dirs = [
      this.raw(),
      this.diffs(),
      this.units(),
      this.reviews(),
      this.coverage(),
      this.tasks(),
      this.final(),
    ];
    await Promise.all(dirs.map((d) => mkdir(d, { recursive: true })));
  }
}

import { writeFile } from "node:fs/promises";
import type { Workdir } from "../lib/workdir.ts";
import type { Coverage, FileUnits, Review } from "../schemas/index.ts";
import { log } from "../lib/log.ts";

export async function runCoverage(
  wd: Workdir,
  reviews: Review[],
  unitsByFile: Map<string, FileUnits>,
): Promise<Coverage[]> {
  const stage = "coverage";
  const results: Coverage[] = [];

  for (const review of reviews) {
    const units = unitsByFile.get(review.file);
    if (!units || units.units === null) {
      const cov: Coverage = {
        file: review.file,
        reviewer: review.reviewer,
        total: 1,
        covered: review.units_analyzed.length > 0 ? 1 : 0,
        missing: [],
        complete: review.units_analyzed.length > 0,
        iteration: review.iteration,
      };
      results.push(cov);
      await writeFile(
        wd.coverageFor(review.file, review.reviewer),
        JSON.stringify(cov, null, 2),
      );
      continue;
    }

    const expected = new Set(units.units.map((u) => u.name));
    const analyzed = new Set(review.units_analyzed.map((u) => u.name));
    const missing = [...expected].filter((n) => !analyzed.has(n));

    const cov: Coverage = {
      file: review.file,
      reviewer: review.reviewer,
      total: expected.size,
      covered: expected.size - missing.length,
      missing,
      complete: missing.length === 0,
      iteration: review.iteration,
    };
    results.push(cov);
    await writeFile(
      wd.coverageFor(review.file, review.reviewer),
      JSON.stringify(cov, null, 2),
    );
  }

  const incomplete = results.filter((c) => !c.complete);
  log.done(`${results.length - incomplete.length}/${results.length} complete`, stage);
  return results;
}

import { expect, test } from "bun:test";
import { basename } from "node:path";
import { Workdir } from "../src/lib/workdir.ts";

test("workdir keeps diff filenames under filesystem limits for very long paths", () => {
  const wd = new Workdir(4635, "/tmp/project");
  const longFile =
    "src/" +
    "components/PortfolioLinkedFactorAnalysis/containers/LinkedRootLevelContainers/LinkedFAPortfolioTableContainer/components/portfolioTableContainerHeader/hooks/useColumnExcelFormulaCopy/helpers/".repeat(
      2,
    ) +
    "useColumnExcelFormulaCopy.columnFormulaBuilder.ts";

  const diffName = basename(wd.diffFor(longFile));

  expect(diffName.length).toBeLessThanOrEqual(255);
  expect(diffName.endsWith(".patch")).toBe(true);
});

test("workdir safe naming is deterministic and disambiguates long similar paths", () => {
  const wd = new Workdir(4635, "/tmp/project");
  const sharedPrefix =
    "src/" +
    "components/PortfolioLinkedFactorAnalysis/containers/LinkedRootLevelContainers/LinkedFAPortfolioTableContainer/components/portfolioTableContainerHeader/hooks/useColumnExcelFormulaCopy/helpers/".repeat(
      2,
    );
  const fileA = `${sharedPrefix}useColumnExcelFormulaCopy.columnFormulaBuilder.ts`;
  const fileB = `${sharedPrefix}useColumnExcelFormulaCopy.columnFormulaParser.ts`;

  const nameA1 = basename(wd.diffFor(fileA));
  const nameA2 = basename(wd.diffFor(fileA));
  const nameB = basename(wd.diffFor(fileB));

  expect(nameA1).toEqual(nameA2);
  expect(nameA1).not.toEqual(nameB);
});

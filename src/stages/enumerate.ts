import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { extname } from "node:path";
import {
  Project,
  SyntaxKind,
  type SourceFile,
  type Node,
  type FunctionDeclaration,
  type VariableDeclaration,
  type ClassDeclaration,
  type MethodDeclaration,
} from "ts-morph";
import type { Workdir } from "../lib/workdir.ts";
import type { FileUnits, Unit, UnitKind } from "../schemas/index.ts";
import { log } from "../lib/log.ts";

const TS_EXTS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts"]);

export async function runEnumerate(
  wd: Workdir,
  files: string[],
  opts: { force?: boolean } = {},
): Promise<FileUnits[]> {
  const stage = "enumerate";
  const results: FileUnits[] = [];

  const project = new Project({
    compilerOptions: { allowJs: true, jsx: 1 /* Preserve */ },
    skipAddingFilesFromTsConfig: true,
    skipFileDependencyResolution: true,
  });

  for (const file of files) {
    const outPath = wd.unitsFor(file);
    if (!opts.force && existsSync(outPath)) {
      results.push(await Bun.file(outPath).json());
      continue;
    }

    const ext = extname(file);
    if (!TS_EXTS.has(ext)) {
      const result: FileUnits = {
        file,
        units: null,
        reason: `not a TS/JS file (${ext})`,
      };
      await writeFile(outPath, JSON.stringify(result, null, 2));
      results.push(result);
      continue;
    }

    let units: Unit[];
    try {
      if (!existsSync(file)) {
        const result: FileUnits = {
          file,
          units: null,
          reason: "file not found on disk (deleted in PR?)",
        };
        await writeFile(outPath, JSON.stringify(result, null, 2));
        results.push(result);
        continue;
      }
      const sourceFile = project.addSourceFileAtPath(file);
      units = extractUnits(sourceFile);
      project.removeSourceFile(sourceFile);
    } catch (err) {
      const result: FileUnits = {
        file,
        units: null,
        reason: `parse error: ${(err as Error).message}`,
      };
      await writeFile(outPath, JSON.stringify(result, null, 2));
      results.push(result);
      continue;
    }

    if (units.length === 0) {
      const result: FileUnits = {
        file,
        units: null,
        reason: "no extractable units (type-only or constant-only file)",
      };
      await writeFile(outPath, JSON.stringify(result, null, 2));
      results.push(result);
      continue;
    }

    const result: FileUnits = { file, units };
    await writeFile(outPath, JSON.stringify(result, null, 2));
    results.push(result);
  }

  const total = results.reduce((n, r) => n + (r.units?.length ?? 0), 0);
  log.done(`${results.length} files, ${total} units`, stage);
  return results;
}

function extractUnits(sf: SourceFile): Unit[] {
  const units: Unit[] = [];

  for (const fn of sf.getFunctions()) {
    const unit = classifyFunction(fn);
    if (unit) units.push(unit);
  }

  for (const stmt of sf.getVariableStatements()) {
    for (const decl of stmt.getDeclarationList().getDeclarations()) {
      const unit = classifyVariableDecl(decl);
      if (unit) units.push(unit);
    }
  }

  for (const cls of sf.getClasses()) {
    const clsUnit = classifyClass(cls);
    if (clsUnit) units.push(clsUnit);

    for (const method of cls.getMethods()) {
      const methodUnit = classifyMethod(method, cls);
      if (methodUnit) units.push(methodUnit);
    }
  }

  return units;
}

function span(node: Node): [number, number] {
  const start = node.getStartLineNumber();
  const end = node.getEndLineNumber();
  return [start, end];
}

function classifyFunction(fn: FunctionDeclaration): Unit | null {
  const name = fn.getName();
  if (!name) return null;

  const kind = inferKind(name, fn);
  return {
    kind,
    name,
    line: fn.getStartLineNumber(),
    span: span(fn),
  };
}

function classifyVariableDecl(decl: VariableDeclaration): Unit | null {
  const name = decl.getName();
  const init = decl.getInitializer();
  if (!init) return null;

  const isArrow = init.getKind() === SyntaxKind.ArrowFunction;
  const isFnExpr = init.getKind() === SyntaxKind.FunctionExpression;
  if (!isArrow && !isFnExpr) return null;

  const kind = inferKind(name, init);
  return {
    kind,
    name,
    line: decl.getStartLineNumber(),
    span: span(decl),
  };
}

function classifyClass(cls: ClassDeclaration): Unit | null {
  const name = cls.getName();
  if (!name) return null;
  return {
    kind: "class",
    name,
    line: cls.getStartLineNumber(),
    span: span(cls),
  };
}

function classifyMethod(method: MethodDeclaration, cls: ClassDeclaration): Unit | null {
  const methodName = method.getName();
  const clsName = cls.getName() ?? "<anon>";
  return {
    kind: "method",
    name: `${clsName}.${methodName}`,
    line: method.getStartLineNumber(),
    span: span(method),
  };
}

function inferKind(name: string, body: Node): UnitKind {
  if (name.startsWith("use") && name[3] === name[3]?.toUpperCase()) {
    return "hook";
  }

  if (/^[A-Z]/.test(name) && containsJsx(body)) {
    return "component";
  }

  return "function";
}

function containsJsx(node: Node): boolean {
  if (
    node.getKind() === SyntaxKind.JsxElement ||
    node.getKind() === SyntaxKind.JsxSelfClosingElement ||
    node.getKind() === SyntaxKind.JsxFragment
  ) {
    return true;
  }
  for (const child of node.getChildren()) {
    if (containsJsx(child)) return true;
  }
  return false;
}

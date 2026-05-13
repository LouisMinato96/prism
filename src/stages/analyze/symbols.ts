import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  Node,
  SyntaxKind,
  type ClassDeclaration,
  type FunctionDeclaration,
  type MethodDeclaration,
  type SourceFile,
  type VariableDeclaration,
} from "ts-morph";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeSymbolsSchema,
  type AnalyzeNodeType,
  type AnalyzeScope,
  type AnalyzeSymbol,
  type AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import { createAnalyzeProject, symbolId, toAbsolutePath } from "./utils.ts";

export interface SymbolDeclaration {
  symbol: AnalyzeSymbol;
  node: Node;
}

export async function runAnalyzeSymbols(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  opts: { force?: boolean } = {},
): Promise<AnalyzeSymbols> {
  const stage = "analyze:symbols";

  if (!opts.force && existsSync(wd.symbolsFile())) {
    log.done("cached", stage);
    return AnalyzeSymbolsSchema.parse(await Bun.file(wd.symbolsFile()).json());
  }

  log.step(`extracting symbols from ${scope.files.length} files`, stage);

  const project = createAnalyzeProject();
  const symbols: AnalyzeSymbol[] = [];

  for (const file of scope.files) {
    const sourceFile = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
    symbols.push(
      ...extractSymbolDeclarations(sourceFile, file.path).map((decl) => decl.symbol),
    );
    project.removeSourceFile(sourceFile);
  }

  const result: AnalyzeSymbols = {
    entry: scope.entry,
    files: scope.files.map((file) => file.path),
    symbols,
  };

  await writeFile(
    wd.astManifestFile(),
    JSON.stringify(
      {
        parser: "ts-morph",
        files: result.files,
      },
      null,
      2,
    ),
  );
  await writeFile(wd.symbolsFile(), JSON.stringify(result, null, 2));
  log.done(`${symbols.length} symbols`, stage);
  return result;
}

export function extractSymbolDeclarations(
  sourceFile: SourceFile,
  file: string,
): SymbolDeclaration[] {
  const declarations: SymbolDeclaration[] = [];

  for (const fn of sourceFile.getFunctions()) {
    const symbol = symbolForFunction(fn, file);
    if (symbol) declarations.push({ symbol, node: fn });
  }

  for (const statement of sourceFile.getVariableStatements()) {
    const exported = statement.isExported();
    for (const decl of statement.getDeclarationList().getDeclarations()) {
      const symbol = symbolForVariable(decl, file, exported);
      if (symbol) declarations.push({ symbol, node: decl });
    }
  }

  for (const assignment of sourceFile.getExportAssignments()) {
    if (assignment.isExportEquals()) continue;
    const expression = assignment.getExpression();
    const symbol = symbolForDefaultExportExpression(expression, file, assignment);
    if (symbol) declarations.push({ symbol, node: assignment });
  }

  for (const cls of sourceFile.getClasses()) {
    const symbol = symbolForClass(cls, file);
    if (symbol) declarations.push({ symbol, node: cls });

    for (const method of cls.getMethods()) {
      const methodSymbol = symbolForMethod(method, cls, file);
      declarations.push({ symbol: methodSymbol, node: method });
    }
  }

  for (const alias of sourceFile.getTypeAliases()) {
    declarations.push({
      symbol: buildSymbol("type", alias.getName(), file, alias, alias.isExported()),
      node: alias,
    });
  }

  for (const iface of sourceFile.getInterfaces()) {
    declarations.push({
      symbol: buildSymbol("type", iface.getName(), file, iface, iface.isExported()),
      node: iface,
    });
  }

  return declarations.sort(
    (a, b) => a.symbol.line - b.symbol.line || a.symbol.name.localeCompare(b.symbol.name),
  );
}

function symbolForFunction(fn: FunctionDeclaration, file: string): AnalyzeSymbol | null {
  const name = fn.getName();
  if (!name) return null;
  return buildSymbol(inferCallableType(name, fn, file), name, file, fn, fn.isExported());
}

function symbolForVariable(
  decl: VariableDeclaration,
  file: string,
  exported: boolean,
): AnalyzeSymbol | null {
  const name = decl.getName();
  const init = decl.getInitializer();

  if (!init) return buildSymbol("constant", name, file, decl, exported);

  if (isCreateContextCall(init, name)) {
    return buildSymbol("context", name, file, decl, exported);
  }

  if (isStoreDeclaration(name, init, file)) {
    return buildSymbol("store", name, file, decl, exported);
  }

  const isArrow = init.getKind() === SyntaxKind.ArrowFunction;
  const isFnExpr = init.getKind() === SyntaxKind.FunctionExpression;
  if (isArrow || isFnExpr) {
    return buildSymbol(inferCallableType(name, init, file), name, file, decl, exported);
  }

  if (/^[A-Z]/.test(name) && isComponentWrapperCall(init)) {
    return buildSymbol("component", name, file, decl, exported);
  }

  return buildSymbol("constant", name, file, decl, exported);
}

function symbolForDefaultExportExpression(
  expression: Node,
  file: string,
  exportNode: Node,
): AnalyzeSymbol | null {
  const name = componentNameFromDefaultExportExpression(expression);
  if (!name) return null;
  return buildSymbol(
    inferCallableType(name, expression, file),
    name,
    file,
    exportNode,
    true,
  );
}

function componentNameFromDefaultExportExpression(expression: Node): string | null {
  const unwrapped = unwrapExpression(expression);
  if (!Node.isCallExpression(unwrapped) || !isComponentWrapperCall(unwrapped)) {
    return null;
  }

  for (const arg of unwrapped.getArguments()) {
    const candidate = unwrapExpression(arg);
    if (Node.isFunctionExpression(candidate)) {
      const name = candidate.getName();
      if (name && containsJsx(candidate)) return name;
    }
  }

  return null;
}

function symbolForClass(cls: ClassDeclaration, file: string): AnalyzeSymbol | null {
  const name = cls.getName();
  if (!name) return null;
  return buildSymbol("class", name, file, cls, cls.isExported());
}

function symbolForMethod(
  method: MethodDeclaration,
  cls: ClassDeclaration,
  file: string,
): AnalyzeSymbol {
  const className = cls.getName() ?? "<anonymous>";
  const methodName = `${className}.${method.getName()}`;
  return buildSymbol("method", methodName, file, method, false);
}

function buildSymbol(
  type: Exclude<AnalyzeNodeType, "file">,
  name: string,
  file: string,
  node: Node,
  exported: boolean,
): AnalyzeSymbol {
  const line = node.getStartLineNumber();
  return {
    id: symbolId(type, file, name, line),
    type,
    name,
    file,
    line,
    span: [line, node.getEndLineNumber()],
    exported,
  };
}

function inferCallableType(
  name: string,
  body: Node,
  file: string,
): Exclude<AnalyzeNodeType, "file"> {
  if (name.startsWith("use") && name[3] === name[3]?.toUpperCase()) {
    return "hook";
  }

  if (/^[A-Z]/.test(name) && containsJsx(body)) {
    return "component";
  }

  if (isServiceLike(name, body, file)) {
    return "service";
  }

  return "function";
}

function isCreateContextCall(init: Node, name: string): boolean {
  if (name.endsWith("Context")) return true;
  if (!Node.isCallExpression(init)) return false;
  const expression = init.getExpression().getText();
  return expression === "createContext" || expression.endsWith(".createContext");
}

function isStoreDeclaration(name: string, init: Node, file: string): boolean {
  if (!isStoreLikeName(name, file)) return false;
  if (!Node.isCallExpression(init)) return false;
  return containsCall(init, new Set(["create"]));
}

function isStoreLikeName(name: string, file: string): boolean {
  return /^use[A-Z].*Store$/.test(name) || /(^|\/)(zustandStore|stores?)\//.test(file);
}

function isComponentWrapperCall(init: Node): boolean {
  if (!Node.isCallExpression(init)) return false;
  const expression = init.getExpression().getText();
  return ["memo", "React.memo", "forwardRef", "React.forwardRef", "dynamic"].includes(
    expression,
  );
}

function isServiceLike(name: string, body: Node, file: string): boolean {
  if (/(^|\/)(api|services?|clients?|repositories?)\//.test(file)) return true;
  if (/^(fetch|load|save|create|update|delete|remove|list|read|write)/.test(name)) {
    return true;
  }
  return containsCall(body, new Set(["fetch", "axios"]));
}

function containsCall(node: Node, names: Set<string>): boolean {
  if (Node.isCallExpression(node)) {
    const expression = node.getExpression().getText();
    const name = expression.split(".").at(-1);
    if (name && names.has(name)) return true;
  }
  return node.getChildren().some((child) => containsCall(child, names));
}

function unwrapExpression(expression: Node): Node {
  if (
    Node.isParenthesizedExpression(expression) ||
    Node.isAsExpression(expression) ||
    Node.isTypeAssertion(expression) ||
    Node.isNonNullExpression(expression)
  ) {
    return unwrapExpression(expression.getExpression());
  }

  return expression;
}

function containsJsx(node: Node): boolean {
  if (
    node.getKind() === SyntaxKind.JsxElement ||
    node.getKind() === SyntaxKind.JsxSelfClosingElement ||
    node.getKind() === SyntaxKind.JsxFragment
  ) {
    return true;
  }
  return node.getChildren().some((child) => containsJsx(child));
}

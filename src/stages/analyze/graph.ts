import { writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import {
  Node,
  SyntaxKind,
  type CallExpression,
  type ObjectLiteralExpression,
  type SourceFile,
} from "ts-morph";
import type { AnalyzeWorkdir } from "../../lib/analyze-workdir.ts";
import {
  AnalyzeGraphSchema,
  type AnalyzeEdge,
  type AnalyzeGraph,
  type AnalyzeNode,
  type AnalyzeScope,
  type AnalyzeSymbol,
  type AnalyzeSymbols,
} from "../../schemas/index.ts";
import { log } from "../../lib/log.ts";
import {
  createAnalyzeProject,
  edgeId,
  fileNodeId,
  resolveImport,
  toAbsolutePath,
} from "./utils.ts";
import { extractSymbolDeclarations } from "./symbols.ts";

interface ImportBinding {
  localName: string;
  specifier: string;
  resolved?: string;
}

interface GraphTarget {
  node: AnalyzeNode;
  external: boolean;
}

type RouteTarget = GraphTarget;
type StoreTarget = GraphTarget;

interface RouteMapEntry {
  key: string;
  target: RouteTarget;
  line: number;
}

interface ComponentRouteMap {
  symbol: AnalyzeSymbol;
  entries: RouteMapEntry[];
}

interface PendingRouteEdge {
  edge: Omit<AnalyzeEdge, "id">;
  target: RouteTarget;
}

interface StoreSurfaceMember {
  node: AnalyzeNode;
  kind: "state" | "getter" | "action";
}

interface StoreSurface {
  symbol: AnalyzeSymbol;
  members: StoreSurfaceMember[];
}

export async function runAnalyzeGraph(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  symbols: AnalyzeSymbols,
  opts: { force?: boolean } = {},
): Promise<AnalyzeGraph> {
  const stage = "analyze:graph";

  if (!opts.force && existsSync(wd.graphFile())) {
    log.done("cached", stage);
    return AnalyzeGraphSchema.parse(await Bun.file(wd.graphFile()).json());
  }

  log.step(`building graph from ${symbols.symbols.length} symbols`, stage);

  const edges = new Map<string, AnalyzeEdge>();
  const extraNodes = new Map<string, AnalyzeNode>();
  const symbolsByFileAndName = buildFileNameIndex(symbols.symbols);
  const symbolsByName = buildNameIndex(symbols.symbols);
  const routeMaps = buildComponentRouteMaps(
    wd,
    scope,
    symbolsByFileAndName,
    symbolsByName,
  );
  const storeSurfaces = buildStoreSurfaces(wd, scope, symbolsByFileAndName);
  const project = createAnalyzeProject();

  for (const file of scope.files) {
    const fileId = fileNodeId(file.path);
    const sourceFile = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
    const importBindings = buildImportBindings(sourceFile, wd.baseDir, file.path);

    for (const importDecl of sourceFile.getImportDeclarations()) {
      const specifier = importDecl.getModuleSpecifierValue();
      const resolved = resolveImport(wd.baseDir, file.path, specifier);
      if (!resolved) continue;
      addEdge(edges, {
        type: "imports",
        from: fileId,
        to: fileNodeId(resolved),
        file: file.path,
        line: importDecl.getStartLineNumber(),
        label: specifier,
      });
    }

    const declarations = extractSymbolDeclarations(sourceFile, file.path);
    for (const { symbol, node } of declarations) {
      let selectedRouteMap = false;
      const pendingFallbackEdges: PendingRouteEdge[] = [];

      if (symbol.exported) {
        addEdge(edges, {
          type: "exports",
          from: fileId,
          to: symbol.id,
          file: file.path,
          line: symbol.line,
        });
      }

      addStoreSurfaceEdges(edges, extraNodes, symbol, storeSurfaces.get(symbol.id));

      node.forEachDescendant((child) => {
        addJsxEdges(edges, symbol, child, symbolsByFileAndName, symbolsByName);
        addJsxWrapperEdges(
          edges,
          extraNodes,
          symbol,
          child,
          symbolsByFileAndName,
          symbolsByName,
          importBindings,
        );
        addCallEdges(edges, symbol, child, symbolsByFileAndName, symbolsByName);
        addStoreAccessEdges(
          edges,
          extraNodes,
          symbol,
          child,
          symbolsByFileAndName,
          symbolsByName,
          importBindings,
          storeSurfaces,
        );
        const selectionCount = addRouteMapSelectionEdges(
          edges,
          extraNodes,
          symbol,
          child,
          symbolsByFileAndName,
          symbolsByName,
          routeMaps,
        );
        selectedRouteMap = selectedRouteMap || selectionCount > 0;
        collectFallbackRouteEdges(
          pendingFallbackEdges,
          symbol,
          child,
          symbolsByFileAndName,
          symbolsByName,
          importBindings,
        );
        return undefined;
      });

      if (selectedRouteMap) {
        for (const pending of pendingFallbackEdges) {
          ensureExternalNode(extraNodes, pending.target);
          addEdge(edges, pending.edge);
        }
      }
    }

    project.removeSourceFile(sourceFile);
  }

  const graph: AnalyzeGraph = {
    entry: scope.entry,
    depth: scope.depth,
    nodes: [
      ...scope.files.map((file) => ({
        id: fileNodeId(file.path),
        type: "file" as const,
        name: file.path,
        file: file.path,
      })),
      ...symbols.symbols.map((symbol) => ({
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        file: symbol.file,
        line: symbol.line,
        span: symbol.span,
        exported: symbol.exported,
      })),
      ...[...extraNodes.values()].sort((a, b) => a.id.localeCompare(b.id)),
    ],
    edges: [...edges.values()].sort(
      (a, b) => a.file?.localeCompare(b.file ?? "") || (a.line ?? 0) - (b.line ?? 0),
    ),
  };

  await writeFile(wd.referencesFile(), JSON.stringify({ edges: graph.edges }, null, 2));
  await writeFile(wd.graphFile(), JSON.stringify(graph, null, 2));
  log.done(`${graph.nodes.length} nodes, ${graph.edges.length} edges`, stage);
  return graph;
}

function buildFileNameIndex(
  symbols: AnalyzeSymbol[],
): Map<string, Map<string, AnalyzeSymbol>> {
  const index = new Map<string, Map<string, AnalyzeSymbol>>();
  for (const symbol of symbols) {
    const fileSymbols = index.get(symbol.file) ?? new Map<string, AnalyzeSymbol>();
    if (!fileSymbols.has(symbol.name)) fileSymbols.set(symbol.name, symbol);
    index.set(symbol.file, fileSymbols);
  }
  return index;
}

function buildNameIndex(symbols: AnalyzeSymbol[]): Map<string, AnalyzeSymbol> {
  const index = new Map<string, AnalyzeSymbol>();
  for (const symbol of symbols) {
    if (!index.has(symbol.name)) index.set(symbol.name, symbol);
  }
  return index;
}

function buildComponentRouteMaps(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
): Map<string, ComponentRouteMap> {
  const routeMaps = new Map<string, ComponentRouteMap>();
  const project = createAnalyzeProject();

  for (const file of scope.files) {
    const sourceFile = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
    const importBindings = buildImportBindings(sourceFile, wd.baseDir, file.path);

    for (const statement of sourceFile.getVariableStatements()) {
      for (const declaration of statement.getDeclarationList().getDeclarations()) {
        const symbol = byFileAndName.get(file.path)?.get(declaration.getName());
        const initializer = declaration.getInitializer();
        if (!symbol || !initializer || !Node.isObjectLiteralExpression(initializer)) {
          continue;
        }

        const entries = initializer
          .getProperties()
          .flatMap((property): RouteMapEntry[] => {
            if (Node.isPropertyAssignment(property)) {
              const targetNames = componentNamesFromExpression(
                property.getInitializerOrThrow(),
              );
              return targetNames
                .map((targetName) =>
                  resolveComponentTarget(
                    targetName,
                    file.path,
                    byFileAndName,
                    byName,
                    importBindings,
                  ),
                )
                .filter((target): target is RouteTarget => target !== null)
                .map((target) => ({
                  key: propertyKeyText(property.getNameNode()),
                  target,
                  line: property.getStartLineNumber(),
                }));
            }

            if (Node.isShorthandPropertyAssignment(property)) {
              const target = resolveComponentTarget(
                property.getName(),
                file.path,
                byFileAndName,
                byName,
                importBindings,
              );
              return target
                ? [
                    {
                      key: property.getName(),
                      target,
                      line: property.getStartLineNumber(),
                    },
                  ]
                : [];
            }

            return [];
          });

        if (entries.length > 0) {
          routeMaps.set(symbol.id, { symbol, entries });
        }
      }
    }

    project.removeSourceFile(sourceFile);
  }

  return routeMaps;
}

function buildStoreSurfaces(
  wd: AnalyzeWorkdir,
  scope: AnalyzeScope,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
): Map<string, StoreSurface> {
  const surfaces = new Map<string, StoreSurface>();
  const project = createAnalyzeProject();

  for (const file of scope.files) {
    const sourceFile = project.addSourceFileAtPath(toAbsolutePath(wd.baseDir, file.path));
    const declarations = extractSymbolDeclarations(sourceFile, file.path);

    for (const { symbol, node } of declarations) {
      if (symbol.type !== "store") continue;

      const storeBody = storeObjectLiteral(node);
      if (!storeBody) continue;

      const members = storeBody
        .getProperties()
        .flatMap((property): StoreSurfaceMember[] => {
          if (Node.isSpreadAssignment(property)) {
            return expandStoreStateSpread(
              sourceFile,
              file.path,
              property.getExpression(),
              symbol,
              byFileAndName,
            );
          }

          if (!Node.isPropertyAssignment(property)) return [];

          const name = propertyKeyText(property.getNameNode());
          const initializer = property.getInitializerOrThrow();
          const kind = classifyStoreProperty(name, initializer);
          return [storeSurfaceMember(symbol, kind, name, property.getStartLineNumber())];
        });

      surfaces.set(symbol.id, { symbol, members });
    }

    project.removeSourceFile(sourceFile);
  }

  return surfaces;
}

function storeObjectLiteral(node: Node): ObjectLiteralExpression | null {
  if (!Node.isVariableDeclaration(node)) return null;
  const initializer = node.getInitializer();
  if (!initializer) return null;

  let found: ObjectLiteralExpression | null = null;
  initializer.forEachDescendant((child) => {
    if (found) return false;
    if (Node.isObjectLiteralExpression(child)) {
      found = child;
      return false;
    }
    return undefined;
  });

  return found;
}

function expandStoreStateSpread(
  sourceFile: SourceFile,
  file: string,
  expression: Node,
  store: AnalyzeSymbol,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
): StoreSurfaceMember[] {
  const name = expressionBaseName(expression);
  const sourceSymbol = name ? byFileAndName.get(file)?.get(name) : undefined;
  const sourceNode = sourceSymbol
    ? extractSymbolDeclarations(sourceFile, file).find(
        (declaration) => declaration.symbol.id === sourceSymbol.id,
      )?.node
    : undefined;
  const objectLiteral = sourceNode ? returnedObjectLiteral(sourceNode) : null;

  if (!objectLiteral) {
    return [
      storeSurfaceMember(
        store,
        "state",
        `...${shortLabel(expression.getText())}`,
        expression.getStartLineNumber(),
      ),
    ];
  }

  return objectLiteral.getProperties().flatMap((property): StoreSurfaceMember[] => {
    if (
      !Node.isPropertyAssignment(property) &&
      !Node.isShorthandPropertyAssignment(property)
    ) {
      return [];
    }
    const name = Node.isPropertyAssignment(property)
      ? propertyKeyText(property.getNameNode())
      : property.getName();
    return [storeSurfaceMember(store, "state", name, property.getStartLineNumber())];
  });
}

function returnedObjectLiteral(node: Node): ObjectLiteralExpression | null {
  let found: ObjectLiteralExpression | null = null;

  if (Node.isVariableDeclaration(node)) {
    const initializer = node.getInitializer();
    if (initializer) return returnedObjectLiteral(initializer);
  }

  if (Node.isArrowFunction(node)) {
    const body = unwrapExpression(node.getBody());
    if (Node.isObjectLiteralExpression(body)) return body;
  }

  node.forEachDescendant((child) => {
    if (found) return false;
    if (Node.isReturnStatement(child)) {
      const expression = child.getExpression();
      if (expression && Node.isObjectLiteralExpression(expression)) {
        found = expression;
        return false;
      }
    }
    return undefined;
  });

  return found;
}

function storeSurfaceMember(
  store: AnalyzeSymbol,
  kind: StoreSurfaceMember["kind"],
  name: string,
  line: number,
): StoreSurfaceMember {
  const type =
    kind === "state"
      ? "store_state"
      : kind === "getter"
        ? "store_getter"
        : "store_action";
  return {
    kind,
    node: {
      id: `${type}:${store.file}:${store.name}.${name}:${line}`,
      type,
      name,
      file: store.file,
      line,
      span: [line, line],
      exported: false,
    },
  };
}

function classifyStoreProperty(
  name: string,
  initializer: Node,
): StoreSurfaceMember["kind"] {
  if (!isFunctionLikeExpression(initializer)) return "state";
  if (containsStoreSetCall(initializer) || isMutatingStoreMethod(name)) return "action";
  if (/^(get|is|has|can|should)/.test(name)) return "getter";
  return "action";
}

function isFunctionLikeExpression(node: Node): boolean {
  return (
    Node.isArrowFunction(node) ||
    Node.isFunctionExpression(node) ||
    Node.isMethodDeclaration(node)
  );
}

function containsStoreSetCall(node: Node): boolean {
  if (Node.isCallExpression(node)) {
    const name = callExpressionName(node.getExpression());
    if (name === "set") return true;
  }
  return node.getChildren().some((child) => containsStoreSetCall(child));
}

function addStoreSurfaceEdges(
  edges: Map<string, AnalyzeEdge>,
  extraNodes: Map<string, AnalyzeNode>,
  store: AnalyzeSymbol,
  surface: StoreSurface | undefined,
): void {
  if (!surface) return;

  for (const member of surface.members) {
    extraNodes.set(member.node.id, member.node);
    const type =
      member.kind === "state"
        ? "store_has_state"
        : member.kind === "getter"
          ? "store_has_getter"
          : "store_has_action";
    addEdge(edges, {
      type,
      from: store.id,
      to: member.node.id,
      file: store.file,
      line: member.node.line,
      label: member.kind,
    });
  }
}

function addJsxEdges(
  edges: Map<string, AnalyzeEdge>,
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
): void {
  const tag = jsxTagName(node);
  if (!tag) return;

  if (tag.endsWith(".Provider")) {
    const contextName = tag.slice(0, -".Provider".length);
    const context = findTarget(contextName, source.file, byFileAndName, byName);
    if (context?.type === "context") {
      addEdge(edges, {
        type: "provides_context",
        from: source.id,
        to: context.id,
        file: source.file,
        line: node.getStartLineNumber(),
        label: tag,
      });
    }
    return;
  }

  if (!/^[A-Z]/.test(tag)) return;
  const target = findTarget(tag, source.file, byFileAndName, byName);
  if (target?.type !== "component" || target.id === source.id) return;

  addEdge(edges, {
    type: "renders",
    from: source.id,
    to: target.id,
    file: source.file,
    line: node.getStartLineNumber(),
    label: tag,
  });
}

function addJsxWrapperEdges(
  edges: Map<string, AnalyzeEdge>,
  extraNodes: Map<string, AnalyzeNode>,
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): void {
  if (source.type !== "component") return;

  const parentTag = jsxTagName(node);
  if (!parentTag) {
    if (Node.isJsxFragment(node) && !hasJsxAncestor(node)) {
      for (const child of directJsxChildTargets(
        node,
        source.file,
        byFileAndName,
        byName,
        importBindings,
      )) {
        ensureExternalNode(extraNodes, child);
        addEdge(edges, {
          type: "wraps",
          from: source.id,
          to: child.node.id,
          file: source.file,
          line: node.getStartLineNumber(),
          label: "fragment",
        });
      }
    }
    return;
  }

  const parent = resolveComponentTarget(
    parentTag,
    source.file,
    byFileAndName,
    byName,
    importBindings,
  );
  if (!parent) return;
  ensureExternalNode(extraNodes, parent);

  if (!hasJsxAncestor(node)) {
    addEdge(edges, {
      type: "wraps",
      from: source.id,
      to: parent.node.id,
      file: source.file,
      line: node.getStartLineNumber(),
      label: "root",
    });
  }

  for (const child of directJsxChildTargets(
    node,
    source.file,
    byFileAndName,
    byName,
    importBindings,
  )) {
    if (child.node.id === parent.node.id) continue;
    ensureExternalNode(extraNodes, child);
    addEdge(edges, {
      type: "wraps",
      from: parent.node.id,
      to: child.node.id,
      file: source.file,
      line: node.getStartLineNumber(),
      label: parentTag,
    });
  }
}

function addCallEdges(
  edges: Map<string, AnalyzeEdge>,
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
): void {
  if (!Node.isCallExpression(node)) return;

  const callName = callExpressionName(node.getExpression());
  if (!callName) return;

  if (callName === "useContext") {
    const firstArg = node.getArguments()[0]?.getText();
    if (firstArg) {
      const context = findTarget(firstArg, source.file, byFileAndName, byName);
      if (context?.type === "context") {
        addEdge(edges, {
          type: "uses_context",
          from: source.id,
          to: context.id,
          file: source.file,
          line: node.getStartLineNumber(),
          label: firstArg,
        });
      }
    }
    return;
  }

  const target = findTarget(callName, source.file, byFileAndName, byName);
  if (!target || target.id === source.id) return;
  if (target.type === "store") return;

  addEdge(edges, {
    type: target.type === "hook" ? "uses_hook" : "calls",
    from: source.id,
    to: target.id,
    file: source.file,
    line: node.getStartLineNumber(),
    label: callName,
  });
}

function addStoreAccessEdges(
  edges: Map<string, AnalyzeEdge>,
  extraNodes: Map<string, AnalyzeNode>,
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
  storeSurfaces: Map<string, StoreSurface>,
): void {
  if (!Node.isCallExpression(node)) return;

  addZustandWrapperStoreEdges(
    edges,
    extraNodes,
    source,
    node,
    byFileAndName,
    byName,
    importBindings,
    storeSurfaces,
  );

  const path = propertyAccessPath(node.getExpression());
  const storeName = path[0];
  if (storeName && path.length > 1) {
    const store = resolveStoreTarget(
      storeName,
      source.file,
      byFileAndName,
      byName,
      importBindings,
    );
    if (store) {
      ensureExternalNode(extraNodes, store);
      const access = storeAccessFromPath(path, node);
      addEdge(edges, {
        type: access.type,
        from: source.id,
        to: store.node.id,
        file: source.file,
        line: node.getStartLineNumber(),
        label: access.label,
      });
      addStoreActionInvocationEdges(
        edges,
        source,
        store,
        access.label,
        node.getStartLineNumber(),
        storeSurfaces,
      );
    }
    return;
  }

  const callName = callExpressionName(node.getExpression());
  if (!callName) return;

  const store = resolveStoreTarget(
    callName,
    source.file,
    byFileAndName,
    byName,
    importBindings,
  );
  if (!store) return;

  ensureExternalNode(extraNodes, store);
  addEdge(edges, {
    type: "uses_store",
    from: source.id,
    to: store.node.id,
    file: source.file,
    line: node.getStartLineNumber(),
    label: storeSelectorLabel(node.getArguments()[0]),
  });
  addStoreActionInvocationEdges(
    edges,
    source,
    store,
    storeSelectorLabel(node.getArguments()[0]),
    node.getStartLineNumber(),
    storeSurfaces,
  );
}

function addZustandWrapperStoreEdges(
  edges: Map<string, AnalyzeEdge>,
  extraNodes: Map<string, AnalyzeNode>,
  source: AnalyzeSymbol,
  node: CallExpression,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
  storeSurfaces: Map<string, StoreSurface>,
): void {
  const callName = callExpressionName(node.getExpression());
  if (!callName || !/(zustand|store)/i.test(callName)) return;

  for (const arg of node.getArguments()) {
    if (!Node.isObjectLiteralExpression(arg)) continue;

    const storeProp = objectLiteralProperty(arg, "store");
    if (!storeProp || !Node.isPropertyAssignment(storeProp)) continue;

    const storeName = expressionBaseName(storeProp.getInitializerOrThrow());
    if (!storeName) continue;

    const store = resolveStoreTarget(
      storeName,
      source.file,
      byFileAndName,
      byName,
      importBindings,
    );
    if (!store) continue;

    ensureExternalNode(extraNodes, store);
    const label = `${callName}: ${storeVariablesLabel(arg)}`;
    addEdge(edges, {
      type: "uses_store",
      from: source.id,
      to: store.node.id,
      file: source.file,
      line: node.getStartLineNumber(),
      label,
    });
    addStoreActionInvocationEdges(
      edges,
      source,
      store,
      label,
      node.getStartLineNumber(),
      storeSurfaces,
    );
  }
}

function addStoreActionInvocationEdges(
  edges: Map<string, AnalyzeEdge>,
  source: AnalyzeSymbol,
  store: StoreTarget,
  label: string,
  line: number,
  storeSurfaces: Map<string, StoreSurface>,
): void {
  const surface = storeSurfaces.get(store.node.id);
  if (!surface) return;

  const actionMembers = surface.members.filter((member) => member.kind === "action");
  if (actionMembers.length === 0) return;

  const mentioned = new Set(actionNamesFromAccessLabel(label));
  for (const member of actionMembers) {
    if (!mentioned.has(member.node.name)) continue;
    addEdge(edges, {
      type: "invokes_store_action",
      from: source.id,
      to: member.node.id,
      file: source.file,
      line,
      label: member.node.name,
    });
  }
}

function actionNamesFromAccessLabel(label: string): string[] {
  const getStateMatch = label.match(/^getState\(\)\.([A-Za-z_$][\w$]*)$/);
  if (getStateMatch?.[1]) return [getStateMatch[1]];

  return unique(
    [...label.matchAll(/\b[A-Za-z_$][\w$]*\b/g)]
      .map((match) => match[0])
      .filter((name) => !STORE_ACCESS_LABEL_STOP_WORDS.has(name)),
  );
}

const STORE_ACCESS_LABEL_STOP_WORDS = new Set([
  "getState",
  "selector",
  "subscribe",
  "useZustandPerformantStore",
]);

function resolveStoreTarget(
  name: string,
  file: string,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): StoreTarget | null {
  const symbol = findTarget(name, file, byFileAndName, byName);
  if (symbol) {
    if (symbol.type !== "store") return null;
    return {
      external: false,
      node: {
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        file: symbol.file,
        line: symbol.line,
        span: symbol.span,
        exported: symbol.exported,
      },
    };
  }

  const binding = importBindings.get(name);
  if (!binding || !isStoreLikeBinding(name)) return null;
  const location = binding.resolved ?? binding.specifier ?? file;
  return {
    external: true,
    node: {
      id: `external-store:${location}:${name}`,
      type: "store",
      name: `${name} (unscoped)`,
      file: binding.resolved,
    },
  };
}

function isStoreLikeBinding(name: string): boolean {
  if (name === "useZustandPerformantStore") return false;
  return /^use[A-Z].*Store$/.test(name);
}

function storeAccessFromPath(
  path: string[],
  node: Node,
): { type: AnalyzeEdge["type"]; label: string } {
  const last = path.at(-1) ?? "store";
  const getStateIndex = path.indexOf("getState");

  if (last === "setState") {
    return { type: "writes_store", label: "setState" };
  }

  if (getStateIndex >= 0) {
    const method = path[getStateIndex + 1];
    if (method) {
      return {
        type: isMutatingStoreMethod(method) ? "writes_store" : "reads_store",
        label: `getState().${method}`,
      };
    }

    const destructured = destructuredNamesFromGetState(node);
    return {
      type: "reads_store",
      label:
        destructured.length > 0 ? `getState: ${destructured.join(", ")}` : "getState",
    };
  }

  if (last === "subscribe") {
    return { type: "uses_store", label: "subscribe" };
  }

  return {
    type: isMutatingStoreMethod(last) ? "writes_store" : "uses_store",
    label: shortLabel(last),
  };
}

function storeSelectorLabel(selector: Node | undefined): string {
  if (!selector) return "subscribe";

  const selected = selectorFields(selector);
  if (selected.length > 0) return `selector: ${selected.join(", ")}`;

  return `selector: ${shortLabel(selector.getText())}`;
}

function storeVariablesLabel(arg: Node): string {
  if (!Node.isObjectLiteralExpression(arg)) return "variables";

  const variablesProp = objectLiteralProperty(arg, "variables");
  if (variablesProp && Node.isPropertyAssignment(variablesProp)) {
    const initializer = variablesProp.getInitializerOrThrow();
    if (Node.isArrayLiteralExpression(initializer)) {
      const variables = initializer.getElements().map((element) => {
        if (
          Node.isStringLiteral(element) ||
          Node.isNoSubstitutionTemplateLiteral(element)
        ) {
          return element.getLiteralText();
        }
        const selected = selectorFields(element);
        return selected.length > 0 ? selected.join(", ") : "<selector>";
      });
      if (variables.length > 0) return shortLabel(variables.join(", "));
    }
  }

  const selectorProp = objectLiteralProperty(arg, "selector");
  if (selectorProp && Node.isPropertyAssignment(selectorProp)) {
    return storeSelectorLabel(selectorProp.getInitializerOrThrow());
  }

  return "variables";
}

function selectorFields(selector: Node): string[] {
  const unwrapped = unwrapExpression(selector);
  if (!Node.isArrowFunction(unwrapped) && !Node.isFunctionExpression(unwrapped)) {
    return [];
  }

  const paramName = unwrapped.getParameters()[0]?.getName();
  if (!paramName) return [];

  const fields: string[] = [];
  unwrapped.forEachDescendant((child) => {
    if (Node.isPropertyAccessExpression(child)) {
      const expression = child.getExpression();
      if (expression.getText() === paramName) fields.push(child.getName());
    }
    if (Node.isElementAccessExpression(child)) {
      const expression = child.getExpression();
      const argument = child.getArgumentExpression();
      if (
        expression.getText() === paramName &&
        argument &&
        (Node.isStringLiteral(argument) || Node.isNoSubstitutionTemplateLiteral(argument))
      ) {
        fields.push(argument.getLiteralText());
      }
    }
    return undefined;
  });

  return unique(fields);
}

function destructuredNamesFromGetState(node: Node): string[] {
  const parent = node.getParent();
  if (!parent || !Node.isVariableDeclaration(parent)) return [];

  const nameNode = parent.getNameNode();
  if (!Node.isObjectBindingPattern(nameNode)) return [];

  return nameNode.getElements().map((element) => element.getName());
}

function isMutatingStoreMethod(method: string): boolean {
  return /^(add|apply|archive|clear|clone|create|delete|duplicate|link|persist|remove|rename|reset|save|set|toggle|unlink|update)/.test(
    method,
  );
}

function objectLiteralProperty(node: Node, name: string): Node | undefined {
  if (!Node.isObjectLiteralExpression(node)) return undefined;
  return node.getProperties().find((property) => {
    if (!Node.isPropertyAssignment(property)) return false;
    return propertyKeyText(property.getNameNode()) === name;
  });
}

function expressionBaseName(expression: Node): string | null {
  const path = propertyAccessPath(expression);
  return path.at(-1) ?? null;
}

function propertyAccessPath(expression: Node): string[] {
  const unwrapped = unwrapExpression(expression);

  if (Node.isIdentifier(unwrapped)) return [unwrapped.getText()];
  if (Node.isPropertyAccessExpression(unwrapped)) {
    return [...propertyAccessPath(unwrapped.getExpression()), unwrapped.getName()];
  }
  if (Node.isCallExpression(unwrapped))
    return propertyAccessPath(unwrapped.getExpression());

  return [];
}

function addRouteMapSelectionEdges(
  edges: Map<string, AnalyzeEdge>,
  extraNodes: Map<string, AnalyzeNode>,
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  routeMaps: Map<string, ComponentRouteMap>,
): number {
  if (!Node.isElementAccessExpression(node)) return 0;

  const mapName = elementAccessBaseName(node.getExpression());
  if (!mapName) return 0;

  const mapSymbol = findTarget(mapName, source.file, byFileAndName, byName);
  if (!mapSymbol) return 0;

  const routeMap = routeMaps.get(mapSymbol.id);
  if (!routeMap) return 0;

  const selector = node.getArgumentExpression()?.getText() ?? "<unknown>";
  addEdge(edges, {
    type: "selects_by",
    from: source.id,
    to: routeMap.symbol.id,
    file: source.file,
    line: node.getStartLineNumber(),
    label: `${mapName}[${shortLabel(selector)}]`,
  });

  for (const entry of routeMap.entries) {
    ensureExternalNode(extraNodes, entry.target);
    addEdge(edges, {
      type: "routes_to",
      from: routeMap.symbol.id,
      to: entry.target.node.id,
      file: routeMap.symbol.file,
      line: entry.line,
      label: shortLabel(entry.key),
    });
  }

  return 1;
}

function collectFallbackRouteEdges(
  pending: PendingRouteEdge[],
  source: AnalyzeSymbol,
  node: Node,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): void {
  if (Node.isConditionalExpression(node)) {
    const condition = shortLabel(node.getCondition().getText());
    collectFallbackTargets(
      pending,
      source,
      node.getWhenTrue(),
      `${condition} ? true`,
      node.getStartLineNumber(),
      byFileAndName,
      byName,
      importBindings,
    );
    collectFallbackTargets(
      pending,
      source,
      node.getWhenFalse(),
      `${condition} ? false`,
      node.getStartLineNumber(),
      byFileAndName,
      byName,
      importBindings,
    );
    return;
  }

  if (!Node.isBinaryExpression(node)) return;
  const operator = node.getOperatorToken().getKind();
  if (
    operator !== SyntaxKind.QuestionQuestionToken &&
    operator !== SyntaxKind.BarBarToken
  ) {
    return;
  }

  collectFallbackTargets(
    pending,
    source,
    node.getRight(),
    node.getOperatorToken().getText(),
    node.getStartLineNumber(),
    byFileAndName,
    byName,
    importBindings,
  );
}

function collectFallbackTargets(
  pending: PendingRouteEdge[],
  source: AnalyzeSymbol,
  expression: Node,
  label: string,
  line: number,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): void {
  for (const target of resolveComponentTargets(
    expression,
    source.file,
    byFileAndName,
    byName,
    importBindings,
  )) {
    pending.push({
      target,
      edge: {
        type: "fallback_routes_to",
        from: source.id,
        to: target.node.id,
        file: source.file,
        line,
        label: shortLabel(label),
      },
    });
  }
}

function jsxTagName(node: Node): string | null {
  if (Node.isJsxOpeningElement(node) || Node.isJsxSelfClosingElement(node)) {
    return node.getTagNameNode().getText();
  }
  if (Node.isJsxElement(node)) {
    return node.getOpeningElement().getTagNameNode().getText();
  }
  return null;
}

function hasJsxAncestor(node: Node): boolean {
  let current = node.getParent();
  while (current) {
    if (Node.isJsxElement(current) || Node.isJsxFragment(current)) return true;
    current = current.getParent();
  }
  return false;
}

function directJsxChildTargets(
  node: Node,
  file: string,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): RouteTarget[] {
  const children = jsxChildren(node);
  const targets: RouteTarget[] = [];

  for (const child of children) {
    const childTag = jsxTagName(child);
    if (childTag) {
      const target = resolveComponentTarget(
        childTag,
        file,
        byFileAndName,
        byName,
        importBindings,
      );
      if (target) targets.push(target);
      continue;
    }

    if (Node.isJsxFragment(child)) {
      targets.push(
        ...directJsxChildTargets(child, file, byFileAndName, byName, importBindings),
      );
    }
  }

  return targets;
}

function jsxChildren(node: Node): Node[] {
  if (Node.isJsxElement(node) || Node.isJsxFragment(node)) {
    return node.getJsxChildren();
  }
  return [];
}

function callExpressionName(expression: Node): string | null {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return null;
}

function elementAccessBaseName(expression: Node): string | null {
  if (Node.isIdentifier(expression)) return expression.getText();
  if (Node.isPropertyAccessExpression(expression)) return expression.getName();
  return null;
}

function buildImportBindings(
  sourceFile: SourceFile,
  baseDir: string,
  file: string,
): Map<string, ImportBinding> {
  const bindings = new Map<string, ImportBinding>();

  for (const importDecl of sourceFile.getImportDeclarations()) {
    const specifier = importDecl.getModuleSpecifierValue();
    const resolved = resolveImport(baseDir, file, specifier) ?? undefined;

    const defaultImport = importDecl.getDefaultImport();
    if (defaultImport) {
      bindings.set(defaultImport.getText(), {
        localName: defaultImport.getText(),
        specifier,
        resolved,
      });
    }

    const namespaceImport = importDecl.getNamespaceImport();
    if (namespaceImport) {
      bindings.set(namespaceImport.getText(), {
        localName: namespaceImport.getText(),
        specifier,
        resolved,
      });
    }

    for (const namedImport of importDecl.getNamedImports()) {
      const localName = namedImport.getAliasNode()?.getText() ?? namedImport.getName();
      bindings.set(localName, { localName, specifier, resolved });
    }
  }

  return bindings;
}

function propertyKeyText(node: Node): string {
  return node.getText().replace(/^["'`]|["'`]$/g, "");
}

function resolveComponentTargets(
  expression: Node,
  file: string,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): RouteTarget[] {
  return unique(componentNamesFromExpression(expression))
    .map((name) =>
      resolveComponentTarget(name, file, byFileAndName, byName, importBindings),
    )
    .filter((target): target is RouteTarget => target !== null);
}

function resolveComponentTarget(
  name: string,
  file: string,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
  importBindings: Map<string, ImportBinding>,
): RouteTarget | null {
  if (!/^[A-Z]/.test(name)) return null;

  const symbol = findTarget(name, file, byFileAndName, byName);
  if (symbol) {
    if (symbol.type !== "component") return null;
    return {
      external: false,
      node: {
        id: symbol.id,
        type: symbol.type,
        name: symbol.name,
        file: symbol.file,
        line: symbol.line,
        span: symbol.span,
        exported: symbol.exported,
      },
    };
  }

  const binding = importBindings.get(name);
  if (!binding) return null;
  const location = binding?.resolved ?? binding?.specifier ?? file;
  return {
    external: true,
    node: {
      id: `external-component:${location}:${name}`,
      type: "component",
      name: binding ? `${name} (unscoped)` : `${name} (unresolved)`,
      file: binding?.resolved,
    },
  };
}

function componentNamesFromExpression(expression: Node): string[] {
  const names: string[] = [];
  const unwrapped = unwrapExpression(expression);

  if (Node.isIdentifier(unwrapped)) {
    names.push(unwrapped.getText());
  }

  const tag = jsxTagName(unwrapped);
  if (tag) names.push(tag);

  unwrapped.forEachDescendant((child) => {
    const childTag = jsxTagName(child);
    if (childTag) names.push(childTag);

    return undefined;
  });

  return unique(names.map((name) => name.split(".").at(-1) ?? name)).filter((name) =>
    /^[A-Z]/.test(name),
  );
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

function ensureExternalNode(
  extraNodes: Map<string, AnalyzeNode>,
  target: RouteTarget,
): void {
  if (!target.external) return;
  extraNodes.set(target.node.id, target.node);
}

function findTarget(
  name: string,
  file: string,
  byFileAndName: Map<string, Map<string, AnalyzeSymbol>>,
  byName: Map<string, AnalyzeSymbol>,
): AnalyzeSymbol | undefined {
  return byFileAndName.get(file)?.get(name) ?? byName.get(name);
}

function addEdge(edges: Map<string, AnalyzeEdge>, edge: Omit<AnalyzeEdge, "id">): void {
  const id = edgeId(edge.type, edge.from, edge.to, edge.line);
  if (edges.has(id)) return;
  edges.set(id, { id, ...edge });
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

function shortLabel(value: string): string {
  return value.length > 80 ? `${value.slice(0, 77)}...` : value;
}

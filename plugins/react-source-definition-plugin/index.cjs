const fs = require("node:fs");
const path = require("node:path");

function init(modules) {
  const ts = modules.typescript;

  function create(info) {
    const reactSourceRoot = path.join(
      info.project.getCurrentDirectory(),
      "react-source",
    );
    const packagesRoot = path.join(reactSourceRoot, "packages");
    const sourceMapCache = new Map();

    const proxy = Object.create(null);
    for (const key of Object.keys(info.languageService)) {
      const value = info.languageService[key];
      proxy[key] =
        typeof value === "function" ? value.bind(info.languageService) : value;
    }

    proxy.getDefinitionAtPosition = (fileName, position) => {
      const reactDefinition = getReactDefinition(
        info,
        ts,
        packagesRoot,
        sourceMapCache,
        fileName,
        position,
      );

      return (
        reactDefinition?.definitions ||
        info.languageService.getDefinitionAtPosition(fileName, position)
      );
    };

    proxy.getDefinitionAndBoundSpan = (fileName, position) => {
      const original = info.languageService.getDefinitionAndBoundSpan(
        fileName,
        position,
      );
      const reactDefinition = getReactDefinition(
        info,
        ts,
        packagesRoot,
        sourceMapCache,
        fileName,
        position,
      );

      if (!reactDefinition) {
        return original;
      }

      return {
        textSpan: original?.textSpan || reactDefinition.textSpan,
        definitions: reactDefinition.definitions,
      };
    };

    info.project.projectService.logger.info(
      `react-source-definition-plugin using ${packagesRoot}`,
    );

    return proxy;
  }

  return {create};
}

function getReactDefinition(
  info,
  ts,
  packagesRoot,
  sourceMapCache,
  fileName,
  position,
) {
  const program = info.languageService.getProgram();
  const sourceFile = program && program.getSourceFile(fileName);

  if (!sourceFile) {
    return null;
  }

  const token = getTokenAtPosition(ts, sourceFile, position);
  if (!token || !ts.isIdentifier(token)) {
    return null;
  }

  const imports = collectImports(ts, sourceFile);
  const request = getImportRequest(ts, token, imports);

  if (!request) {
    return null;
  }

  const target = resolveReactSourceTarget(
    packagesRoot,
    sourceMapCache,
    request.moduleName,
    request.exportName,
  );

  if (!target) {
    return null;
  }

  return {
    textSpan: {
      start: token.getStart(sourceFile),
      length: token.getWidth(sourceFile),
    },
    definitions: [
      {
        fileName: target.fileName,
        textSpan: {
          start: target.start,
          length: target.length,
        },
        kind: ts.ScriptElementKind.alias,
        name: request.exportName || request.moduleName,
        containerKind: ts.ScriptElementKind.moduleElement,
        containerName: request.moduleName,
      },
    ],
  };
}

function getTokenAtPosition(ts, sourceFile, position) {
  function visit(node) {
    if (position < node.getFullStart() || position >= node.getEnd()) {
      return undefined;
    }

    return ts.forEachChild(node, visit) || node;
  }

  return visit(sourceFile);
}

function collectImports(ts, sourceFile) {
  const named = new Map();
  const namespaces = new Map();

  for (const statement of sourceFile.statements) {
    if (
      !ts.isImportDeclaration(statement) ||
      !statement.importClause ||
      !ts.isStringLiteral(statement.moduleSpecifier)
    ) {
      continue;
    }

    const moduleName = statement.moduleSpecifier.text;
    const importClause = statement.importClause;

    if (importClause.name) {
      named.set(importClause.name.text, {
        moduleName,
        exportName: "default",
      });
    }

    if (!importClause.namedBindings) {
      continue;
    }

    if (ts.isNamespaceImport(importClause.namedBindings)) {
      namespaces.set(importClause.namedBindings.name.text, moduleName);
      continue;
    }

    for (const element of importClause.namedBindings.elements) {
      named.set(element.name.text, {
        moduleName,
        exportName: element.propertyName
          ? element.propertyName.text
          : element.name.text,
      });
    }
  }

  return {named, namespaces};
}

function getImportRequest(ts, token, imports) {
  const importSpecifier = findAncestor(token, ts.isImportSpecifier);

  if (importSpecifier) {
    const importDeclaration = findAncestor(importSpecifier, ts.isImportDeclaration);
    if (
      importDeclaration &&
      ts.isStringLiteral(importDeclaration.moduleSpecifier)
    ) {
      return {
        moduleName: importDeclaration.moduleSpecifier.text,
        exportName: importSpecifier.propertyName
          ? importSpecifier.propertyName.text
          : importSpecifier.name.text,
      };
    }
  }

  if (
    token.parent &&
    ts.isPropertyAccessExpression(token.parent) &&
    token.parent.name === token &&
    ts.isIdentifier(token.parent.expression)
  ) {
    const moduleName = imports.namespaces.get(token.parent.expression.text);
    if (moduleName) {
      return {
        moduleName,
        exportName: token.text,
      };
    }
  }

  return imports.named.get(token.text) || null;
}

function findAncestor(node, predicate) {
  let current = node.parent;

  while (current) {
    if (predicate(current)) {
      return current;
    }

    current = current.parent;
  }

  return null;
}

function resolveReactSourceTarget(
  packagesRoot,
  sourceMapCache,
  moduleName,
  exportName,
) {
  if (moduleName === "react") {
    const map = getReactClientExportMap(packagesRoot, sourceMapCache);
    return findTarget(packagesRoot, map.get(exportName)) || fileTarget(
      path.join(packagesRoot, "react/index.js"),
      exportName,
    );
  }

  if (moduleName === "react-dom/client") {
    const map = getReactDOMClientExportMap(packagesRoot, sourceMapCache);
    return findTarget(packagesRoot, map.get(exportName)) || fileTarget(
      path.join(packagesRoot, "react-dom/client.js"),
      exportName,
    );
  }

  if (moduleName === "react-dom") {
    return fileTarget(path.join(packagesRoot, "react-dom/index.js"), exportName);
  }

  return null;
}

function getReactClientExportMap(packagesRoot, cache) {
  const cacheKey = "react";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const fileName = path.join(packagesRoot, "react/src/ReactClient.js");
  const map = buildNamedExportMap(fileName, packagesRoot);
  cache.set(cacheKey, map);
  return map;
}

function getReactDOMClientExportMap(packagesRoot, cache) {
  const cacheKey = "react-dom/client";
  if (cache.has(cacheKey)) {
    return cache.get(cacheKey);
  }

  const fileName = path.join(packagesRoot, "react-dom/client.js");
  const map = new Map();
  const code = readFile(fileName);
  const reExport = /export\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"]/g;
  let match;

  while ((match = reExport.exec(code))) {
      const targetFile = resolveImport(packagesRoot, fileName, match[2]);
    for (const specifier of splitSpecifiers(match[1])) {
      const parsed = parseSpecifier(specifier);
      if (parsed) {
        map.set(parsed.exported, {
          fileName: targetFile,
          sourceName: parsed.local,
        });
      }
    }
  }

  cache.set(cacheKey, map);
  return map;
}

function buildNamedExportMap(fileName, packagesRoot) {
  const code = readFile(fileName);
  const imports = new Map();
  const map = new Map();
  const importDeclaration = /import\s*\{([\s\S]*?)\}\s*from\s*['"](.+?)['"]/g;
  let match;

  while ((match = importDeclaration.exec(code))) {
    const targetFile = resolveImport(packagesRoot, fileName, match[2]);
    for (const specifier of splitSpecifiers(match[1])) {
      const parsed = parseSpecifier(specifier);
      if (parsed) {
        imports.set(parsed.exported, {
          fileName: targetFile,
          sourceName: parsed.local,
        });
      }
    }
  }

  const exportDeclaration = /export\s*\{([\s\S]*?)\};/g;

  while ((match = exportDeclaration.exec(code))) {
    for (const specifier of splitSpecifiers(match[1])) {
      const parsed = parseSpecifier(specifier);
      if (!parsed) {
        continue;
      }

      const imported = imports.get(parsed.local);
      map.set(parsed.exported, imported || {
        fileName,
        sourceName: parsed.local,
      });
    }
  }

  return map;
}

function splitSpecifiers(input) {
  return input
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .split(",")
    .map((specifier) => specifier.trim())
    .filter(Boolean);
}

function parseSpecifier(specifier) {
  const normalized = specifier.replace(/\s+/g, " ");
  const match = /^([A-Za-z_$][\w$]*)(?: as ([A-Za-z_$][\w$]*))?$/.exec(
    normalized,
  );

  if (!match) {
    return null;
  }

  return {
    local: match[1],
    exported: match[2] || match[1],
  };
}

function findTarget(packagesRoot, target) {
  if (!target) {
    return null;
  }

  if (!fs.existsSync(target.fileName)) {
    return null;
  }

  const position = findNamePosition(target.fileName, target.sourceName);

  return {
    fileName: target.fileName,
    start: position.start,
    length: position.length,
  };
}

function fileTarget(fileName, name) {
  if (!fs.existsSync(fileName)) {
    return null;
  }

  const position = findNamePosition(fileName, name);
  return {
    fileName,
    start: position.start,
    length: position.length,
  };
}

function findNamePosition(fileName, name) {
  const code = readFile(fileName);

  if (name) {
    const escaped = escapeRegExp(name);
    const patterns = [
      new RegExp(`\\bexport\\s+function\\s+(${escaped})\\b`),
      new RegExp(`\\bexport\\s+class\\s+(${escaped})\\b`),
      new RegExp(`\\bexport\\s+const\\s+(${escaped})\\b`),
      new RegExp(`\\bfunction\\s+(${escaped})\\b`),
      new RegExp(`\\bclass\\s+(${escaped})\\b`),
      new RegExp(`\\bconst\\s+(${escaped})\\b`),
      new RegExp(`\\b(${escaped})\\b`),
    ];

    for (const pattern of patterns) {
      const match = pattern.exec(code);
      if (match) {
        return {
          start: match.index + match[0].lastIndexOf(match[1]),
          length: name.length,
        };
      }
    }
  }

  return {start: 0, length: 1};
}

function resolveImport(packagesRoot, fromFile, importPath) {
  let resolved = importPath;

  if (importPath.startsWith(".")) {
    resolved = path.resolve(path.dirname(fromFile), importPath);
  } else {
    const [packageName, ...segments] = importPath.split("/");
    resolved = path.join(packagesRoot, packageName, ...segments);
  }

  if (!path.extname(resolved)) {
    resolved += ".js";
  }

  return resolved;
}

function readFile(fileName) {
  try {
    return fs.readFileSync(fileName, "utf8");
  } catch {
    return "";
  }
}

function escapeRegExp(input) {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = init;

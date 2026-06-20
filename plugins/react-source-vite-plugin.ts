import {transformFromAstSync} from "@babel/core";
import {createRequire} from "node:module";
import fs from "node:fs";
import path from "node:path";
import type {AliasOptions, ModuleGraph, ModuleNode, Plugin, ServerOptions} from "vite";

const require = createRequire(import.meta.url);
const hermesParser = require("hermes-parser") as {
  parse(
    code: string,
    options: {
      babel: boolean;
      sourceType: "module";
    },
  ): unknown;
};

type ReactSourceViteOptions = {
  projectRoot: string;
  reactSourceRoot: string;
};

export function createReactSourceDebugConfig({
  projectRoot,
  reactSourceRoot,
}: ReactSourceViteOptions) {
  const context = createReactSourceContext(projectRoot, reactSourceRoot);

  return {
    aliases: createReactSourceAliases(context),
    plugins: [
      reactSourceForkPlugin(context),
      reactSourceSchedulerPlugin(context),
      reactSourceFlowPlugin(context),
      reactSourceHotReloadPlugin(context),
      reactSourceDependencyOptimizerPlugin(),
    ],
    server: {
      watch: {
        ignored: context.shouldIgnoreWatcherPath,
      },
      fs: {
        allow: [projectRoot, reactSourceRoot],
      },
    } satisfies Pick<ServerOptions, "watch" | "fs">,
  };
}

function createReactSourceContext(projectRoot: string, reactSourceRoot: string) {
  const packagesRoot = path.join(reactSourceRoot, "packages");

  if (!fs.existsSync(packagesRoot)) {
    throw new Error(
      [
        `react-source packages directory not found: ${packagesRoot}`,
        "Run `git submodule update --init --recursive` to initialize the React source submodule.",
      ].join("\n"),
    );
  }

  function pkgPath(...segments: string[]) {
    return path.join(packagesRoot, ...segments);
  }

  const watchedReactSourceRoots = [
    "react",
    "react-client",
    "react-dom",
    "react-dom-bindings",
    "react-reconciler",
    "scheduler",
    "shared",
  ].map((packageName) => pkgPath(packageName));
  const rendererRuntimeRoots = [
    "react-client",
    "react-dom",
    "react-dom-bindings",
    "react-reconciler",
    "scheduler",
    "shared",
  ].map((packageName) => pkgPath(packageName));

  function normalizeId(id: string) {
    return id.split("?", 1)[0].replace(/^\/@fs/, "");
  }

  function isInsidePath(filePath: string, parentPath: string) {
    return filePath === parentPath || filePath.startsWith(`${parentPath}${path.sep}`);
  }

  function isReactSourceFile(id: string) {
    const normalizedId = normalizeId(id);
    return normalizedId.startsWith(packagesRoot) && normalizedId.endsWith(".js");
  }

  function isWatchedReactSourcePath(filePath: string) {
    return watchedReactSourceRoots.some((root) => isInsidePath(filePath, root));
  }

  function isRendererRuntimePath(filePath: string) {
    return rendererRuntimeRoots.some((root) => isInsidePath(filePath, root));
  }

  function shouldIgnoreWatcherPath(filePath: string, stats?: fs.Stats) {
    const normalizedPath = normalizeId(filePath);
    if (!isInsidePath(normalizedPath, reactSourceRoot)) {
      return false;
    }

    if (!isWatchedReactSourcePath(normalizedPath)) {
      return true;
    }

    return stats?.isFile() === true && !normalizedPath.endsWith(".js");
  }

  return {
    projectRoot,
    reactSourceRoot,
    packagesRoot,
    flowStripPlugin: require.resolve("@babel/plugin-transform-flow-strip-types"),
    domPluginEventSystemId: pkgPath(
      "react-dom-bindings/src/events/DOMPluginEventSystem.js",
    ),
    reactDomClientId: pkgPath("react-dom/client.js"),
    watchedReactSourceRoots,
    normalizeId,
    isReactSourceFile,
    isWatchedReactSourcePath,
    isRendererRuntimePath,
    shouldIgnoreWatcherPath,
    pkgPath,
  };
}

type ReactSourceContext = ReturnType<typeof createReactSourceContext>;

function createReactSourceAliases(context: ReactSourceContext): AliasOptions {
  const {pkgPath} = context;

  return [
    {
      find: /^@react-source\/react$/,
      replacement: pkgPath("react/index.js"),
    },
    {
      find: /^@react-source\/react-dom-client$/,
      replacement: pkgPath("react-dom/client.js"),
    },
    {find: /^react$/, replacement: pkgPath("react/index.js")},
    {
      find: /^react\/jsx-runtime$/,
      replacement: pkgPath("react/jsx-runtime.js"),
    },
    {
      find: /^react\/jsx-dev-runtime$/,
      replacement: pkgPath("react/jsx-dev-runtime.js"),
    },
    {find: /^react\/(.*)$/, replacement: `${pkgPath("react")}/$1`},
    {find: /^react-dom$/, replacement: pkgPath("react-dom/index.js")},
    {
      find: /^react-dom\/client$/,
      replacement: pkgPath("react-dom/client.js"),
    },
    {find: /^react-dom\/(.*)$/, replacement: `${pkgPath("react-dom")}/$1`},
    {find: /^scheduler\/(.*)$/, replacement: `${pkgPath("scheduler")}/$1`},
    {
      find: /^shared\/ReactDOMSharedInternals$/,
      replacement: pkgPath("react-dom/src/ReactDOMSharedInternals.js"),
    },
    {
      find: /^shared\/ReactSharedInternals$/,
      replacement: pkgPath("react/src/ReactSharedInternalsClient.js"),
    },
    {
      find: /^shared\/(.*)$/,
      replacement: `${pkgPath("shared")}/$1`,
    },
    {
      find: /^react-dom-bindings\/(.*)$/,
      replacement: `${pkgPath("react-dom-bindings")}/$1`,
    },
    {
      find: /^react-reconciler\/(.*)$/,
      replacement: `${pkgPath("react-reconciler")}/$1`,
    },
    {
      find: /^react-client\/(.*)$/,
      replacement: `${pkgPath("react-client")}/$1`,
    },
  ];
}

function reactSourceFlowPlugin(context: ReactSourceContext): Plugin {
  return {
    name: "react-source-flow",
    enforce: "pre",
    load(id) {
      if (!context.isReactSourceFile(id)) {
        return null;
      }

      const normalizedId = context.normalizeId(id);
      const code = fs.readFileSync(normalizedId, "utf8");
      const ast = hermesParser.parse(code, {
        babel: true,
        sourceType: "module",
      });

      const result = transformFromAstSync(ast as any, code, {
        filename: normalizedId,
        sourceFileName: normalizedId,
        sourceMaps: true,
        configFile: false,
        babelrc: false,
        plugins: [context.flowStripPlugin],
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: patchReactSourceCode(context, normalizedId, result.code),
        map: result.map ?? null,
      };
    },
  };
}

function patchReactSourceCode(
  context: ReactSourceContext,
  id: string,
  code: string,
) {
  if (id !== context.domPluginEventSystemId) {
    return code;
  }

  const registrationBlock = [
    "SimpleEventPlugin.registerEvents();",
    "EnterLeaveEventPlugin.registerEvents();",
    "ChangeEventPlugin.registerEvents();",
    "SelectEventPlugin.registerEvents();",
    "BeforeInputEventPlugin.registerEvents();",
    "if (enableScrollEndPolyfill) {",
    "  ScrollEndEventPlugin.registerEvents();",
    "}",
  ].join("\n");

  return code
    .replace(
      "import { allNativeEvents } from './EventRegistry';",
      "import { allNativeEvents, registrationNameDependencies } from './EventRegistry';",
    )
    .replace(
      registrationBlock,
      [
        "if (!registrationNameDependencies.onClick) {",
        "  SimpleEventPlugin.registerEvents();",
        "  EnterLeaveEventPlugin.registerEvents();",
        "  ChangeEventPlugin.registerEvents();",
        "  SelectEventPlugin.registerEvents();",
        "  BeforeInputEventPlugin.registerEvents();",
        "  if (enableScrollEndPolyfill) {",
        "    ScrollEndEventPlugin.registerEvents();",
        "  }",
        "}",
      ].join("\n"),
    );
}

function reactSourceForkPlugin(context: ReactSourceContext): Plugin {
  const reconcilerConfigId = context.pkgPath(
    "react-reconciler/src/ReactFiberConfig.js",
  );
  const reconcilerDomForkImport = context.pkgPath(
    "react-reconciler/src/forks/ReactFiberConfig.dom.js",
  );
  const virtualReconcilerConfigId = "\0react-source-react-fiber-config-dom";

  return {
    name: "react-source-forks",
    enforce: "pre",
    resolveId(source, importer) {
      if (
        importer &&
        source === "./ReactFiberConfig" &&
        context.normalizeId(importer).startsWith(
          path.join(context.packagesRoot, "react-reconciler/src/"),
        )
      ) {
        return virtualReconcilerConfigId;
      }

      return null;
    },
    load(id) {
      if (id === virtualReconcilerConfigId) {
        return `export * from ${JSON.stringify(reconcilerDomForkImport)};`;
      }

      if (context.normalizeId(id) === reconcilerConfigId) {
        return `export * from ${JSON.stringify(reconcilerDomForkImport)};`;
      }

      return null;
    },
  };
}

function reactSourceSchedulerPlugin(context: ReactSourceContext): Plugin {
  const schedulerImport = context.pkgPath("scheduler/index.js");
  const virtualSchedulerId = "\0react-source-scheduler";

  return {
    name: "react-source-scheduler",
    enforce: "pre",
    resolveId(source) {
      if (source === "scheduler") {
        return virtualSchedulerId;
      }

      return null;
    },
    load(id) {
      if (id !== virtualSchedulerId) {
        return null;
      }

      return [
        `export * from ${JSON.stringify(schedulerImport)};`,
        "export function log() {}",
        "export function unstable_setDisableYieldValue() {}",
      ].join("\n");
    },
  };
}

function reactSourceHotReloadPlugin(context: ReactSourceContext): Plugin {
  return {
    name: "react-source-hot-reload",
    configureServer(server) {
      server.watcher.add(context.watchedReactSourceRoots);
    },
    handleHotUpdate(ctx) {
      const changedFile = context.normalizeId(ctx.file);
      if (
        !context.isReactSourceFile(changedFile) ||
        !context.isWatchedReactSourcePath(changedFile)
      ) {
        return;
      }

      const directModules = ctx.server.moduleGraph.getModulesByFile(ctx.file) ?? [];
      const hmrModules = new Set(directModules);
      const invalidatedModules = new Set<ModuleNode>();

      for (const mod of directModules) {
        invalidateModuleAndImporters(
          ctx.server.moduleGraph,
          mod,
          invalidatedModules,
        );
      }

      if (context.isRendererRuntimePath(changedFile)) {
        const reactDomClientModules =
          ctx.server.moduleGraph.getModulesByFile(context.reactDomClientId) ?? [];
        for (const mod of reactDomClientModules) {
          hmrModules.add(mod);
          invalidateModuleAndImporters(
            ctx.server.moduleGraph,
            mod,
            invalidatedModules,
          );
        }
      }

      return [...hmrModules];
    },
  };
}

function invalidateModuleAndImporters(
  moduleGraph: ModuleGraph,
  mod: ModuleNode,
  seen: Set<ModuleNode>,
) {
  if (seen.has(mod)) {
    return;
  }

  seen.add(mod);
  moduleGraph.invalidateModule(mod);

  for (const importer of mod.importers) {
    invalidateModuleAndImporters(moduleGraph, importer, seen);
  }
}

function reactSourceDependencyOptimizerPlugin(): Plugin {
  return {
    name: "react-source-dependency-optimizer",
    enforce: "post",
    configResolved(config) {
      config.optimizeDeps.include = [];
    },
  };
}

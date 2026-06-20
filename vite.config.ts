import { transformFromAstSync } from "@babel/core";
import react from "@vitejs/plugin-react";
import hermesParser from "hermes-parser";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import debugConfig from "./react-source-debug.config.mjs";

const require = createRequire(import.meta.url);
const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const reactSourceRoot = path.join(projectRoot, "react-source");
const packagesRoot = path.join(reactSourceRoot, "packages");

if (!fs.existsSync(packagesRoot)) {
  throw new Error(
    [
      `react-source packages directory not found: ${packagesRoot}`,
      "Run `git submodule update --init --recursive` to initialize the React source submodule.",
    ].join("\n"),
  );
}

const flowStripPlugin = require.resolve("@babel/plugin-transform-flow-strip-types");
const domPluginEventSystemId = path.join(
  packagesRoot,
  "react-dom-bindings/src/events/DOMPluginEventSystem.js",
);
const watchedReactSourceRoots = [
  "react",
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

function isReactSourceFile(id: string) {
  const normalizedId = normalizeId(id);
  return normalizedId.startsWith(packagesRoot) && normalizedId.endsWith(".js");
}

function isInsidePath(filePath: string, parentPath: string) {
  return filePath === parentPath || filePath.startsWith(`${parentPath}${path.sep}`);
}

function isWatchedReactSourcePath(filePath: string) {
  return watchedReactSourceRoots.some((root) => isInsidePath(filePath, root));
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

function reactSourceFlowPlugin(): Plugin {
  return {
    name: "react-source-flow",
    enforce: "pre",
    load(id) {
      if (!isReactSourceFile(id)) {
        return null;
      }

      const normalizedId = normalizeId(id);
      const code = fs.readFileSync(normalizedId, "utf8");
      const ast = hermesParser.parse(code, {
        babel: true,
        sourceType: "module",
      });

      const result = transformFromAstSync(ast, code, {
        filename: normalizedId,
        sourceFileName: normalizedId,
        sourceMaps: true,
        configFile: false,
        babelrc: false,
        plugins: [flowStripPlugin],
      });

      if (!result?.code) {
        return null;
      }

      return {
        code: patchReactSourceCode(normalizedId, result.code),
        map: result.map ?? null,
      };
    },
  };
}

function patchReactSourceCode(id: string, code: string) {
  if (id !== domPluginEventSystemId) {
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

function reactSourceForkPlugin(): Plugin {
  const reconcilerConfigId = path.join(
    packagesRoot,
    "react-reconciler/src/ReactFiberConfig.js",
  );
  const reconcilerDomForkImport = pkgPath(
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
        normalizeId(importer).startsWith(
          path.join(packagesRoot, "react-reconciler/src/"),
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

      if (normalizeId(id) === reconcilerConfigId) {
        return `export * from ${JSON.stringify(reconcilerDomForkImport)};`;
      }

      return null;
    },
  };
}

function reactSourceSchedulerPlugin(): Plugin {
  const schedulerImport = pkgPath("scheduler/index.js");
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

function reactSourceHotReloadPlugin(): Plugin {
  return {
    name: "react-source-hot-reload",
    configureServer(server) {
      server.watcher.add(watchedReactSourceRoots);
    },
    handleHotUpdate(ctx) {
      const changedFile = normalizeId(ctx.file);
      if (!isReactSourceFile(changedFile) || !isWatchedReactSourcePath(changedFile)) {
        return;
      }

      const directModules = ctx.server.moduleGraph.getModulesByFile(ctx.file) ?? [];
      for (const mod of directModules) {
        ctx.server.moduleGraph.invalidateModule(mod);
      }

      return [...directModules];
    },
  };
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

function pkgPath(...segments: string[]) {
  return path.join(packagesRoot, ...segments);
}

export default defineConfig({
  plugins: [
    reactSourceForkPlugin(),
    reactSourceSchedulerPlugin(),
    reactSourceFlowPlugin(),
    reactSourceHotReloadPlugin(),
    react(),
    reactSourceDependencyOptimizerPlugin(),
  ],
  esbuild: false,
  resolve: {
    alias: [
      {
        find: /^@react-source\/react$/,
        replacement: pkgPath("react/index.js"),
      },
      {
        find: /^@react-source\/react-dom-client$/,
        replacement: pkgPath("react-dom/client.js"),
      },
      { find: /^react$/, replacement: pkgPath("react/index.js") },
      {
        find: /^react\/jsx-runtime$/,
        replacement: pkgPath("react/jsx-runtime.js"),
      },
      {
        find: /^react\/jsx-dev-runtime$/,
        replacement: pkgPath("react/jsx-dev-runtime.js"),
      },
      { find: /^react\/(.*)$/, replacement: `${pkgPath("react")}/$1` },
      { find: /^react-dom$/, replacement: pkgPath("react-dom/index.js") },
      {
        find: /^react-dom\/client$/,
        replacement: pkgPath("react-dom/client.js"),
      },
      { find: /^react-dom\/(.*)$/, replacement: `${pkgPath("react-dom")}/$1` },
      { find: /^scheduler\/(.*)$/, replacement: `${pkgPath("scheduler")}/$1` },
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
    ],
  },
  define: {
    __DEV__: "true",
    __PROFILE__: "false",
    __EXPERIMENTAL__: "false",
    __VARIANT__: "false",
  },
  optimizeDeps: {
    noDiscovery: true,
    include: [],
    exclude: [
      "react",
      "react-dom",
      "react-dom/client",
      "react/jsx-runtime",
      "react/jsx-dev-runtime",
      "scheduler",
    ],
  },
  server: {
    host: debugConfig.devServer.host,
    port: debugConfig.devServer.port,
    watch: {
      ignored: shouldIgnoreWatcherPath,
    },
    fs: {
      allow: [projectRoot, reactSourceRoot],
    },
  },
});

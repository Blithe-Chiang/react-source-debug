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
const reactSourceRoot = path.resolve(debugConfig.reactSourceDir);
const packagesRoot = path.join(reactSourceRoot, "packages");

if (!fs.existsSync(packagesRoot)) {
  throw new Error(
    [
      `react-source packages directory not found: ${packagesRoot}`,
      "Set REACT_SOURCE_DIR or edit react-source-debug.config.mjs to point to a valid React source checkout.",
    ].join("\n"),
  );
}

const flowStripPlugin = require.resolve("@babel/plugin-transform-flow-strip-types");

function normalizeId(id: string) {
  return id.split("?", 1)[0].replace(/^\/@fs/, "");
}

function isReactSourceFile(id: string) {
  const normalizedId = normalizeId(id);
  return normalizedId.startsWith(packagesRoot) && normalizedId.endsWith(".js");
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
        code: result.code,
        map: result.map ?? null,
      };
    },
  };
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

function reactSourceHotReloadPlugin(): Plugin {
  return {
    name: "react-source-hot-reload",
    configureServer(server) {
      server.watcher.add(packagesRoot);
    },
    handleHotUpdate(ctx) {
      const changedFile = normalizeId(ctx.file);
      if (!changedFile.startsWith(packagesRoot)) {
        return;
      }

      const directModules = ctx.server.moduleGraph.getModulesByFile(ctx.file) ?? [];
      for (const mod of directModules) {
        ctx.server.moduleGraph.invalidateModule(mod);
      }

      ctx.server.ws.send({
        type: "full-reload",
        path: "*",
      });

      return [];
    },
  };
}

function pkgPath(...segments: string[]) {
  return path.join(packagesRoot, ...segments);
}

export default defineConfig({
  plugins: [
    reactSourceForkPlugin(),
    reactSourceFlowPlugin(),
    reactSourceHotReloadPlugin(),
    react({ jsxRuntime: "classic" }),
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
      {
        find: /^scheduler$/,
        replacement: path.join(projectRoot, "src/react-source/scheduler-shim.js"),
      },
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
    disabled: "dev",
    noDiscovery: true,
    include: [],
  },
  server: {
    host: debugConfig.devServer.host,
    port: debugConfig.devServer.port,
    fs: {
      allow: [projectRoot, reactSourceRoot],
    },
  },
});

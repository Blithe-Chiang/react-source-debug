import react from "@vitejs/plugin-react";
import path from "node:path";
import {fileURLToPath} from "node:url";
import {defineConfig} from "vite";
import debugConfig from "./react-source-debug.config";
import {createReactSourceDebugConfig} from "./plugins/react-source-vite-plugin";

const projectRoot = path.dirname(fileURLToPath(import.meta.url));
const reactSourceRoot = path.join(projectRoot, "react-source");
const reactSourceDebug = createReactSourceDebugConfig({
  projectRoot,
  reactSourceRoot,
});

export default defineConfig({
  plugins: [...reactSourceDebug.plugins, react()],
  esbuild: false,
  resolve: {
    alias: reactSourceDebug.aliases,
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
    ...reactSourceDebug.server,
  },
});

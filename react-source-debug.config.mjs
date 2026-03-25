import path from "node:path";
import { fileURLToPath } from "node:url";

const configDir = path.dirname(fileURLToPath(import.meta.url));

function resolveFromConfigDir(inputPath) {
  return path.isAbsolute(inputPath)
    ? inputPath
    : path.resolve(configDir, inputPath);
}

function readPort(value, fallback) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isFinite(port) ? port : fallback;
}

const config = {
  reactSourceDir: resolveFromConfigDir(
    process.env.REACT_SOURCE_DIR ?? "../react-source",
  ),
  devServer: {
    host: process.env.REACT_SOURCE_DEBUG_HOST ?? "127.0.0.1",
    port: readPort(process.env.REACT_SOURCE_DEBUG_PORT, 5173),
  },
};

export default config;

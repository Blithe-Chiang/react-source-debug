function readPort(value: string | undefined, fallback: number) {
  const port = Number.parseInt(value ?? "", 10);
  return Number.isFinite(port) ? port : fallback;
}

const config = {
  devServer: {
    host: process.env.REACT_SOURCE_DEBUG_HOST ?? "127.0.0.1",
    port: readPort(process.env.REACT_SOURCE_DEBUG_PORT, 5173),
  },
};

export default config;

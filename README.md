# react-source-debug

一个最小的 Vite + React + TypeScript 调试壳。

它不会使用 npm 上发布的 `react` / `react-dom` 构建产物，而是把模块直接指向当前工作区里的 `react-source/packages/*` 源码，并在 Vite dev server 中即时把 Flow 类型剥离掉。

## 配置 React 源码目录

默认会读取 `../react-source`。

如果你的 React 源码不在这个位置，可以二选一：

1. 修改 `react-source-debug.config.mjs` 里的 `reactSourceDir`
2. 启动前设置环境变量 `REACT_SOURCE_DIR`

示例：

```bash
REACT_SOURCE_DIR=/absolute/path/to/react npm run dev
```

除了源码路径外，还支持：

```bash
REACT_SOURCE_DEBUG_HOST=0.0.0.0
REACT_SOURCE_DEBUG_PORT=4173
```

## 使用

```bash
npm install
npm run dev
```

然后直接修改 `../react-source/packages/**` 里的源码，例如加 `console.log` 或 `debugger`，刷新页面即可调试。

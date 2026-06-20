# react-source-debug

一个最小的 Vite + React + TypeScript 调试壳。

它不会使用 npm 上发布的 `react` / `react-dom` 构建产物，而是把标准导入
`react`、`react-dom/client` 等模块直接指向当前工作区里的
`react-source/packages/*` 子模块源码，并在 Vite dev server 中即时把 Flow 类型剥离掉。

TypeScript 仍然使用 `@types/react` / `@types/react-dom` 的声明文件，并显式启用
canary 类型；运行时解析由 Vite alias 接管。因此应用代码可以保持正常写法：

```ts
import * as React from "react";
import { createRoot } from "react-dom/client";
```

为了让编辑器的 “Go to Definition” 进入 React 源码，而不是只进入
`@types/react`，项目内置了一个 TypeScript language-service plugin：
`react-source-definition-plugin`。它只改编辑器跳转结果，不接管 TypeScript 的类型
解析，所以类型仍然来自 `@types/react` / `@types/react-dom`。

VS Code 会通过 `.vscode/settings.json` 使用工作区内的 TypeScript SDK。首次打开时
如果看到 “Use Workspace Version” 提示，选择它；然后对 `useState`、`createRoot`、
`React.StrictMode` 等符号执行 “Go to Definition” 会跳到真实的
`react-source/packages/**` 子模块文件。

React 源码保存时会走 Vite HMR，而不是强制整页刷新。普通组件或 React public API
相关改动会尽量复用当前 root；`react-reconciler`、`react-dom-bindings`、commit /
render / work loop 等 renderer 内部改动会自动重新创建 root，让新的 Fiber /
reconcile / commit 代码生效。重新创建 root 前后，调试壳会尽量从 Fiber 上快照并恢复
函数组件的 `useState` / `useReducer` 状态，因此常见组件状态不会因为 React 源码 HMR
而丢失；复杂场景下仍以调试辅助为准，例如组件树结构大幅变化或自定义 Hook 顺序变化时
可能无法恢复。

## 配置 Dev Server

React 源码固定由当前项目里的 `./react-source` Git submodule 管理。Dev server
可通过环境变量调整监听地址：

```bash
REACT_SOURCE_DEBUG_HOST=0.0.0.0
REACT_SOURCE_DEBUG_PORT=4173
```

## 克隆项目

推荐用 `--recurse-submodules` 一次性克隆项目和 React 源码：

```bash
git clone --recurse-submodules https://github.com/Blithe-Chiang/react-source-debug.git
cd react-source-debug
```

如果已经用普通 `git clone` 克隆了项目，也可以在项目目录里补拉 React submodule：

```bash
git submodule update --init --recursive
```

React 源码会被放在当前项目的 `./react-source` 目录。

## 运行项目

```bash
npm install
npm run dev
```

启动后打开终端输出的地址，默认是：

```bash
http://127.0.0.1:5173/
```

需要检查类型或生产构建时可以运行：

```bash
npm run typecheck
npm run build
```

然后直接修改 `./react-source/packages/**` 里的源码，例如加 `console.log` 或 `debugger`，保存后会自动触发 HMR。

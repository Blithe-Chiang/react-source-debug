import { useMemo, useState } from "react";

export default function App() {
  const [count, setCount] = useState(0);
  const doubled = useMemo(() => count * 2, [count]);

  return (
    <main className="app">
      <div className="panel">
        <p className="eyebrow">React Source Debug</p>
        <h1>Vite 运行的是 react-source 里的源码</h1>
        <p className="description">
          现在可以直接在 <code>react-source/packages</code> 里加{" "}
          <code>console.log</code> 或 <code>debugger</code>
          ，刷新页面后观察运行时行为。
        </p>
        <div className="card">
          <button type="button" onClick={() => setCount((value) => value + 1)}>
            点击次数: {count}
          </button>
          <span>useMemo 结果: {doubled}</span>
        </div>
      </div>
    </main>
  );
}

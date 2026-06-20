import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

const root = createRoot(document.getElementById("root")!);

function render(AppComponent = App) {
  root.render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>,
  );
}

render();

if (import.meta.hot) {
  import.meta.hot.accept(["./App", "react", "react-dom/client"], ([nextApp]) => {
    render(nextApp?.default ?? App);
  });
}

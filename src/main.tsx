import * as React from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";
import {installReactSourceRuntimeHmr} from "./reactSourceRuntimeHmr";

const container = document.getElementById("root")!;
let root = createRoot(container);
let currentApp = App;

function render(AppComponent = currentApp) {
  currentApp = AppComponent;
  root.render(
    <React.StrictMode>
      <AppComponent />
    </React.StrictMode>,
  );
}

render();

installReactSourceRuntimeHmr({
  container,
  getRoot: () => root,
  setRoot: (nextRoot) => {
    root = nextRoot;
  },
  getApp: () => currentApp,
  render,
});

import * as React from "./react-source/react";
import { createRoot } from "./react-source/react-dom-client";
import App from "./App";
import "./index.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);

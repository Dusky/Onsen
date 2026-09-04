import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.tsx";
import "./styles/app.css";

const container = document.getElementById("root");
if (!container) throw new Error("missing #root");

createRoot(container).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

/**
 * The app shell's service worker (SPEC §16).
 *
 * Production only: in dev the worker does not exist, and one that did would
 * serve a stale shell over whatever was just edited. Failures are silent by
 * design — the worker caches the shell and nothing else, so an install that did
 * not happen costs an offline reload and nothing more.
 */
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    void navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}

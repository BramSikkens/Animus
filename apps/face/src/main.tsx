import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import "./style.css";

// Kiosk-mode (issue #122): geen scrollbalken/selectie, en de cursor verdwijnt na stilstand.
const IDLE_CURSOR_MS = 3000;
if (new URLSearchParams(window.location.search).has("kiosk")) {
  const root = document.documentElement;
  root.classList.add("kiosk", "idle");
  let idleTimer: ReturnType<typeof setTimeout>;
  window.addEventListener("mousemove", () => {
    root.classList.remove("idle");
    clearTimeout(idleTimer);
    idleTimer = setTimeout(() => root.classList.add("idle"), IDLE_CURSOR_MS);
  });
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

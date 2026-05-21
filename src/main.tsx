import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { setupPlatform } from "./lib/platform";

// Run before React renders so [data-platform] is set on the first paint.
setupPlatform();

const root = document.getElementById("root");
if (!root) {
  throw new Error("Root element #root not found in DOM");
}

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);

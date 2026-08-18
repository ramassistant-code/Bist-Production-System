import { createRoot } from "react-dom/client";
import App from "./App";
import "./index.css";

// Suppress ResizeObserver loop errors — these are benign browser errors that
// fire when Radix UI Popovers open inside Dialogs (the trigger element resizes
// during the open animation and hits the observer loop limit). They are NOT
// application errors and do not affect functionality. We intercept them in the
// capture phase so Vite's runtime-error overlay never sees them.
if (typeof window !== "undefined") {
  window.addEventListener(
    "error",
    (e) => {
      if (
        e.message?.includes("ResizeObserver") ||
        // null-error events from Radix focus-restoration in cross-origin iframe proxy
        (e.message == null && e.error == null)
      ) {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true, // capture phase — runs before Vite's handler
  );

  window.addEventListener(
    "unhandledrejection",
    (e) => {
      // Radix/cmdk sometimes rejects with null when closing a Popover inside a
      // Dialog while the component is still animating. Suppress silently.
      if (e.reason == null || e.reason === "") {
        e.stopImmediatePropagation();
        e.preventDefault();
      }
    },
    true,
  );
}

createRoot(document.getElementById("root")!).render(<App />);

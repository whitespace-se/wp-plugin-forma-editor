import React, { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";

/** The WordPress screen will own the container; reusable UI receives its data as props. */
export function mountEditor(container: HTMLElement, content: ReactNode) {
  const root = createRoot(container);
  root.render(<React.StrictMode>{content}</React.StrictMode>);
  return root;
}

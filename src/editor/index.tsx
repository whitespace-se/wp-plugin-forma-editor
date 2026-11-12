import React, { type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import "./tokens.css";
import "./layout.css";
import { apiFetch } from "../wordpress/api";
import { Editor, type EditorConfig } from "./Editor";

/** The WordPress screen will own the container; reusable UI receives its data as props. */
export function mountEditor(container: HTMLElement, content: ReactNode) {
  const root = createRoot(container);
  root.render(<React.StrictMode>{content}</React.StrictMode>);
  return root;
}

export function start(config: EditorConfig & { nonce: string }) {
  const container = document.getElementById("forma-editor-root");
  if (!container) return;

  apiFetch.use(apiFetch.createNonceMiddleware(config.nonce));
  mountEditor(container, <Editor {...config} />);
}

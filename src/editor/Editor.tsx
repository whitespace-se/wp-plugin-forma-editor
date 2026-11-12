import React, { useEffect, useState } from "react";
import { apiFetch } from "../wordpress/api";

export interface EditorConfig {
  postId: number;
  restPath: string;
  previewUrl: string;
  labels: {
    heading: string;
    title: string;
    preview: string;
    loading: string;
    error: string;
    retry: string;
  };
}

type TitleState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; value: string };

export function Editor({ postId, restPath, previewUrl, labels }: EditorConfig) {
  const [title, setTitle] = useState<TitleState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    const controller = new AbortController();
    setTitle({ status: "loading" });
    void apiFetch<{ id: number; title: { raw: string } }>({
      path: `${restPath}?context=edit&_fields=id,title`,
      signal: controller.signal,
    })
      .then((post) => {
        if (controller.signal.aborted) return;
        if (post.id !== postId || typeof post.title?.raw !== "string") {
          setTitle({ status: "error" });
          return;
        }
        setTitle({ status: "loaded", value: post.title.raw });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTitle({ status: "error" });
      });
    return () => controller.abort();
  }, [postId, restPath, attempt]);

  return (
    <div className="forma-editor__workspace">
      <iframe
        className="forma-editor__preview"
        src={previewUrl}
        title={labels.preview}
      />
      <aside className="forma-editor__panel" aria-labelledby="forma-heading">
        <h1 id="forma-heading">{labels.heading}</h1>
        <label htmlFor="forma-title">{labels.title}</label>
        <input
          id="forma-title"
          type="text"
          readOnly
          value={title.status === "loaded" ? title.value : ""}
          aria-busy={title.status === "loading"}
          aria-describedby={
            title.status !== "loaded" ? "forma-title-status" : undefined
          }
        />
        {title.status === "loading" && (
          <p id="forma-title-status" role="status">
            {labels.loading}
          </p>
        )}
        {title.status === "error" && (
          <div>
            <p id="forma-title-status" role="alert">
              {labels.error}
            </p>
            <button className="button" onClick={() => setAttempt(attempt + 1)}>
              {labels.retry}
            </button>
          </div>
        )}
      </aside>
    </div>
  );
}

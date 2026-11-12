import React, { useEffect, useRef, useState } from "react";
import { postTitle } from "../wordpress/api";

export interface EditorConfig {
  postId: number;
  restPath: string;
  previewUrl: string;
  labels: {
    context: string;
    heading: string;
    title: string;
    preview: string;
    loading: string;
    error: string;
    retry: string;
    save: string;
    saving: string;
    saved: string;
    saveError: string;
    authError: string;
  };
}

type TitleState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "loaded"; value: string };

export function Editor({ postId, restPath, previewUrl, labels }: EditorConfig) {
  const [title, setTitle] = useState<TitleState>({ status: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [savedTitle, setSavedTitle] = useState("");
  const [saveState, setSaveState] = useState<
    "idle" | "saving" | "saved" | "error" | "authError"
  >("idle");
  const [previewVersion, setPreviewVersion] = useState(0);
  const saving = useRef(false);
  const dirty = title.status === "loaded" && title.value !== savedTitle;

  useEffect(() => {
    if (!dirty) return;
    // Only attach while dirty: this is a best-effort browser exit warning,
    // not durable recovery when a mobile browser or process is terminated.
    const warn = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = true;
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty]);

  useEffect(() => {
    const controller = new AbortController();
    setTitle({ status: "loading" });
    setSaveState("idle");
    void postTitle(restPath, postId, undefined, controller.signal)
      .then((value) => {
        if (controller.signal.aborted) return;
        setSavedTitle(value);
        setTitle({ status: "loaded", value });
      })
      .catch(() => {
        if (!controller.signal.aborted) setTitle({ status: "error" });
      });
    return () => controller.abort();
  }, [postId, restPath, attempt]);

  async function save(event: React.FormEvent) {
    event.preventDefault();
    if (!dirty || saving.current || title.status !== "loaded") return;
    saving.current = true;
    setSaveState("saving");
    try {
      const value = await postTitle(restPath, postId, title.value);
      setSavedTitle(value);
      setTitle({ status: "loaded", value });
      setSaveState("saved");
      setPreviewVersion((version) => version + 1);
    } catch (error) {
      const failure = error as { code?: string; data?: { status?: number } };
      setSaveState(
        failure?.code === "rest_cookie_invalid_nonce" ||
          failure?.data?.status === 401 ||
          failure?.data?.status === 403
          ? "authError"
          : "error",
      );
    } finally {
      saving.current = false;
    }
  }

  return (
    <div className="forma-editor__workspace">
      <iframe
        key={`${postId}:${previewVersion}`}
        className="forma-editor__preview"
        src={previewUrl}
        title={labels.preview}
      />
      <aside className="forma-editor__panel" aria-labelledby="forma-heading">
        <form onSubmit={save}>
          <div className="forma-editor__actions">
            <span role="status">
              {saveState === "saved" ? labels.saved : ""}
            </span>
            <button
              type="submit"
              className="button button-primary"
              disabled={!dirty || saveState === "saving"}
            >
              {saveState === "saving" ? labels.saving : labels.save}
            </button>
          </div>
          <header className="forma-editor__panel-header">
            <p>{labels.context}</p>
            <h1 id="forma-heading">{labels.heading}</h1>
          </header>
          <div className="forma-editor__controls">
            <label htmlFor="forma-title">{labels.title}</label>
            <input
              id="forma-title"
              type="text"
              disabled={title.status !== "loaded"}
              readOnly={saveState === "saving"}
              onChange={(event) => {
                setTitle({ status: "loaded", value: event.target.value });
                setSaveState("idle");
              }}
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
                <button
                  type="button"
                  className="button"
                  onClick={() => setAttempt(attempt + 1)}
                >
                  {labels.retry}
                </button>
              </div>
            )}
            {(saveState === "error" || saveState === "authError") && (
              <p role="alert">
                {saveState === "authError"
                  ? labels.authError
                  : labels.saveError}
              </p>
            )}
          </div>
        </form>
      </aside>
    </div>
  );
}

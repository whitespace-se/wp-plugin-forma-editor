import React, { useEffect, useRef, useState } from "react";
import { workflow, type WorkflowState } from "../wordpress/api";
import { Autosave } from "./Autosave";

export interface EditorConfig {
  postId: number;
  workflowPath: string;
  ajaxUrl: string;
  lockNonce: string;
  previewUrl: string;
  labels: Record<string, string>;
}

export function Editor({
  postId,
  workflowPath,
  ajaxUrl,
  lockNonce,
  previewUrl,
  labels,
}: EditorConfig) {
  const [state, setState] = useState<WorkflowState>();
  const [restore, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [preview, setPreview] = useState({ url: previewUrl, version: 0 });
  const [, redraw] = useState(0);
  const queue = useRef<Autosave<WorkflowState>>();
  const current = useRef<WorkflowState>();
  const acting = useRef(false);
  const failedOperation = useRef<string>();
  const mounted = useRef(false);

  function adopt(next: WorkflowState, refresh = true) {
    current.current = next;
    setState(next);
    const view = document.querySelector<HTMLAnchorElement>(
      "#wp-admin-bar-view > a",
    );
    if (view) view.href = next.viewUrl;
    if (refresh)
      setPreview((old) => ({ url: next.previewUrl, version: old.version + 1 }));
  }

  function createQueue(value: string) {
    queue.current?.dispose();
    queue.current = new Autosave(
      value,
      (title) => workflow(workflowPath, "autosave", title),
      (next) => {
        if (mounted.current) adopt(next);
        return next.autosave?.title ?? next.title;
      },
      () => {
        if (mounted.current) redraw((n) => n + 1);
      },
    );
  }

  function release() {
    const lock = current.current?.lock;
    if (!lock) return;
    // Core compares the exact lock before expiring it. Beacon is best effort;
    // the normal WordPress timeout still applies after a terminated process.
    navigator.sendBeacon(
      ajaxUrl,
      new URLSearchParams({
        action: "wp-remove-post-lock",
        post_ID: String(postId),
        active_post_lock: lock,
        _wpnonce: lockNonce,
      }),
    );
  }

  async function act(operation: string) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    failedOperation.current = undefined;
    try {
      if (operation === "publish" || operation === "draft")
        await queue.current?.flush();
      const next = await workflow(workflowPath, operation);
      if (!mounted.current) return;
      adopt(next);
      if (operation === "open" || operation === "takeover") {
        const pending = Boolean(queue.current?.dirty);
        setRestore(Boolean(next.autosave) && !pending);
        if (!queue.current?.dirty) createQueue(next.title);
        else if (!next.lockOwner && !next.autosave?.otherChanges)
          queue.current.retry();
      } else {
        setRestore(false);
        createQueue(next.autosave?.title ?? next.title);
      }
      if (next.lockOwner && queue.current) queue.current.paused = true;
      else if (!next.autosave && queue.current?.dirty) queue.current.retry();
    } catch (failure) {
      failedOperation.current = operation;
      setError(
        (failure as { message?: string })?.message || labels.connectionError,
      );
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void act("open");
    let pulsing = false;
    const pulse = async () => {
      if (pulsing || acting.current || !current.current) return;
      pulsing = true;
      try {
        const next = await workflow(workflowPath, "pulse");
        if (!mounted.current) return;
        const regained = current.current?.lockOwner && !next.lockOwner;
        current.current = {
          ...current.current!,
          lock: next.lock,
          lockOwner: next.lockOwner,
        };
        setState(current.current);
        if (next.lockOwner && queue.current) queue.current.paused = true;
        if (regained) void act("open");
      } catch {
        /* Saves recheck the lock if its refresh fails. */
      } finally {
        pulsing = false;
      }
    };
    const visible = () => {
      if (document.visibilityState === "visible") void pulse();
    };
    const online = () => {
      void pulse();
      if (!current.current?.lockOwner) queue.current?.retry();
    };
    const warn = (event: BeforeUnloadEvent) => {
      if (!queue.current?.dirty && !queue.current?.busy && !acting.current)
        return;
      event.preventDefault();
      event.returnValue = true;
    };
    const navigate = async (event: MouseEvent) => {
      const anchor =
        event.target instanceof Element
          ? event.target.closest<HTMLAnchorElement>("a[href]")
          : null;
      if (
        !anchor ||
        anchor.target === "_blank" ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey ||
        (anchor.hash && anchor.pathname === location.pathname)
      )
        return;
      if (acting.current) {
        event.preventDefault();
        return;
      }
      if (!queue.current?.dirty && !queue.current?.busy) return;
      event.preventDefault();
      acting.current = true;
      setBusy(true);
      setError("");
      try {
        await queue.current.flush();
        acting.current = false;
        location.assign(anchor.href);
      } catch (failure) {
        setError(
          (failure as { message?: string })?.message || labels.connectionError,
        );
      } finally {
        acting.current = false;
        setBusy(false);
      }
    };
    const timer = setInterval(() => void pulse(), 15000);
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    window.addEventListener("pageshow", visible);
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      mounted.current = false;
      queue.current?.dispose();
      clearInterval(timer);
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
      window.removeEventListener("pageshow", visible);
      window.removeEventListener("pagehide", release);
      window.removeEventListener("beforeunload", warn);
      document.removeEventListener("click", navigate, true);
    };
  }, []);

  const saver = queue.current;
  const saveError = saver?.error as {
    message?: string;
    data?: { status?: number };
  } | null;
  const authError =
    saveError?.data?.status === 401 || saveError?.data?.status === 403;
  const disabled =
    busy ||
    !state ||
    Boolean(state.lockOwner) ||
    restore ||
    Boolean(state.autosave?.otherChanges);
  return (
    <div className="forma-editor__workspace">
      <iframe
        key={preview.version}
        className="forma-editor__preview"
        src={preview.url}
        title={labels.preview}
      />
      <aside className="forma-editor__panel" aria-labelledby="forma-heading">
        <div className="forma-editor__actions">
          <span role="status">
            {busy
              ? labels.working
              : saver?.error
                ? labels.unsaved
                : saver?.busy
                  ? labels.saving
                  : saver?.dirty
                    ? labels.unsaved
                    : state
                      ? labels.autosaved
                      : labels.loading}
          </span>
          {state?.canPublish && (
            <button
              className="button button-primary"
              disabled={
                disabled ||
                (state.status === "publish" && !state.autosave && !saver?.dirty)
              }
              onClick={() => void act("publish")}
            >
              {state.status === "draft" ? labels.publish : labels.update}
            </button>
          )}
        </div>
        <header className="forma-editor__panel-header">
          <p>{labels.context}</p>
          <h1 id="forma-heading">{labels.heading}</h1>
        </header>
        <div className="forma-editor__controls">
          {state && (
            <p>
              {state.status === "draft"
                ? labels.draftStatus
                : labels.publishedStatus}
            </p>
          )}
          {state?.lockOwner && (
            <div role="alert">
              <p>
                {labels.locked} {state.lockOwner}
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => void act("takeover")}
              >
                {labels.takeover}
              </button>
            </div>
          )}
          {(restore || state?.autosave?.otherChanges) && !state?.lockOwner && (
            <div>
              <p>{labels.restoreNotice}</p>
              {restore && (
                <button
                  className="button"
                  disabled={busy}
                  onClick={() => void act("resume")}
                >
                  {labels.resume}
                </button>
              )}{" "}
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  if (window.confirm(labels.discardConfirm))
                    void act("discard");
                }}
              >
                {labels.discard}
              </button>
            </div>
          )}
          {state?.autosave?.otherChanges && (
            <p role="alert">{labels.otherChanges}</p>
          )}
          <label htmlFor="forma-title">{labels.title}</label>
          <input
            id="forma-title"
            type="text"
            disabled={disabled}
            value={saver?.value ?? ""}
            onChange={(event) => saver?.edit(event.target.value)}
          />
          {(error || saveError) && (
            <div role="alert">
              <p>
                {error ||
                  (authError ? labels.authError : saveError?.message) ||
                  labels.connectionError}
              </p>
              <button
                className="button"
                disabled={busy}
                onClick={() => {
                  setError("");
                  if (failedOperation.current)
                    void act(failedOperation.current);
                  else if (!state) void act("open");
                  else saver?.retry();
                }}
              >
                {labels.retry}
              </button>
            </div>
          )}
          {state?.status === "publish" && state.canPublish && (
            <p>
              <button
                className="button"
                disabled={disabled}
                onClick={() => {
                  if (window.confirm(labels.draftConfirm)) void act("draft");
                }}
              >
                {labels.draft}
              </button>
            </p>
          )}
          {state?.revisionUrl && (
            <p>
              <a href={state.revisionUrl}>{labels.revisions}</a>
            </p>
          )}
        </div>
      </aside>
    </div>
  );
}

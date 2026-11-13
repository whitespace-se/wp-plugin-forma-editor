import React, { useEffect, useRef, useState } from "react";
import { workflow, type WorkflowState } from "../wordpress/api";
import { Autosave } from "./Autosave";
import { observePostLock } from "../wordpress/locks";
import { LockDialog } from "./LockDialog";
import { PublishControls } from "./PublishControls";

export interface EditorConfig {
  postId: number;
  workflowPath: string;
  ajaxUrl: string;
  lockNonce: string;
  previewUrl: string;
  returnUrl: string;
  labels: Record<string, string>;
}

export function Editor({
  postId,
  workflowPath,
  ajaxUrl,
  lockNonce,
  previewUrl,
  returnUrl,
  labels,
}: EditorConfig) {
  const [state, setState] = useState<WorkflowState>();
  const [restore, setRestore] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockError, setLockError] = useState(false);
  const [lostLock, setLostLock] = useState(false);
  const [preview, setPreview] = useState({ url: previewUrl, version: 0 });
  const [, redraw] = useState(0);
  const queue = useRef<Autosave<WorkflowState>>();
  const current = useRef<WorkflowState>();
  const acting = useRef(false);
  const failedOperation = useRef<string>();
  const mounted = useRef(false);
  const heartbeat = useRef<ReturnType<typeof observePostLock>>();
  const lockGeneration = useRef(0);
  const previewRequest = useRef(0);
  const previewDirty = useRef(false);

  function adopt(next: WorkflowState, refresh = true) {
    current.current = next;
    setState(next);
    const view = document.querySelector<HTMLAnchorElement>(
      "#wp-admin-bar-view > a",
    );
    if (view) view.href = next.viewUrl;
    if (refresh) {
      previewDirty.current = false;
      previewRequest.current++;
      setPreview((old) => ({ url: next.previewUrl, version: old.version + 1 }));
    }
  }

  function createQueue(value: string) {
    queue.current?.dispose();
    queue.current = new Autosave(
      value,
      (title) => workflow(workflowPath, "autosave", title),
      (next) => {
        if (mounted.current) {
          // An autosave response started before takeover must not clear a
          // newer Heartbeat lock-loss notification.
          adopt(
            current.current?.lockOwner
              ? { ...next, lockOwner: current.current.lockOwner, lock: null }
              : next,
            false,
          );
          previewDirty.current = true;
        }
        return next.autosave?.title ?? next.title;
      },
      () => {
        if (mounted.current) redraw((n) => n + 1);
      },
    );
  }

  async function refreshPreview() {
    const request = ++previewRequest.current;
    try {
      await queue.current?.flush();
      if (
        mounted.current &&
        !acting.current &&
        request === previewRequest.current &&
        previewDirty.current &&
        current.current
      ) {
        previewDirty.current = false;
        setPreview((old) => ({
          url: current.current!.previewUrl,
          version: old.version + 1,
        }));
      }
    } catch {
      /* The autosave status already shows the failure; keep the old preview. */
    }
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
    lockGeneration.current++;
    previewRequest.current++;
    setBusy(true);
    setError("");
    failedOperation.current = undefined;
    try {
      if (
        operation === "publish" ||
        operation === "draft" ||
        operation === "discard"
      )
        await queue.current?.flush();
      const next = await workflow(workflowPath, operation);
      if (!mounted.current) return;
      adopt(next);
      if (!next.lockOwner) setLostLock(false);
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
      heartbeat.current?.refresh();
      if (mounted.current) setBusy(false);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void act("open");
    heartbeat.current = observePostLock(
      postId,
      () =>
        !acting.current && current.current
          ? { lock: current.current.lock, generation: lockGeneration.current }
          : undefined,
      (reply) => {
        if (!mounted.current || !current.current) return;
        setLockError(false);
        if (reply.lock_error) {
          if (current.current.lock) setLostLock(true);
          current.current = {
            ...current.current,
            lock: null,
            lockOwner: reply.lock_error.name,
          };
          if (queue.current) queue.current.paused = true;
          previewRequest.current++;
          setState(current.current);
        } else if (reply.new_lock) {
          const regained = Boolean(current.current.lockOwner);
          current.current = {
            ...current.current,
            lock: reply.new_lock,
            lockOwner: null,
          };
          setState(current.current);
          if (regained) void act("open");
        }
      },
      () => {
        if (mounted.current) setLockError(true);
      },
    );
    const visible = () => {
      if (document.visibilityState === "visible") heartbeat.current?.refresh();
    };
    const online = () => {
      heartbeat.current?.refresh();
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
        anchor.hasAttribute("data-forma-leave-lock") ||
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
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", online);
    window.addEventListener("pageshow", visible);
    window.addEventListener("focus", visible);
    window.addEventListener("pagehide", release);
    window.addEventListener("beforeunload", warn);
    document.addEventListener("click", navigate, true);
    return () => {
      mounted.current = false;
      queue.current?.dispose();
      heartbeat.current?.dispose();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", online);
      window.removeEventListener("pageshow", visible);
      window.removeEventListener("focus", visible);
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
  const [actionsTarget, setActionsTarget] = useState<HTMLDivElement | null>(
    null,
  );
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
        <div className="forma-editor__actions" ref={setActionsTarget} />
        {(restore || state?.autosave?.otherChanges) && !state?.lockOwner && (
          <div className="notice notice-warning inline is-dismissible forma-editor__restore">
            <p>
              {labels.restoreNotice}{" "}
              {restore && (
                <button
                  className="button-link"
                  disabled={busy}
                  onClick={() => void act("resume")}
                >
                  {labels.restoreLink}
                </button>
              )}
            </p>
            <button
              className="notice-dismiss"
              aria-label={labels.discard}
              disabled={busy}
              onClick={() => {
                if (window.confirm(labels.discardConfirm)) void act("discard");
              }}
            />
          </div>
        )}
        <header className="forma-editor__panel-header">
          <p>{labels.context}</p>
          <h1 id="forma-heading">{labels.heading}</h1>
        </header>
        {state ? (
          <PublishControls
            key={state.status}
            status={state.status}
            changed={Boolean(state.autosave || saver?.dirty)}
            disabled={disabled}
            hasAutosave={Boolean(state.autosave)}
            canPublish={state.canPublish}
            revisionUrl={state.revisionUrl}
            actionsTarget={actionsTarget}
            saveStatus={
              busy
                ? labels.working
                : saver?.error
                  ? labels.unsaved
                  : saver?.busy
                    ? labels.saving
                    : saver?.dirty
                      ? labels.unsaved
                      : state
                        ? labels.autosaved
                        : labels.loading
            }
            labels={labels}
            commit={(operation) => void act(operation)}
            discard={() => {
              if (window.confirm(labels.discardConfirm)) void act("discard");
            }}
          />
        ) : (
          <p role="status">{labels.loading}</p>
        )}
        <div className="forma-editor__controls">
          {lockError && (
            <div className="notice notice-error inline">
              <p role="alert">{labels.lockConnectionError}</p>
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
            onChange={(event) => {
              previewRequest.current++;
              saver?.edit(event.target.value);
            }}
            onBlur={() => void refreshPreview()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void refreshPreview();
              }
            }}
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
        </div>
      </aside>
      <LockDialog
        owner={state?.lockOwner ?? null}
        lost={lostLock}
        busy={busy}
        error={error}
        viewUrl={state?.viewUrl ?? previewUrl}
        returnUrl={returnUrl}
        labels={labels}
        takeover={() => void act("takeover")}
      />
    </div>
  );
}

import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { workflow, type WorkflowState } from "../wordpress/api";
import { Autosave } from "./Autosave";
import { observePostLock } from "../wordpress/locks";
import { LockDialog } from "./LockDialog";
import { ContentEditor } from "./ContentEditor";
import { PanelResize } from "./PanelResize";
import { PublishControls } from "./PublishControls";
import { NavigationFields } from "./NavigationFields";

export interface EditorConfig {
  postId: number;
  editorMarkup: string;
  navigationMarkup?: string;
  workflowPath: string;
  ajaxUrl: string;
  lockNonce: string;
  previewUrl: string;
  returnUrl: string;
  classicUrl: string;
  labels: Record<string, string>;
}

export function Editor({
  postId,
  editorMarkup,
  navigationMarkup,
  workflowPath,
  ajaxUrl,
  lockNonce,
  previewUrl,
  returnUrl,
  classicUrl,
  labels,
}: EditorConfig) {
  const [section, setSection] = useState<string | null>(null);
  const [contentOpened, setContentOpened] = useState(false);
  const [navigationOpened, setNavigationOpened] = useState(false);
  const panelRef = useRef<HTMLElement>(null);
  const lastSection = useRef<string | null>(null);
  const sections = useMemo(() => {
    const document = new DOMParser().parseFromString(
      navigationMarkup ?? "",
      "text/html",
    );
    return Array.from(
      document.querySelectorAll(".forma-editor__acf-group"),
      (group, index) => ({
        id: String(index),
        label: group.querySelector("legend")?.textContent ?? labels.navigation,
        fields: Array.from(group.querySelectorAll("[data-key]"), (field) =>
          field.getAttribute("data-key"),
        ),
      }),
    );
  }, [navigationMarkup, labels.navigation]);
  const sectionLabel =
    section === "content"
      ? labels.mainContent
      : sections.find((item) => item.id === section)?.label;
  function navigate(next: string | null) {
    lastSection.current = section;
    if (next === "content") setContentOpened(true);
    else if (next !== null) setNavigationOpened(true);
    setSection(next);
    void refreshPreview();
  }
  useLayoutEffect(() => {
    const panel = panelRef.current;
    if (!panel) return;
    panel.scrollTop = 0;
    if (section !== null)
      panel
        .querySelector<HTMLElement>("#forma-current-section")
        ?.focus({ preventScroll: true });
    else if (lastSection.current !== null)
      panel
        .querySelector<HTMLElement>(`[data-section="${lastSection.current}"]`)
        ?.focus({ preventScroll: true });
  }, [section]);
  const [panelWidth, setPanelWidth] = useState(420);
  const panelTop = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const top = panelTop.current!;
    const panel = top.parentElement!;
    // Notices and wrapping labels change this offset independently of scroll.
    const measure = () =>
      panel.style.setProperty(
        "--forma-panel-top-height",
        `${top.getBoundingClientRect().height}px`,
      );
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(top);
    return () => observer.disconnect();
  }, []);
  const [resizing, setResizing] = useState(false);
  const [contentVersion, setContentVersion] = useState(0);
  const [state, setState] = useState<WorkflowState>();
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

  function createQueue(value: {
    title: string;
    content: string;
    navigation?: Record<string, string>;
  }) {
    setContentVersion((n) => n + 1);
    queue.current?.dispose();
    queue.current = new Autosave(
      JSON.stringify({
        title: value.title,
        content: value.content,
        navigation: value.navigation ?? {},
      }),
      (raw) => {
        const input = JSON.parse(raw);
        return workflow(
          workflowPath,
          "autosave",
          input.title,
          input.content,
          input.navigation,
        );
      },
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
        const resume = Boolean(
          next.autosave && !next.autosave.otherChanges && !next.lockOwner,
        );
        if (!pending) createQueue(resume ? next.autosave! : next);
        else if (!next.lockOwner && !next.autosave?.otherChanges)
          queue.current?.retry();
      } else {
        createQueue(next.autosave ?? next);
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
        anchor.closest(
          ".forma-editor__content, .forma-editor__navigation, .mce-container, .media-modal, #wp-link-wrap",
        ) ||
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
  const input: {
    title: string;
    content: string;
    navigation: Record<string, string>;
  } = saver
    ? JSON.parse(saver.value)
    : { title: "", content: "", navigation: {} };
  const editField = (
    field: "title" | "content" | "navigation",
    value: string | Record<string, string>,
  ) => {
    if (
      !queue.current ||
      acting.current ||
      current.current?.lockOwner ||
      current.current?.autosave?.otherChanges
    )
      return;
    previewRequest.current++;
    queue.current.edit(
      JSON.stringify({ ...JSON.parse(queue.current.value), [field]: value }),
    );
  };
  const saveError = saver?.error as {
    message?: string;
    data?: { status?: number; fields?: { input: string; message: string }[] };
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
    Boolean(state.autosave?.otherChanges);
  return (
    <div
      className={`forma-editor__workspace${resizing ? " forma-editor__workspace--resizing" : ""}`}
      style={{
        gridTemplateColumns: `minmax(0, 1fr) min(${panelWidth}px, 90vw)`,
      }}
    >
      <iframe
        key={preview.version}
        className="forma-editor__preview"
        src={preview.url}
        title={labels.preview}
      />
      <PanelResize
        width={panelWidth}
        label={labels.panelWidth}
        onChange={setPanelWidth}
        onDragging={setResizing}
      />
      <aside
        ref={panelRef}
        id="forma-panel"
        className="forma-editor__panel"
        aria-labelledby="forma-heading"
      >
        <div className="forma-editor__panel-top" ref={panelTop}>
          <header className="forma-editor__panel-header">
            <h1 id="forma-heading">
              {labels.context}:{" "}
              {section === null ? (
                labels.heading
              ) : (
                <>
                  <button
                    type="button"
                    className="button-link"
                    onClick={() => navigate(null)}
                  >
                    {labels.heading}
                  </button>
                  <span aria-hidden="true"> › </span>
                  <span id="forma-current-section" tabIndex={-1}>
                    {sectionLabel}
                  </span>
                </>
              )}
            </h1>
          </header>
          <div className="forma-editor__actions" ref={setActionsTarget} />
          {state?.autosave?.otherChanges && !state.lockOwner && (
            <div className="notice notice-warning inline forma-editor__restore">
              <p id="forma-autosave-blocked">{labels.otherChanges}</p>
              <p>
                <a href={classicUrl}>{labels.openClassic}</a>
              </p>
            </div>
          )}
        </div>
        {state ? (
          <PublishControls
            hidden={section !== null}
            key={state.status}
            status={state.status}
            changed={Boolean(state.autosave || saver?.dirty)}
            disabled={disabled}
            discardDisabled={busy || Boolean(state.lockOwner)}
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
        {section !== null && (
          <div className="forma-editor__back">
            <button
              type="button"
              className="button-link"
              onClick={() => navigate(null)}
            >
              <span aria-hidden="true">← </span>
              <span className="forma-editor__back-label">{labels.back}</span>
            </button>
          </div>
        )}
        <div
          className="forma-editor__section-list forma-editor__slide-back"
          hidden={section !== null}
        >
          {[{ id: "content", label: labels.mainContent }, ...sections].map(
            (item) => (
              <button
                type="button"
                key={item.id}
                data-section={item.id}
                className="accordion-section-title"
                onClick={() => navigate(item.id)}
              >
                {item.label}
                <span
                  className="dashicons dashicons-arrow-right-alt2"
                  aria-hidden="true"
                />
              </button>
            ),
          )}
        </div>
        <div
          className="forma-editor__controls forma-editor__slide-in"
          hidden={section !== "content"}
        >
          <label htmlFor="forma-title">{labels.title}</label>
          <input
            id="forma-title"
            aria-describedby={
              state?.autosave?.otherChanges
                ? "forma-autosave-blocked"
                : undefined
            }
            type="text"
            disabled={disabled}
            value={input.title}
            onChange={(event) => {
              editField("title", event.target.value);
            }}
            onBlur={() => void refreshPreview()}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void refreshPreview();
              }
            }}
          />
          {contentOpened && state && saver && (
            <ContentEditor
              key={contentVersion}
              markup={editorMarkup}
              initialContent={input.content}
              disabled={disabled}
              label={labels.content}
              errorLabel={labels.editorError}
              onChange={(value) => editField("content", value)}
              onLeave={() => void refreshPreview()}
            />
          )}
        </div>
        {(lockError || error || saveError) && (
          <div role="alert" className="notice notice-error inline">
            <p>
              {error ||
                (lockError ? labels.lockConnectionError : "") ||
                (authError ? labels.authError : saveError?.message) ||
                labels.connectionError}
            </p>
            {saveError?.data?.fields?.map((field) => {
              const key = /^acf\[([^\]]+)\]$/.exec(field.input)?.[1];
              const target = sections.find((item) =>
                item.fields.includes(key ?? ""),
              );
              return (
                target && (
                  <p key={field.input}>
                    <button
                      type="button"
                      className="button-link"
                      onClick={() => navigate(target.id)}
                    >
                      {target.label}: {field.message}
                    </button>
                  </p>
                )
              );
            })}
            <button
              className="button"
              disabled={busy}
              onClick={() => {
                setError("");
                if (failedOperation.current) void act(failedOperation.current);
                else if (!state) void act("open");
                else saver?.retry();
              }}
            >
              {labels.retry}
            </button>
          </div>
        )}
        <div hidden={section === null || section === "content"}>
          {navigationOpened && navigationMarkup && state && saver && (
            <NavigationFields
              activeGroup={section}
              key={contentVersion}
              markup={navigationMarkup}
              initialValues={input.navigation}
              disabled={disabled}
              label={labels.navigation}
              errorLabel={labels.navigationError}
              errors={saveError?.data?.fields}
              onChange={(value) => editField("navigation", value)}
              onLeave={() => void refreshPreview()}
            />
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

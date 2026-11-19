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
import { inlineMedia } from "./inlineMedia";
import { PublishControls } from "./PublishControls";
import { NavigationFields } from "./NavigationFields";
import type { PreviewBridge } from "./PreviewBridge";

export interface EditorConfig {
  postId: number;
  pageId: number;
  contextPath: string;
  wpautop: boolean;
  editorMarkup: string;
  navigationMarkup?: string;
  workflowPath: string;
  ajaxUrl: string;
  lockNonce: string;
  previewUrl: string;
  returnUrl: string;
  classicUrl: string;
  labels: Record<string, string>;
  modules?: { id: number; title: string; type: string; url: string | null }[];
  parentUrl?: string | null;
  moduleUsage?: number;
}

export interface SessionProps {
  bridge: PreviewBridge;
  contentBridge: PreviewBridge;
  initialSection?: string | null;
  onPreview: (url: string) => void;
  onSwitch: (module: number, section: string | null) => Promise<void>;
}

export function Editor({
  bridge,
  contentBridge,
  pageId,
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
  modules = [],
  parentUrl,
  wpautop,
  moduleUsage = 0,
  initialSection,
  onPreview,
  onSwitch,
}: EditorConfig & SessionProps) {
  const [section, setSection] = useState<string | null>(
    parentUrl ? "content" : (initialSection ?? null),
  );
  const [contentOpened, setContentOpened] = useState(
    Boolean(parentUrl) || initialSection === "content",
  );
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
    section === "modules"
      ? labels.modules
      : section === "content"
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
  const [contentVersion, setContentVersion] = useState(0);
  const [state, setState] = useState<WorkflowState>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [lockError, setLockError] = useState(false);
  const [lostLock, setLostLock] = useState(false);
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
      onPreview(next.previewUrl);
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
    if (bridge.editing || contentBridge.editing) return;
    const request = ++previewRequest.current;
    try {
      await queue.current?.flush();
      if (
        mounted.current &&
        !bridge.editing &&
        !contentBridge.editing &&
        !acting.current &&
        request === previewRequest.current &&
        previewDirty.current &&
        current.current
      ) {
        previewDirty.current = false;
        onPreview(current.current!.previewUrl);
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

  async function switchObject(module: number, section: string | null) {
    if (acting.current) return;
    acting.current = true;
    setBusy(true);
    setError("");
    previewRequest.current++;
    try {
      if (bridge.editing) await bridge.flush();
      await contentBridge.flush();
      await queue.current?.flush();
      await onSwitch(module, section);
      release();
    } catch (failure) {
      setError((failure as Error).message || labels.connectionError);
      return false;
    } finally {
      acting.current = false;
      if (mounted.current) setBusy(false);
    }
    return true;
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
      if (operation === "publish" || operation === "draft") {
        await contentBridge.flush();
        await bridge.flush();
      }
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
    inline = false,
  ) => {
    if (
      !queue.current ||
      (acting.current && !inline) ||
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
  useLayoutEffect(() => {
    bridge.configure({
      state: {
        pageId,
        postId,
        title: input.title,
        busy,
        writable: Boolean(
          state &&
          saver &&
          !state.lockOwner &&
          !state.autosave?.otherChanges &&
          !authError,
        ),
      },
      change: (title) => editField("title", title, true),
      select: async () => {
        if (!(await switchObject(0, "content")))
          throw new Error("Object switch failed");
      },
      leave: () => {
        void refreshPreview();
      },
    });
    contentBridge.configure({
      state: {
        pageId,
        postId,
        title: input.title,
        content: input.content,
        busy,
        writable: Boolean(
          state &&
          saver &&
          !state.lockOwner &&
          !state.autosave?.otherChanges &&
          !authError,
        ),
      },
      change: (content) => editField("content", content, true),
      select: async () => {
        if (!(await switchObject(0, "content")))
          throw new Error("Object switch failed");
      },
      panel: () => {
        if (postId === pageId) navigate("content");
        else void switchObject(0, "content");
      },
      media: inlineMedia,
      leave: () => {
        void refreshPreview();
      },
    });
  });
  return (
    <>
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
              {parentUrl ? (
                <>
                  <button
                    type="button"
                    className="button-link"
                    disabled={busy}
                    onClick={() => void switchObject(0, null)}
                  >
                    {labels.modulePage}
                  </button>
                  <span aria-hidden="true"> › </span>
                  <button
                    type="button"
                    className="button-link"
                    disabled={busy}
                    onClick={() => void switchObject(0, "modules")}
                  >
                    {labels.modules}
                  </button>
                  <span aria-hidden="true"> › </span>
                  <span id="forma-current-section" tabIndex={-1}>
                    {labels.heading}
                  </span>
                </>
              ) : section === null ? (
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
            hidden={!parentUrl && section !== null}
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
            {parentUrl ? (
              <button
                type="button"
                className="button-link"
                disabled={busy}
                onClick={() => void switchObject(0, "modules")}
              >
                <span aria-hidden="true">← </span>
                <span className="forma-editor__back-label">{labels.back}</span>
              </button>
            ) : (
              <button
                type="button"
                className="button-link"
                onClick={() => navigate(null)}
              >
                <span aria-hidden="true">← </span>
                <span className="forma-editor__back-label">{labels.back}</span>
              </button>
            )}
          </div>
        )}
        {parentUrl && moduleUsage > 1 && (
          <div className="notice notice-info inline">
            <p>{labels.moduleShared}</p>
          </div>
        )}
        <div
          className="forma-editor__section-list forma-editor__slide-back"
          hidden={section !== null}
        >
          {[
            { id: "content", label: labels.mainContent },
            ...sections,
            ...(modules.length
              ? [{ id: "modules", label: labels.modules }]
              : []),
          ].map((item) => (
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
          ))}
        </div>
        {section === "modules" && (
          <div className="forma-editor__section-list forma-editor__slide-in">
            {modules.map((module) =>
              module.url ? (
                <button
                  type="button"
                  disabled={busy}
                  className="accordion-section-title"
                  key={module.id}
                  onClick={() => void switchObject(module.id, "content")}
                >
                  <span>
                    {module.title}
                    <small className="forma-editor__module-type">
                      {module.type}
                    </small>
                  </span>
                  <span
                    className="dashicons dashicons-arrow-right-alt2"
                    aria-hidden="true"
                  />
                </button>
              ) : (
                <div className="accordion-section-title" key={module.id}>
                  <span>
                    {module.title}
                    <small className="forma-editor__module-type">
                      {module.type}
                    </small>
                  </span>
                </div>
              ),
            )}
          </div>
        )}
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
              wpautop={wpautop}
              initialContent={input.content}
              disabled={disabled}
              label={labels.content}
              errorLabel={labels.editorError}
              onChange={(value) => editField("content", value)}
              onLeave={() => void refreshPreview()}
              beforeEnter={() => {
                if (!contentBridge.editing) return null;
                return contentBridge.flush().catch((failure: Error) => {
                  setError(failure.message);
                  throw failure;
                });
              }}
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
        <div
          hidden={
            section === null || section === "content" || section === "modules"
          }
        >
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
    </>
  );
}

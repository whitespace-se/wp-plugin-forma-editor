import React, {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createRoot } from "react-dom/client";
import { createPortal } from "react-dom";
import { observeInsertionSize } from "./insertion-size";
import "./style.css";

// The installed WordPress owns these packages and React. Do not bundle a second
// Gutenberg version or depend on the complete post editor's global stores.
type Component = React.ComponentType<any>;
type Block = {
  name: string;
  isValid: boolean;
  innerBlocks: Block[];
  clientId: string;
};
type Config = {
  pageId: number;
  origin: string;
  nonce: string;
  settings: Record<string, any>;
  categories: unknown[];
};
type State = {
  pageId: number;
  postId: number;
  content: string;
  writable: boolean;
  busy: boolean;
  acknowledged: number;
};
type WP = {
  blocks: {
    parse: (s: string) => Block[];
    serialize: (b: Block[]) => string;
    setCategories: (c: unknown[]) => void;
    getBlockType: (n: string) => unknown;
  };
  blockLibrary: { registerCoreBlocks: () => void };
  blockEditor: Record<string, Component>;
  components: Record<string, any>;
  data: { useSelect: (callback: (select: any) => any, deps: unknown[]) => any };
  hooks: {
    addFilter: (name: string, namespace: string, fn: () => Component) => void;
  };
  apiFetch: {
    use: (middleware: unknown) => void;
    createNonceMiddleware: (nonce: string) => unknown;
  };
  media: any;
};
const wp = (window as unknown as { wp: WP }).wp;
const allowed = new Set([
  "core/paragraph",
  "core/heading",
  "core/list",
  "core/list-item",
  "core/image",
]);
export function supported(blocks: Block[]): boolean {
  return blocks.every(
    (block) =>
      allowed.has(block.name) &&
      block.isValid !== false &&
      supported(block.innerBlocks),
  );
}

class Boundary extends React.Component<
  { children: React.ReactNode; failure: () => void },
  { failed: boolean }
> {
  state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  componentDidCatch(error: Error) {
    console.error("Forma block editor", error);
    this.props.failure();
  }
  render() {
    return this.state.failed ? null : this.props.children;
  }
}

export function start(
  previewWindow: Window,
  config: Config,
  transmit: (message: unknown, origin: string) => void,
) {
  const hostDocument = globalThis.document;
  const window = previewWindow;
  const document = window.document;
  const parent = window.parent;
  // Same-origin documents share one host-owned React/Gutenberg instance.
  // Portals retain the provider/store while keeping all tools outside scaling.
  if (document.location.origin !== hostDocument.location.origin) return;
  const install = () => {
    const matches = document.querySelectorAll<HTMLElement>(
      `#forma-block-content[data-forma-post="${config.pageId}"]`,
    );
    if (matches.length !== 1 || parent === window) return;
    const area = matches[0];
    const rendered = area.querySelector<HTMLElement>("[data-forma-rendered]")!;
    const mount = area.querySelector<HTMLElement>("[data-forma-block-mount]")!;
    const tools = hostDocument.getElementById("forma-block-tools")!;
    const settingsTarget = hostDocument.getElementById("forma-block-settings")!;
    if (!tools || !settingsTarget) return;
    const root = createRoot(mount);
    const documentId = crypto.randomUUID();
    let sequence = 0;
    let state: State | undefined;
    let active = false;
    let mediaOpen = false;
    let composing = false;
    let valid = true;
    let current = "";
    let pendingFlush: string | undefined;
    let readyTimer: ReturnType<typeof setInterval>;
    const outline = document.createElement("div");
    outline.className = "forma-block-outline";
    outline.setAttribute("aria-hidden", "true");
    outline.hidden = true;
    document.body.append(outline);
    const notice = document.createElement("p");
    notice.setAttribute("role", "alert");
    notice.className = "forma-block-notice";
    notice.hidden = true;
    area.before(notice);
    const send = (type: string, extra: Record<string, unknown> = {}) =>
      transmit(
        {
          channel: "forma-content",
          version: 1,
          documentId,
          sequence: ++sequence,
          type,
          ...extra,
        },
        config.origin,
      );
    const failure = () => {
      active = false;
      rendered.hidden = false;
      area.dataset.formaBlockActive = "false";
      outline.dataset.editing = "false";
      notice.textContent =
        "Blockeditorn kunde inte startas. Innehållet har inte ersatts. Ladda om för att försöka igen.";
      notice.hidden = false;
      send("end", { content: current });
    };
    const finish = (requestId?: string) => {
      if (mediaOpen || composing || !valid) {
        if (requestId) send("blocked", { requestId });
        return;
      }
      if (!active) {
        if (requestId) send("flushed", { requestId, content: current });
        return;
      }
      active = false;
      root.render(null);
      rendered.hidden = false;
      area.dataset.formaBlockActive = "false";
      outline.dataset.editing = "false";
      send(requestId ? "flushed" : "end", { content: current, requestId });
    };
    const owns = (target: EventTarget | null) =>
      target !== null &&
      "nodeType" in target &&
      (target as Node).nodeType === 1 &&
      Boolean(
        area.contains(target as Node) ||
        tools.contains(target as Node) ||
        settingsTarget.contains(target as Node) ||
        (target as Element).closest(
          ".components-popover, .components-modal__screen-overlay, .media-modal, .media-modal-backdrop",
        ),
      );

    function MediaUpload(props: any) {
      const frame = useRef<any>();
      useEffect(
        () => () => {
          frame.current?.remove();
          mediaOpen = false;
        },
        [],
      );
      return props.render({
        open: () => {
          frame.current?.remove();
          frame.current = wp.media({
            title: "Välj bild",
            library: { type: props.allowedTypes ?? ["image"] },
            multiple: props.multiple ?? false,
          });
          frame.current.on("open", () => {
            mediaOpen = true;
            const selection = frame.current.state().get("selection");
            for (const id of [props.value].flat().filter(Boolean))
              selection.add(wp.media.attachment(id));
          });
          frame.current.on("select", () => {
            const items = frame.current.state().get("selection").toJSON();
            props.onSelect(props.multiple ? items : items[0]);
          });
          // Core may emit close before select. Do not tear down the editor until
          // the selection callback has delivered the attachment to the image block.
          frame.current.on("close", () =>
            setTimeout(() => {
              mediaOpen = false;
            }, 0),
          );
          frame.current.open();
        },
      });
    }

    function CanvasInsertionSize() {
      const { previous, next } = wp.data.useSelect((select) => {
        const store = select("core/block-editor");
        const point = store.getBlockInsertionPoint();
        const order = store.getBlockOrder(point.rootClientId);
        return {
          previous: order[point.index - 1],
          next: order[point.index],
        };
      }, []);
      useLayoutEffect(() => {
        const block = (id?: string) =>
          id ? mount.querySelector<HTMLElement>(`[data-block="${id}"]`) : null;
        return observeInsertionSize(mount, block(previous), block(next));
      }, [previous, next]);
      return null;
    }

    function Editor({ initial }: { initial: Block[] }) {
      const [blocks, setBlocks] = useState(initial);
      const [inspector, setInspector] = useState(false);
      const [invalid, setInvalid] = useState(false);
      const history = useRef({ values: [initial], index: 0, time: 0 });
      const original = useRef({
        source: current,
        canonical: wp.blocks.serialize(initial),
      });
      const {
        BlockEditorProvider,
        BlockList,
        BlockTools,
        WritingFlow,
        ObserveTyping,
        BlockInspector,
        BlockToolbar,
        Inserter,
        BlockEditorKeyboardShortcuts,
      } = wp.blockEditor;
      const { SlotFillProvider, Popover, Button } = wp.components;
      const settings = useMemo(
        () => ({
          ...config.settings,
          allowedBlockTypes: [...allowed],
          hasFixedToolbar: true,
        }),
        [],
      );
      const deliver = (next: Block[]) => {
        valid = supported(next);
        setInvalid(!valid);
        if (!valid) return;
        const serialized = wp.blocks.serialize(next);
        current =
          serialized === original.current.canonical
            ? original.current.source
            : serialized;
        send("change", { content: current });
      };
      const update = (next: Block[]) => {
        if (!state?.writable || state.postId !== config.pageId) return;
        setBlocks(next);
        if (!supported(next)) {
          valid = false;
          setInvalid(true);
          return;
        }
        const h = history.current;
        const previous = h.values[h.index];
        if (wp.blocks.serialize(previous) !== wp.blocks.serialize(next)) {
          const now = Date.now();
          if (h.index > 0 && now - h.time < 700) h.values[h.index] = next;
          else {
            h.values = h.values.slice(0, h.index + 1);
            h.values.push(next);
            h.index++;
          }
          h.time = now;
        }
        deliver(next);
      };
      const undo = (direction: number) => {
        const h = history.current;
        const index = h.index + direction;
        if (index < 0 || index >= h.values.length) return;
        h.index = index;
        h.time = 0;
        setBlocks(h.values[index]);
        deliver(h.values[index]);
      };
      useLayoutEffect(() => {
        rendered.hidden = true;
        outline.dataset.editing = "true";
        mount
          .querySelector<HTMLElement>('[contenteditable="true"]')
          ?.focus({ preventScroll: true });
        return () => {
          rendered.hidden = false;
        };
      }, []);
      return (
        <SlotFillProvider>
          <BlockEditorProvider
            value={blocks}
            onInput={update}
            onChange={update}
            settings={settings}
          >
            <div
              className="forma-block-editor"
              onKeyDownCapture={(event) => {
                if (
                  (event.ctrlKey || event.metaKey) &&
                  event.key.toLowerCase() === "z" &&
                  !event.nativeEvent.isComposing
                ) {
                  event.preventDefault();
                  event.stopPropagation();
                  undo(event.shiftKey ? 1 : -1);
                }
              }}
            >
              {createPortal(
                <div
                  className="forma-block-toolbar"
                  role="region"
                  aria-label="Innehållsverktyg"
                >
                  <Inserter />
                  <Button
                    onClick={() => undo(-1)}
                    disabled={history.current.index === 0}
                  >
                    Ångra
                  </Button>
                  <Button
                    onClick={() => undo(1)}
                    disabled={
                      history.current.index ===
                      history.current.values.length - 1
                    }
                  >
                    Gör om
                  </Button>
                  <Button
                    isPressed={inspector}
                    onClick={() => setInspector(!inspector)}
                  >
                    Blockinställningar
                  </Button>
                  <BlockToolbar />
                </div>,
                tools,
              )}
              {inspector &&
                createPortal(
                  <div
                    className="forma-block-inspector"
                    role="region"
                    aria-label="Blockinställningar"
                  >
                    <Button onClick={() => setInspector(false)}>
                      Stäng blockinställningar
                    </Button>
                    <BlockInspector />
                  </div>,
                  settingsTarget,
                )}
              {invalid && (
                <p role="alert">
                  Blocket stöds inte i detta prov. Ångra ändringen innan du
                  fortsätter.
                </p>
              )}
              <BlockEditorKeyboardShortcuts />
              <BlockTools>
                <WritingFlow>
                  <ObserveTyping>
                    <div className="editor-styles-wrapper">
                      <BlockList />
                    </div>
                  </ObserveTyping>
                </WritingFlow>
              </BlockTools>
              <CanvasInsertionSize />
            </div>
            {createPortal(<Popover.Slot />, tools)}
          </BlockEditorProvider>
        </SlotFillProvider>
      );
    }

    const begin = () => {
      if (active || !state?.writable || state.busy) return;
      send("begin");
    };
    const activate = () => {
      if (
        active ||
        !state?.writable ||
        state.busy ||
        state.postId !== config.pageId
      )
        return;
      current = state.content;
      const blocks = wp.blocks.parse(current);
      if (!supported(blocks)) {
        notice.textContent =
          "Innehållet innehåller block som inte stöds i detta prov. Originalet är oförändrat.";
        notice.hidden = false;
        send("end", { content: current });
        return;
      }
      notice.hidden = true;
      active = true;
      valid = true;
      area.dataset.formaBlockActive = "true";
      root.render(
        <Boundary failure={failure}>
          <Editor initial={blocks} />
        </Boundary>,
      );
    };
    try {
      if (!wp.blocks.getBlockType("core/paragraph"))
        wp.blockLibrary.registerCoreBlocks();
      wp.blocks.setCategories(config.categories);
      wp.apiFetch.use(wp.apiFetch.createNonceMiddleware(config.nonce));
      wp.hooks.addFilter(
        "editor.MediaUpload",
        "forma/block-trial",
        () => MediaUpload,
      );
    } catch (error) {
      console.error(error);
      failure();
      return;
    }

    area.addEventListener("click", (event) => {
      if (!active && !mount.contains(event.target as Node)) {
        event.preventDefault();
        event.stopPropagation();
        begin();
      }
    });
    area.addEventListener("keydown", (event) => {
      if (!active && (event.key === "Enter" || event.key === " ")) {
        event.preventDefault();
        begin();
      }
    });
    area.addEventListener("pointerenter", () => {
      outline.dataset.hover = "true";
    });
    area.addEventListener("pointerleave", () => {
      outline.dataset.hover = "false";
    });
    area.addEventListener("compositionstart", () => {
      composing = true;
    });
    area.addEventListener("compositionend", () => {
      composing = false;
      if (pendingFlush) {
        const id = pendingFlush;
        pendingFlush = undefined;
        setTimeout(() => finish(id), 0);
      }
    });
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (active && !owns(event.target)) finish();
      },
      true,
    );
    window.addEventListener("forma:title-start", () => finish());
    // The guard runs before theme handlers and blocks outside pointer events.
    // It forwards this intent before stopping propagation.
    window.addEventListener("forma:outside-editor", () => {
      if (active) finish();
    });
    window.addEventListener("blur", () => {
      if (active && !mediaOpen)
        setTimeout(() => {
          if (!document.hasFocus() && !owns(hostDocument.activeElement))
            finish();
        }, 0);
    });
    window.addEventListener("message", (event) => {
      const data = event.data;
      if (
        event.source !== parent ||
        event.origin !== config.origin ||
        !data ||
        data.channel !== "forma-content" ||
        data.version !== 1 ||
        data.documentId !== documentId
      )
        return;
      if (data.type === "state") {
        if (
          data.pageId !== config.pageId ||
          typeof data.content !== "string" ||
          typeof data.writable !== "boolean" ||
          typeof data.busy !== "boolean"
        )
          return;
        const next = data as State;
        state = next;
        clearInterval(readyTimer);
        area.dataset.formaBlockUi = "true";
        area.tabIndex = next.writable ? 0 : -1;
        area.setAttribute("aria-label", "Redigera huvudinnehåll");
        outline.hidden = !next.writable;
        // Preserve unsaved local content after lock loss, but stop all editing.
        mount.inert = !next.writable || next.postId !== config.pageId;
        tools.inert = mount.inert;
        settingsTarget.inert = mount.inert;
        if (!active && data.acknowledged >= sequence) current = data.content;
      } else if (data.type === "begin") activate();
      else if (data.type === "flush" && typeof data.requestId === "string") {
        if (composing) pendingFlush = data.requestId;
        else finish(data.requestId);
      }
    });
    send("ready", { pageId: config.pageId });
    readyTimer = setInterval(
      () => send("ready", { pageId: config.pageId }),
      500,
    );
    const hostOutside = (event: Event) => {
      if (active && !owns(event.target) && event.target !== window.frameElement)
        finish();
    };
    hostDocument.addEventListener("pointerdown", hostOutside, true);
    window.addEventListener(
      "pagehide",
      () => {
        clearInterval(readyTimer);
        root.unmount();
        hostDocument.removeEventListener("pointerdown", hostOutside, true);
        tools.inert = false;
        settingsTarget.inert = false;
      },
      { once: true },
    );
  };
  if (document.readyState === "loading")
    document.addEventListener("DOMContentLoaded", install, { once: true });
  else install();
}

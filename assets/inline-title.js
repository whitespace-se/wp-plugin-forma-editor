(() => {
  const config = JSON.parse(document.currentScript.dataset.config);
  const documentId = crypto.randomUUID();
  let sequence = 0;
  let title, overlay, state;
  let editing = false;
  let startValue = "";
  let composing = false;
  let suppressFocus = false;
  let flushRequest = null;
  const send = (type, extra = {}) =>
    parent.postMessage(
      {
        channel: "forma-title",
        version: 1,
        documentId,
        sequence: ++sequence,
        type,
        ...extra,
      },
      config.origin,
    );
  const value = () => (title.textContent || "").replace(/[\r\n]+/g, " ");
  const display = (text) => {
    if (title.textContent !== text) title.textContent = text;
    title.dataset.empty = String(!text);
  };
  const paint = () => {
    title.dataset.formaEditing = String(editing);
    overlay.dataset.editing = String(editing);
    const editable =
      editing && state?.writable && state.postId === config.pageId
        ? "plaintext-only"
        : "false";
    if (title.contentEditable !== editable) title.contentEditable = editable;
    title.setAttribute("aria-readonly", String(!state?.writable));
  };
  const begin = () => {
    if (!state?.writable || state.busy || editing) return;
    if (state.postId === config.pageId) {
      editing = true;
      startValue = value();
      paint();
    }
    send("begin");
  };
  const finish = (cancel = false, releaseFocus = false) => {
    if (!editing || composing) return;
    if (cancel) display(startValue);
    editing = false;
    paint();
    if (releaseFocus) title.blur();
    send("end", { title: value() });
  };
  const flushed = (requestId) => {
    if (composing) {
      flushRequest = requestId;
      return;
    }
    editing = false;
    paint();
    send("flushed", { title: value(), requestId });
  };

  window.addEventListener("message", (event) => {
    const data = event.data;
    if (
      event.source !== parent ||
      event.origin !== config.origin ||
      !title ||
      !data ||
      data.channel !== "forma-title" ||
      data.version !== 1 ||
      data.documentId !== documentId
    )
      return;
    if (data.type === "state") {
      if (
        data.pageId !== config.pageId ||
        typeof data.title !== "string" ||
        typeof data.writable !== "boolean" ||
        typeof data.busy !== "boolean"
      )
        return;
      const wasWritable = state?.writable;
      state = data;
      clearInterval(readyTimer);
      // Ignore echoed state older than local input. Never replace active text:
      // that would reset the caret and the browser's native undo history.
      if (
        !editing &&
        !composing &&
        data.postId === config.pageId &&
        data.acknowledged >= sequence
      )
        display(data.title);
      if (!data.writable && wasWritable) editing = false;
      paint();
      overlay.hidden = !data.writable;
      title.tabIndex = data.writable ? 0 : -1;
    } else if (
      data.type === "begin" &&
      state?.writable &&
      state.postId === config.pageId
    ) {
      if (!editing) {
        startValue = value();
        editing = true;
      }
      paint();
      suppressFocus = true;
      title.focus({ preventScroll: true });
      suppressFocus = false;
    } else if (data.type === "flush" && typeof data.requestId === "string") {
      flushed(data.requestId);
    }
  });
  window.addEventListener("blur", () => finish());

  // Runs before the preview guard and theme handlers. Preserve native selection,
  // editing and undo only within this explicitly identified field.
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
    "click",
    "dblclick",
    "contextmenu",
    "keydown",
    "keyup",
    "keypress",
    "beforeinput",
    "input",
    "paste",
    "compositionstart",
    "compositionend",
    "focusin",
    "focusout",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        if (
          type === "pointerdown" &&
          title &&
          !event.composedPath().includes(title)
        )
          finish();
        if (!title || !event.composedPath().includes(title)) return;
        event.stopImmediatePropagation();
        if (!state?.writable) {
          if (type === "beforeinput") event.preventDefault();
          return;
        }
        if (type === "focusin") {
          if (!suppressFocus) begin();
        }
        if (type === "click") begin();
        if (type === "compositionstart") {
          composing = true;
          begin();
        }
        if (type === "compositionend") {
          composing = false;
          title.dataset.empty = String(!value());
          send("change", { title: value() });
          if (flushRequest) {
            const id = flushRequest;
            flushRequest = null;
            flushed(id);
          } else if (document.activeElement !== title) finish();
        }
        if (type === "keydown" && !event.isComposing && !composing) {
          if (event.key === "Enter") {
            event.preventDefault();
            if (editing) finish(false, true);
            else begin();
          } else if (event.key === "Escape") {
            event.preventDefault();
            finish(true, true);
          }
        }
        if (type === "beforeinput") {
          if (state.postId !== config.pageId || state.busy || !editing)
            event.preventDefault();
          if (
            event.inputType === "insertParagraph" ||
            event.inputType === "insertLineBreak"
          )
            event.preventDefault();
        }
        if (type === "paste") {
          const text = event.clipboardData?.getData("text/plain");
          // plaintext-only strips markup natively. Intercept multiline paste only
          // to keep the post title single-line without making a rich text editor.
          if (text && /[\r\n]/.test(text)) {
            event.preventDefault();
            if (!editing) return;
            const selection = window.getSelection();
            if (!selection?.rangeCount) return;
            const range = selection.getRangeAt(0);
            range.deleteContents();
            const node = document.createTextNode(text.replace(/[\r\n]+/g, " "));
            range.insertNode(node);
            range.setStartAfter(node);
            range.collapse(true);
            selection.removeAllRanges();
            selection.addRange(range);
            send("change", { title: value() });
            title.dataset.empty = String(!value());
          }
        }
        if (type === "input" && editing && !composing) {
          title.dataset.empty = String(!value());
          send("change", { title: value() });
        }
        if (type === "focusout") {
          finish();
        }
      },
      true,
    );
  }
  let readyTimer;
  document.addEventListener("DOMContentLoaded", () => {
    if (
      !CSS.supports("anchor-name: --forma-title") ||
      !CSS.supports("top: anchor(top)") ||
      !CSS.supports("position-anchor: --forma-title") ||
      !CSS.supports("width: anchor-size(width)")
    )
      return;
    const matches = document.querySelectorAll("h1#page-title");
    if (matches.length !== 1) return;
    title = matches[0];
    title.dataset.formaTitle = "";
    title.dataset.placeholder = config.placeholder;
    title.setAttribute("role", "textbox");
    title.setAttribute("aria-label", config.label);
    title.setAttribute("aria-multiline", "false");
    title.tabIndex = -1;
    overlay = document.createElement("div");
    overlay.className = "forma-inline-title-outline";
    overlay.setAttribute("aria-hidden", "true");
    overlay.hidden = true;
    document.body.append(overlay);
    title.addEventListener("pointerenter", () => {
      overlay.dataset.hover = "true";
    });
    title.addEventListener("pointerleave", () => {
      overlay.dataset.hover = "false";
    });
    send("ready", { pageId: config.pageId });
    readyTimer = setInterval(
      () => send("ready", { pageId: config.pageId }),
      500,
    );
  });
})();

(() => {
  const config = JSON.parse(document.currentScript.dataset.config);
  const documentId = crypto.randomUUID();
  const policy = window.formaContentPolicy;
  let sequence = 0,
    state,
    surface,
    outline,
    tools,
    message;
  let editor,
    editing = false,
    starting = false,
    composing = false;
  let original = "",
    baseline = "",
    last = "",
    rendered;
  let mediaRequest = null,
    bookmark,
    flushRequest = null,
    readyTimer;
  let startTimer,
    generation = 0;
  const send = (type, extra = {}) =>
    parent.postMessage(
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
  const writable = () => state?.writable && state.postId === config.pageId;
  const dialogOpen = () =>
    Boolean(document.querySelector('.mce-window[role="dialog"]'));
  const owned = (target) =>
    target instanceof Element &&
    Boolean(
      surface?.contains(target) ||
      tools?.contains(target) ||
      ((editing || starting) &&
        target.closest(".mce-container, .mce-widget, #mce-modal-block")),
    );
  // The preview guard otherwise blocks all controls at window capture. Only
  // this explicitly owned editor island and its chrome receive native events.
  window.formaInlineContentOwns = (event) => {
    if (surface?.contains(event.target) && !editing) {
      if (
        event.type === "click" ||
        (event.type === "keydown" && ["Enter", " "].includes(event.key))
      )
        begin();
      // Generated controls in an unsupported field remain guarded. Only the
      // validated source island may receive native editing interactions.
      return false;
    }
    return owned(event.target);
  };
  const error = (text) => {
    message.textContent = text;
    message.hidden = !text;
    tools.hidden = false;
  };
  const canEdit = () =>
    Boolean(
      surface &&
      window.tinymce &&
      window.wp?.editor?.autop &&
      CSS.supports("position-anchor", "--forma-content") &&
      CSS.supports("top", "anchor(top)") &&
      policy.safe(state?.content),
    );
  const paint = () => {
    if (!surface) return;
    surface.tabIndex = state?.writable ? 0 : -1;
    surface.setAttribute("aria-readonly", String(!editing));
    outline.hidden = !state?.writable;
    outline.dataset.editing = String(editing);
    tools.hidden = !editing && !message.textContent;
    tools.querySelector(".forma-add-media").disabled =
      !editing || !writable() || state.busy;
    editor?.setMode(
      writable() && !state.busy && editing ? "design" : "readonly",
    );
  };
  const value = () => {
    const html = editor.getContent();
    return html === baseline ? original : html;
  };
  const emit = () => {
    if (!editing || composing || !writable()) return true;
    const content = value();
    if (!policy.safe(content)) {
      error(
        "Den här ändringen stöds inte inline. Ångra ändringen för att fortsätta eller kopiera den till panelen.",
      );
      return false;
    }
    if (content !== last) {
      last = content;
      state = { ...state, content };
      send("change", { content });
    }
    return true;
  };
  const finish = (requestId = null) => {
    if (starting || composing) {
      flushRequest = requestId || "leave";
      return;
    }
    if (mediaRequest || dialogOpen()) {
      if (requestId) send("blocked", { requestId });
      return;
    }
    if (!editing) {
      if (requestId) send("flushed", { requestId, content: state.content });
      return;
    }
    if (!emit()) {
      if (requestId) send("blocked", { requestId });
      return;
    }
    const content = value();
    editing = false;
    editor.remove();
    editor = null;
    surface.removeAttribute("contenteditable");
    surface.blur();
    if (content === original) surface.replaceChildren(rendered);
    // Changed markup is safe source HTML until the host reloads the normal
    // Municipio rendering. No rendered subtree ever leaves this document.
    else surface.innerHTML = window.wp.editor.autop(content);
    message.textContent = "";
    paint();
    send(requestId ? "flushed" : "end", { content, requestId });
  };
  const fallback = () => {
    clearTimeout(startTimer);
    generation++;
    if (flushRequest && flushRequest !== "leave")
      send("blocked", { requestId: flushRequest });
    flushRequest = null;
    starting = false;
    editing = false;
    editor?.remove();
    editor = null;
    surface.removeAttribute("contenteditable");
    if (rendered) surface.replaceChildren(rendered);
    paint();
    error(
      "Innehållet kan inte redigeras säkert på plats. Använd Huvudinnehåll i panelen.",
    );
    send("end", { content: original });
  };
  const begin = () => {
    if (editing || starting || !state?.writable || state.busy) return;
    if (state.postId !== config.pageId) {
      send("begin");
      return;
    }
    if (!canEdit()) {
      error(
        "Innehållet behöver redigeras i panelen för att bevara originalkoden.",
      );
      return;
    }
    // Resolve dependencies before moving any visible content. Missing or
    // delayed core settings must leave the preview and working value intact.
    const defaults = config.editor;
    if (!defaults || typeof defaults !== "object") {
      error(
        "Editorn kunde inte laddas. Innehållet är oförändrat. Ladda om sidan eller använd panelen.",
      );
      return;
    }
    if (
      !window.dispatchEvent(
        new CustomEvent("forma-inline-enter", {
          detail: "content",
          cancelable: true,
        }),
      )
    )
      return;
    if (document.querySelector('[data-forma-title][data-forma-editing="true"]'))
      return;
    original = state.content;
    last = original;
    rendered = document.createDocumentFragment();
    while (surface.firstChild) rendered.append(surface.firstChild);
    starting = true;
    const currentGeneration = ++generation;
    startTimer = setTimeout(() => {
      if (starting && generation === currentGeneration) fallback();
    }, 10000);
    message.textContent = "";
    send("begin");
    try {
      const initialization = window.tinymce.init({
        ...defaults,
        id: "forma-inline-content",
        wp_skip_init: false,
        // Inline content already uses the theme's styles; core's iframe
        // stylesheet must not be injected into the surrounding preview page.
        content_css: false,
        selector: "#forma-inline-content",
        inline: true,
        readonly: true,
        fixed_toolbar_container: "#forma-inline-toolbar",
        menubar: false,
        toolbar1:
          "formatselect bold italic bullist numlist blockquote link unlink image wp_more undo redo",
        toolbar2: "",
        toolbar3: "",
        toolbar4: "",
        plugins: "wordpress,lists,paste,link,image",
        external_plugins: {},
        wpautop: true,
        wp_paste_filters: false,
        convert_urls: false,
        image_dimensions: true,
        image_description: true,
        image_title: false,
        image_advtab: false,
        image_caption: false,
        block_formats: "Stycke=p;Rubrik 2=h2;Rubrik 3=h3;Rubrik 4=h4",
        setup(instance) {
          editor = instance;
          instance.on("init", () =>
            queueMicrotask(() => {
              if (generation !== currentGeneration) {
                instance.remove();
                return;
              }
              clearTimeout(startTimer);
              try {
                instance.setContent(original, { load: true });
                baseline = instance.getContent();
                if (
                  !policy.safe(baseline) ||
                  policy.signature(window.wp.editor.autop(original)) !==
                    policy.signature(baseline)
                ) {
                  fallback();
                  return;
                }
                starting = false;
                editing = true;
                paint();
                instance.focus();
                if (flushRequest) {
                  const request = flushRequest;
                  flushRequest = null;
                  finish(request === "leave" ? null : request);
                }
              } catch {
                fallback();
              }
            }),
          );
          instance.on("input change Undo Redo", emit);
          instance.on("compositionstart", () => {
            composing = true;
          });
          instance.on("compositionend", () => {
            composing = false;
            emit();
            if (flushRequest) {
              const request = flushRequest;
              flushRequest = null;
              finish(request === "leave" ? null : request);
            }
          });
          instance.on("PastePreProcess", (event) => {
            // Reject unsupported paste before TinyMCE can silently strip it.
            if (!policy.safe(event.content)) {
              event.content = "";
              error(
                "Inklistringen innehåller format som inte stöds inline. Klistra in som oformaterad text eller använd panelen.",
              );
            }
          });
          instance.on("keydown", (event) => {
            if (event.key === "Escape" && !dialogOpen()) {
              event.preventDefault();
              finish();
            }
          });
        },
      });
      Promise.resolve(initialization).catch(() => {
        if (generation === currentGeneration && starting) fallback();
      });
    } catch {
      fallback();
    }
  };
  window.addEventListener("forma-inline-enter", (event) => {
    if (event.detail !== "content") {
      finish();
      if (editing || starting) event.preventDefault();
    }
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
      state =
        data.postId === state?.postId && data.acknowledged < sequence
          ? { ...data, content: state.content }
          : data;
      clearInterval(readyTimer);
      paint();
    } else if (data.type === "begin") begin();
    else if (data.type === "flush") finish(data.requestId);
    else if (
      data.type === "media" &&
      mediaRequest === data.requestId &&
      editing
    ) {
      mediaRequest = null;
      if (writable()) {
        editor.focus();
        editor.selection.moveToBookmark(bookmark);
        if (typeof data.html === "string") {
          if (policy.safe(data.html)) {
            editor.insertContent(data.html);
            emit();
          } else
            error(
              "Bilden kunde inte infogas säkert. Använd panelens mediebibliotek.",
            );
        }
      }
    }
  });
  document.addEventListener("DOMContentLoaded", () => {
    // Older browsers retain the existing panel, without misplaced controls.
    if (
      !CSS.supports("position-anchor", "--forma-content") ||
      !CSS.supports("top", "anchor(top)")
    )
      return;
    const candidates = document.querySelectorAll(
      "#article #forma-inline-content",
    );
    if (
      candidates.length !== 1 ||
      Number(candidates[0].dataset.formaPost) !== config.pageId
    )
      return;
    surface = candidates[0];
    surface.setAttribute("role", "textbox");
    surface.setAttribute("aria-multiline", "true");
    surface.setAttribute("aria-label", "Redigera huvudinnehåll");
    outline = document.createElement("div");
    outline.className =
      "forma-inline-title-outline forma-inline-content-outline";
    outline.hidden = true;
    outline.setAttribute("aria-hidden", "true");
    tools = document.createElement("div");
    tools.className = "forma-inline-content-tools";
    tools.hidden = true;
    tools.innerHTML =
      '<div class="forma-content-actions"><strong>Huvudinnehåll</strong><button type="button" class="button forma-add-media">Lägg till media</button><button type="button" class="button-link forma-open-panel">Redigera i panelen</button></div><p class="forma-content-error" role="status" hidden></p><div id="forma-inline-toolbar"></div>';
    message = tools.querySelector(".forma-content-error");
    document.body.append(outline, tools);
    new ResizeObserver(() =>
      tools.style.setProperty(
        "--forma-tools-height",
        `${tools.getBoundingClientRect().height}px`,
      ),
    ).observe(tools);
    new IntersectionObserver(([entry]) => {
      tools.style.visibility = entry.isIntersecting ? "visible" : "hidden";
    }).observe(surface);
    tools.querySelector(".forma-open-panel").addEventListener("click", () => {
      finish();
      if (!editing && !starting) send("panel");
    });
    tools.querySelector(".forma-add-media").addEventListener("click", () => {
      if (!editing || !writable() || state.busy || mediaRequest) return;
      bookmark = editor.selection.getBookmark(2, true);
      mediaRequest = crypto.randomUUID();
      send("media", { requestId: mediaRequest });
    });
    surface.addEventListener("pointerenter", () => {
      outline.dataset.hover = "true";
    });
    surface.addEventListener("pointerleave", () => {
      outline.dataset.hover = "false";
    });
    surface.addEventListener("click", (event) => {
      event.preventDefault();
      if (!editing) begin();
    });
    surface.addEventListener("focus", begin);
    surface.addEventListener("keydown", (event) => {
      if (!editing && ["Enter", " "].includes(event.key)) {
        event.preventDefault();
        begin();
      }
    });
    // A link inside editable text must never navigate away from the preview.
    surface.addEventListener("auxclick", (event) => event.preventDefault());
    window.addEventListener(
      "pointerdown",
      (event) => {
        if (!owned(event.target)) finish();
      },
      true,
    );
    document.addEventListener("focusin", (event) => {
      if (!owned(event.target)) finish();
    });
    window.addEventListener("blur", () => {
      if (!mediaRequest) finish();
    });
    const ready = () => send("ready", { pageId: config.pageId });
    readyTimer = setInterval(ready, 500);
    ready();
  });
})();

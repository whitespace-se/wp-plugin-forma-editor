(() => {
  const controls =
    'a, area, button, input, select, textarea, summary, [role="button"], [role="link"], [contenteditable]';
  const isControl = (event) =>
    event
      .composedPath()
      .some((node) => node instanceof Element && node.matches(controls));
  const block = (event) => {
    event.preventDefault();
    event.stopImmediatePropagation();
  };
  // Capture also covers dynamically inserted controls. Wheel and touchmove
  // retain browser scrolling; this is not a sandbox for site scripts.
  for (const type of [
    "click",
    "auxclick",
    "dblclick",
    "submit",
    "beforeinput",
    "dragstart",
  ]) {
    window.addEventListener(type, block, { capture: true, passive: false });
  }
  window.addEventListener(
    "contextmenu",
    (event) => {
      if (isControl(event)) block(event);
    },
    true,
  );
  for (const type of [
    "pointerdown",
    "pointerup",
    "mousedown",
    "mouseup",
    "touchstart",
    "touchend",
  ]) {
    window.addEventListener(
      type,
      (event) => {
        // Native controls can act before click. Preserve touch scrolling while
        // preventing the site's pointer/touch handlers from running.
        if (!type.startsWith("touch") && isControl(event))
          event.preventDefault();
        event.stopImmediatePropagation();
      },
      { capture: true, passive: false },
    );
  }
  for (const type of ["keydown", "keyup", "keypress"]) {
    window.addEventListener(
      type,
      (event) => {
        // Tab can leave the iframe. Scroll keys retain their browser defaults
        // on the page, while activation and editing on controls are blocked.
        if (event.key === "Enter" || (isControl(event) && event.key !== "Tab"))
          event.preventDefault();
        event.stopImmediatePropagation();
      },
      true,
    );
  }
})();

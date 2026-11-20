/**
 * Core's Popover overlay middleware uses the runtime realm's HTMLElement.
 * Canvas nodes belong to the preview realm, so that check skips their size.
 * Supply only the missing dimensions; core still owns position and animation.
 */
export function observeInsertionSize(
  canvas: HTMLElement,
  previous: HTMLElement | null,
  next: HTMLElement | null,
): () => void {
  const update = () => {
    const before = previous?.getBoundingClientRect();
    const after = next?.getBoundingClientRect();
    const reference = before ?? after;
    if (!reference) return;
    const width = `${reference.width}px`;
    const height = `${before && after ? Math.max(0, after.top - before.bottom) : 0}px`;
    for (const content of canvas.querySelectorAll<HTMLElement>(
      ".block-editor-block-popover__inbetween > .components-popover__content",
    )) {
      if (!content.querySelector(".is-vertical.is-with-inserter")) continue;
      if (content.style.width !== width) content.style.width = width;
      if (content.style.height !== height) content.style.height = height;
    }
  };
  const resize = new ResizeObserver(update);
  resize.observe(canvas);
  if (previous) resize.observe(previous);
  if (next) resize.observe(next);
  const mutations = new MutationObserver(update);
  mutations.observe(canvas, { childList: true, subtree: true });
  update();
  return () => {
    resize.disconnect();
    mutations.disconnect();
  };
}

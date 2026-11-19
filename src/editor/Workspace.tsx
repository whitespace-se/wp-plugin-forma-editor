import React, { useState, useEffect, useCallback } from "react";
import { PreviewBridge } from "./PreviewBridge";
import { apiFetch } from "../wordpress/api";
import { Editor, type EditorConfig } from "./Editor";
import { PanelResize } from "./PanelResize";

/** Keep the preview and layout alive while each post gets an isolated editing
 * session. The old session flushes before requesting a switch; failed requests
 * leave its input intact. No pending response can update the next post. */
export function Workspace({ initial }: { initial: EditorConfig }) {
  const [bridge] = useState(() => new PreviewBridge());
  const [contentBridge] = useState(() => new PreviewBridge("content"));
  const frameRef = useCallback(
    (frame: HTMLIFrameElement | null) => {
      bridge.attach(frame);
      contentBridge.attach(frame);
    },
    [bridge, contentBridge],
  );
  useEffect(() => {
    window.addEventListener("message", bridge.receive);
    window.addEventListener("message", contentBridge.receive);
    return () => {
      window.removeEventListener("message", bridge.receive);
      bridge.disconnect();
      window.removeEventListener("message", contentBridge.receive);
      contentBridge.disconnect();
    };
  }, [bridge, contentBridge]);
  const [config, setConfig] = useState(initial);
  const [section, setSection] = useState<string | null>(null);
  const [width, setWidth] = useState(420);
  const [resizing, setResizing] = useState(false);
  const [preview, setPreview] = useState({
    url: initial.previewUrl,
    version: 0,
  });

  async function switchObject(module: number, section: string | null) {
    const next = await apiFetch<Partial<EditorConfig> & { heading: string }>({
      path: `${initial.contextPath}?module=${module}`,
    });
    const url = new URL(location.href);
    if (module) url.searchParams.set("module", String(module));
    else url.searchParams.delete("module");
    history.replaceState(null, "", url);
    const classic = document.querySelector<HTMLAnchorElement>(
      "#wp-admin-bar-forma-editor-switch-target > a",
    );
    if (classic && next.classicUrl) classic.href = next.classicUrl;
    const media = (
      window as unknown as {
        wp: {
          media?: {
            view: { settings: { post: { id: number; nonce: string } } };
          };
        };
      }
    ).wp.media;
    if (media && next.postId && next.lockNonce) {
      media.view.settings.post.id = next.postId;
      media.view.settings.post.nonce = next.lockNonce;
    }
    setSection(section);
    setConfig({
      ...initial,
      ...next,
      labels: { ...initial.labels, heading: next.heading },
    });
  }

  return (
    <div
      className={`forma-editor__workspace${resizing ? " forma-editor__workspace--resizing" : ""}`}
      style={{ gridTemplateColumns: `minmax(0, 1fr) min(${width}px, 90vw)` }}
    >
      <div className="forma-editor__canvas">
        <iframe
          ref={frameRef}
          key={preview.version}
          className="forma-editor__preview"
          src={preview.url}
          title={initial.labels.preview}
        />
      </div>
      <PanelResize
        width={width}
        label={initial.labels.panelWidth}
        onChange={setWidth}
        onDragging={setResizing}
      />
      <Editor
        bridge={bridge}
        contentBridge={contentBridge}
        key={config.postId}
        {...config}
        initialSection={section}
        onSwitch={switchObject}
        onPreview={(url) =>
          setPreview((old) => ({ url, version: old.version + 1 }))
        }
      />
    </div>
  );
}

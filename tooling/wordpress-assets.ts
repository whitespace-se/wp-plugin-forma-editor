import { createHash } from "node:crypto";
import type { Plugin } from "vite";

export const wordpressExternals = {
  react: { global: "React", handle: "react" },
  "react-dom": { global: "ReactDOM", handle: "react-dom" },
  "react-dom/client": { global: "ReactDOM", handle: "react-dom" },
  "@wordpress/api-fetch": { global: "wp.apiFetch", handle: "wp-api-fetch" },
};

export function wordpressAssets(): Plugin {
  return {
    name: "forma-wordpress-assets",
    generateBundle(_options, bundle) {
      const hash = createHash("sha256");
      for (const name of Object.keys(bundle).sort()) {
        const asset = bundle[name];
        hash.update(name);
        hash.update(asset.type === "chunk" ? asset.code : asset.source);
      }

      // The same map drives externalization and PHP loading order. Do not bundle
      // a second React runtime or rely on another plugin to enqueue dependencies.
      const handles = [
        ...new Set(
          Object.values(wordpressExternals).map(({ handle }) => handle),
        ),
      ];
      this.emitFile({
        type: "asset",
        fileName: "editor.asset.php",
        source: `<?php\nreturn ['dependencies' => [${handles.map((handle) => `'${handle}'`).join(", ")}], 'version' => '${hash.digest("hex").slice(0, 16)}'];\n`,
      });
    },
  };
}

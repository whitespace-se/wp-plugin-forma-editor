# Forma Editor

An open source visual editing workspace for WordPress. Early development: this
repository currently contains the plugin and tooling foundation, not a usable
editor. Gutenberg integration is outside the initial scope.

## Development

Use Node.js from `.nvmrc`, npm, and PHP. Install dependencies with `npm ci` and
run `npm run check` for static checks. `npm run build` produces WordPress
assets; `npm run dev` watches and rebuilds without starting an HTTP server.
Reload WordPress after changes. Build output is not committed.

WordPress supplies React and `apiFetch` at runtime. The npm copies provide build
and type tooling; the bundle externalizes them. Set `SCRIPT_DEBUG` in WordPress
for its development scripts and use the development build for editor source
maps. The initial compatibility target is WordPress 6.6+ and PHP 8.1+; runtime
validation is still pending.

The plugin currently registers built assets without enqueueing them or adding an
editor screen. Activation does not change content or the existing editing UI.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

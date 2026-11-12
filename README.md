# Forma Editor

An open source visual editing workspace for WordPress. Early development: this
editor currently previews pages and posts alongside a read-only title field.
Editing and saving are not implemented yet. Gutenberg integration is outside the
initial scope.

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

Install the plugin directory including `build/` in WordPress and activate it.
The frontend toolbar's edit link opens Forma for published posts and drafts. Use
the toolbar to view the page or switch to the classic editor. Content is not
modified. Custom post types must opt in through `forma_editor_post_types` and
support titles, REST access and frontend viewing.

The iframe remains interactive in this first step. Navigating inside it does not
change the post selected in the editor shell; use the toolbar to leave Forma
before choosing another post.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

# Forma Editor

An open source visual editing workspace for WordPress. This alpha edits page and
post titles and classic-editor content alongside a site preview. It uses
WordPress autosaves, revisions, editing locks and draft/published states. This
alpha also includes inline page-title editing in Municipio previews, selected
ACF navigation and color-theme fields, and separate editing of existing
Modularity text modules. This experimental branch adds inline body editing from
the original field source, with a mutually exclusive panel editor for
Visual/Code editing. Unsupported source stays in the panel. General ACF/module
support and Gutenberg integration are not included. Use the classic editor for
unsupported fields and publishing options.

## Development

Use Node.js from `.nvmrc`, npm, and PHP. Install dependencies with `npm ci` and
run `npm run check` for static checks. `npm run build` produces WordPress
assets; `npm run dev` watches and rebuilds without starting an HTTP server.
Reload WordPress after changes. Commit production assets from `npm run build`
alongside source changes so Composer consumers need no frontend build step.

WordPress supplies React and `apiFetch` at runtime. The npm copies provide build
and type tooling; the bundle externalizes them. Set `SCRIPT_DEBUG` in WordPress
for its development scripts and use the development build for editor source
maps. The initial compatibility target is WordPress 6.6+ and PHP 8.1+; runtime
validation has covered WordPress 6.9.8 on Municipio M5; the full
supported-version matrix has not yet been verified.

Install the plugin directory including `build/` in WordPress and activate it.
The Composer package is `whitespace-se/wp-plugin-forma-editor`, installed as
`forma-editor` through `composer/installers`. Use the GitHub VCS repository and
the exact `0.1.0-alpha.2` requirement. Installable ZIP files are provided with
[GitHub releases](https://github.com/whitespace-se/wp-plugin-forma-editor/releases).
The frontend toolbar's edit link opens Forma for published posts and drafts. Use
the toolbar to view the page or switch to the classic editor. Published content
changes only after an explicit update; WordPress may save an author's own draft
directly during autosave. Custom post types must opt in through
`forma_editor_post_types` and support titles, REST access and frontend viewing.

The preview blocks link/button activation and form submission while retaining
scrolling and explicitly enabled inline title editing. Use the toolbar to view
the interactive site or choose another post. The guard applies only to
authenticated Forma previews; ordinary pages retain their normal behavior.

## License

GPL-2.0-or-later. See [LICENSE](LICENSE).

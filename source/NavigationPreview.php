<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

use Municipio\Controller\Navigation\Cache\NavigationRuntimeCache;
use Municipio\Controller\Navigation\Cache\NavigationWpCache;

/** Municipio 6 page-tree helpers read SQL rather than ACF's preview values. */
final class NavigationPreview
{
    public static function prepare(): void
    {
        $id = Plugin::request_post_id('forma-preview');
        $nonce = $_GET['preview_nonce'] ?? '';
        if (!Plugin::is_frame_request() || get_queried_object_id() !== $id
            || Plugin::request_post_id('preview_id') !== $id || !is_string($nonce)
            || !wp_verify_nonce($nonce, 'post_preview_' . $id)
            || !NavigationFields::fields($id)) return;
        $revision = wp_get_post_autosave($id, get_current_user_id());
        if (!$revision) return;
        $acf_source = acf_get_meta($revision->ID) ? $revision->ID : $id;
        $meta = get_post_meta($acf_source);
        $revision_keys = wp_post_revision_meta_keys(get_post_type($id));
        // Core's per-key metadata preview asks for an autosave without a user
        // ID. Override only this validated preview's post and revisioned keys.
        add_filter('get_post_metadata', static function ($value, $object_id, $key, $single) use ($id, $meta, $revision_keys) {
            if ((int) $object_id !== $id || !in_array($key, $revision_keys, true)) return $value;
            $values = array_map('maybe_unserialize', $meta[$key] ?? []);
            return $single ? ($values[0] ?? '') : $values;
        }, 100, 4);

        // ACF normally selects the latest revision, which may belong to another
        // editor. Core previews the current user's autosave: follow that choice.
        add_filter('acf/validate_post_id', static function ($resolved, $original) use ($id, $acf_source) {
            // Pre-integration Forma autosaves have no ACF snapshot: retain the
            // parent metadata while core previews their title/content changes.
            if ((int) $original === $id || (int) wp_is_post_revision($resolved) === $id) return $acf_source;
            return $resolved;
        }, 100, 2);

        $values = NavigationFields::values($id, $revision->ID);
        if (!array_key_exists('field_56d83d2777785', $values)
            || !class_exists(NavigationWpCache::class) || !class_exists(NavigationRuntimeCache::class)) return;
        // All derived menu caches must miss too; otherwise isCached menu items
        // bypass the title decorator. A per-request namespace never reads or
        // overwrites a public menu. Remove its persistent entries on shutdown.
        $prefix = 'forma-preview-' . wp_generate_uuid4() . '-';
        $keys = [];
        add_filter('Municipio/Navigation/Cache/Key', static function (string $key) use ($prefix, &$keys): string {
            $keys[$prefix . $key] = true;
            return $prefix . $key;
        }, PHP_INT_MAX);
        add_action('shutdown', static function () use (&$keys): void {
            foreach (array_keys($keys) as $key) wp_cache_delete($key);
            $registry = wp_cache_get('municipioNavMenu');
            if (is_array($registry)) wp_cache_set('municipioNavMenu', array_values(array_diff($registry, array_keys($keys))));
        });

        // Keep the helpers' published/private scope. Only the previewed post is
        // overlaid; drafts are not inserted into the public page tree.
        global $wpdb;
        $rows = $wpdb->get_results("SELECT pm.post_id, pm.meta_key, pm.meta_value
            FROM {$wpdb->postmeta} pm JOIN {$wpdb->posts} p ON p.ID = pm.post_id
            WHERE p.post_status IN ('publish', 'private')
            AND pm.meta_key IN ('hide_in_menu', 'custom_menu_title')");
        $hidden = [];
        $titles = [];
        foreach ($rows as $row) {
            if ($row->meta_key === 'hide_in_menu' && $row->meta_value === '1') $hidden[] = (int) $row->post_id;
            if ($row->meta_key === 'custom_menu_title' && $row->meta_value !== '') $titles[(int) $row->post_id] = $row->meta_value;
        }
        $hidden = array_values(array_diff($hidden, [$id]));
        if (($values['field_56d83d2777785'] ?? '0') === '1') $hidden[] = $id;
        unset($titles[$id]);
        $title = $values['field_56d83d4e77786'] ?? '';
        if ($title !== '') $titles[$id] = $title;
        NavigationWpCache::setCache('hide_in_menu', $hidden ?: [PHP_INT_MAX], false);
        NavigationRuntimeCache::setCache('custom_menu_title', $titles);
    }
}

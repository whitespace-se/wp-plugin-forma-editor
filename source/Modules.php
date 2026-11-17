<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

/** Bounded adapter for existing Modularity placements and classic text posts. */
final class Modules
{
    public static function supported(?\WP_Post $post): bool
    {
        return $post && $post->post_type === 'mod-text'
            && class_exists('Modularity\\Editor')
            && in_array($post->post_status, ['publish', 'draft'], true)
            && $post->post_password === '';
    }

    public static function ids(int $page): array
    {
        $ids = [];
        foreach ((array) get_post_meta($page, 'modularity-modules', true) as $placements) {
            foreach ((array) $placements as $placement) {
                if (is_array($placement) && !empty($placement['postid'])) $ids[] = (int) $placement['postid'];
            }
        }
        return array_values(array_unique($ids));
    }

    public static function allowed(int $page, int $module): bool
    {
        $parent = get_post($page);
        return $parent && Plugin::supported_post($parent) && current_user_can('edit_post', $page)
            && in_array($module, self::ids($page), true)
            && self::supported(get_post($module)) && current_user_can('edit_post', $module);
    }

    public static function items(int $page): array
    {
        $items = [];
        foreach (self::ids($page) as $id) {
            $post = get_post($id);
            if (!$post || !current_user_can('read_post', $id)) continue;
            $items[] = [
                'id' => $id, 'title' => $post->post_title ?: __('(no title)'),
                'type' => get_post_type_object($post->post_type)?->labels->singular_name ?? $post->post_type,
                'url' => self::allowed($page, $id) ? add_query_arg('module', $id, Plugin::editor_url(get_post($page))) : null,
            ];
        }
        return $items;
    }

    public static function usage(int $module): int
    {
        global $wpdb;
        // Decode placements rather than matching serialized strings: imports may
        // store IDs as either integers or strings. Do not expose other page titles.
        $pages = $wpdb->get_col("SELECT DISTINCT post_id FROM {$wpdb->postmeta} WHERE meta_key = 'modularity-modules'");
        $used = [];
        foreach ($pages as $page) {
            $post = get_post((int) $page);
            if ($post && !in_array($post->post_status, ['trash', 'auto-draft', 'inherit'], true)
                && in_array($module, self::ids((int) $page), true)) $used[(int) $page] = true;
        }
        if (class_exists('Modularity\\Helper\\ModuleUsageById')) {
            foreach (\Modularity\Helper\ModuleUsageById::getModuleUsageById($module) as $page) $used[(int) $page->post_id] = true;
        }
        return count($used);
    }

    public static function preview_url(int $page, int $module, bool $autosave): string
    {
        return add_query_arg([
            'forma-preview' => $page, '_forma_nonce' => wp_create_nonce('forma-preview-' . $page),
            'forma-module' => $module, 'forma-module-autosave' => $autosave ? '1' : '0',
            '_forma_module_nonce' => wp_create_nonce('forma-module-' . $page . '-' . $module),
        ], Plugin::view_url(get_post($page)));
    }

    public static function save(\WP_Post $post, \WP_REST_Request $core, bool $autosave)
    {
        // Modules deliberately remain non-public and outside REST. Use the same
        // core autosave revision type as the classic editor, including own drafts.
        $data = ['ID' => $post->ID, 'post_ID' => $post->ID, 'post_type' => $post->post_type,
            'post_title' => $core['title'], 'post_content' => $core['content'],
            'post_excerpt' => $core['excerpt'] ?? $post->post_excerpt];
        if ($autosave && !defined('DOING_AUTOSAVE') && !defined('WP_RUN_CORE_TESTS')) define('DOING_AUTOSAVE', true);
        $snapshot = static function (int $revision, int $parent) use ($post): void {
            if ($parent === $post->ID && function_exists('acf_copy_metadata')) acf_copy_metadata($parent, $revision);
        };
        add_action('_wp_put_post_revision', $snapshot, 20, 2);
        try {
            if ($autosave && ($post->post_status !== 'draft' || (int) $post->post_author !== get_current_user_id())) {
                $result = wp_create_post_autosave(wp_slash($data));
            } else {
                if (!$autosave) $data['post_status'] = $core['status'];
                $result = wp_update_post(wp_slash($data), true);
            }
        } finally {
            remove_action('_wp_put_post_revision', $snapshot, 20);
        }
        return is_wp_error($result) ? $result : new \WP_REST_Response(['id' => $result]);
    }

    public static function prepare_preview(): void
    {
        $page = Plugin::request_post_id('forma-preview');
        $id = Plugin::request_post_id('forma-module');
        if (!$id || !Plugin::is_frame_request() || get_queried_object_id() !== $page
            || !self::allowed($page, $id)
            || !wp_verify_nonce((string) ($_GET['_forma_module_nonce'] ?? ''), 'forma-module-' . $page . '-' . $id)) return;
        $post = get_post($id);
        $source = ($_GET['forma-module-autosave'] ?? '') === '1' ? wp_get_post_autosave($id, get_current_user_id()) : null;
        $source = $source ?: $post;
        // A draft page needs preview=true, which also enables ACF's automatic
        // page revision lookup. Only the active module may show a revision here.
        add_filter('acf/validate_post_id', static function ($resolved, $original) use ($page) {
            return (int) $original === $page || wp_is_post_revision($resolved) === $page ? $page : $resolved;
        }, 100, 2);
        // Never store rendered unpublished content in Modularity's shared cache.
        if (!defined('MODULARITY_DISABLE_FRAGMENT_CACHE')) define('MODULARITY_DISABLE_FRAGMENT_CACHE', true);
        add_action('pre_get_posts', static function ($query) use ($id): void {
            if ($query->is_main_query() || !in_array($id, array_map('intval', (array) $query->get('post__in')), true)) return;
            $query->set('suppress_filters', false);
            $query->set('post_status', ['publish', 'private', 'draft']);
            $query->set('forma_module_query', true);
        });
        add_filter('the_posts', static function ($posts, $query) use ($id, $source) {
            if (!$query->get('forma_module_query')) return $posts;
            $result = [];
            foreach ($posts as $post) {
                if ($post->ID !== $id && $post->post_status === 'draft') continue;
                $copy = clone $post;
                if ($post->ID === $id) {
                    // Text::data may replace the view's ID with a generated DOM
                    // identifier. Carry a request-local marker through hydration.
                    $copy->forma_preview_id = $id;
                    $copy->post_title = $source->post_title;
                    $copy->post_content = $source->post_content;
                }
                $result[] = $copy;
            }
            return $result;
        }, 100, 2);
        add_filter('Modularity/Display/mod-text/viewData', static function ($data) use ($id, $source) {
            if ((int) ($data['forma_preview_id'] ?? 0) !== $id) return $data;
            $data['postTitle'] = $source->post_title;
            $data['postContent'] = apply_filters('the_content', apply_filters('Modularity/Display/SanitizeContent', $source->post_content));
            $data['hasHeadingsInContent'] = preg_match('/<h[1-6]/', $source->post_content);
            return $data;
        }, 100);
    }
}

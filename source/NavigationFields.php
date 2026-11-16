<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

/** Deliberately bounded ACF adapter: this is not a generic metabox bridge. */
final class NavigationFields
{
    private const GROUP = 'group_56d83cff12bb3';
    private const FIELDS = [
        'field_page_hide_secondary_menu' => ['page_hide_secondary_menu', 'true_false'],
        'field_56d83d2777785' => ['hide_in_menu', 'true_false'],
        'field_56d83d4e77786' => ['custom_menu_title', 'text'],
    ];

    public static function fields(int $post_id): array
    {
        if (!function_exists('acf_get_field_groups') || get_post_type($post_id) !== 'page') {
            return [];
        }
        foreach (acf_get_field_groups(['post_id' => $post_id]) as $group) {
            if ($group['key'] !== self::GROUP) continue;
            $fields = acf_get_fields($group) ?: [];
            // Fail closed if a site changes this group to unsupported field types.
            foreach ($fields as $field) {
                if ((self::FIELDS[$field['key']] ?? null) !== [$field['name'], $field['type']]) return [];
            }
            return $fields;
        }
        return [];
    }

    public static function keys(): array
    {
        $names = array_column(self::FIELDS, 0);
        return array_merge($names, array_map(static fn($name) => '_' . $name, $names));
    }

    public static function register(): void
    {
        add_filter('wp_post_revision_meta_keys', static function (array $keys, string $type): array {
            return $type === 'page' && function_exists('acf_get_field')
                ? array_values(array_unique(array_merge($keys, self::keys()))) : $keys;
        }, 20, 2);
        // ACF restores all its metadata from revisions. A Forma revision must
        // therefore carry untouched ACF fields too, not just our three inputs.
        add_action('_wp_put_post_revision', static function (int $revision, int $parent): void {
            if (self::$saving && $parent === self::$saving && function_exists('acf_copy_metadata')) {
                acf_copy_metadata($parent, $revision);
            }
        }, 20, 2);
    }

    private static int $saving = 0;

    public static function values(int $post_id, ?int $source = null): array
    {
        $values = [];
        // Reading the complete stored map avoids core's per-key preview filter,
        // which can select a different user's autosave or hide legacy defaults.
        $parent_meta = get_post_meta($post_id);
        $source_meta = $source ? get_post_meta($source) : $parent_meta;
        foreach (self::fields($post_id) as $field) {
            // Older Forma revisions have no ACF snapshot. Missing references
            // mean unchanged, rather than clearing values on resume/publish.
            $meta = $source && !isset($source_meta['_' . $field['name']]) ? $parent_meta : $source_meta;
            $raw = isset($meta[$field['name']][0]) ? maybe_unserialize($meta[$field['name']][0]) : ($field['default_value'] ?? '');
            $values[$field['key']] = $field['type'] === 'true_false' ? (string) (int) (bool) $raw : (string) $raw;
        }
        return $values;
    }

    public static function markup(int $post_id): string
    {
        $fields = self::fields($post_id);
        if (!$fields) return '';
        acf_enqueue_scripts();
        // ACF's enqueue callback runs later than Forma's. Make the dependency
        // explicit so React cannot mount the fields before acf-input is loaded.
        wp_scripts()->registered['forma-editor']->deps[] = 'acf-input';
        ob_start();
        acf_render_fields($fields, $post_id, 'div', 'label');
        return (string) ob_get_clean();
    }

    public static function validate(int $post_id, $values)
    {
        $fields = self::fields($post_id);
        if (!is_array($values) || array_diff(array_keys($values), array_column($fields, 'key'))) {
            return new \WP_Error('forma_acf_fields', __('Navigationsfälten kunde inte verifieras. Ladda om editorn.', 'forma-editor'), ['status' => 400]);
        }
        if (!$fields) return [];
        acf_reset_validation_errors();
        foreach ($fields as $field) {
            $value = $values[$field['key']] ?? null;
            if (!is_string($value) || ($field['type'] === 'true_false' && !in_array($value, ['0', '1'], true))) {
                return new \WP_Error('forma_acf_value', __('Ett navigationsfält har ett ogiltigt värde.', 'forma-editor'), ['status' => 400]);
            }
        }
        $previous_post = $_POST;
        $form_id = acf_get_form_data('post_id');
        try {
            $_POST['acf'] = wp_slash($values);
            $_POST['post_ID'] = $post_id;
            acf_set_form_data('post_id', $post_id);
            acf_validate_save_post();
            $errors = acf_get_validation_errors();
        } finally {
            $_POST = $previous_post;
            acf_set_form_data('post_id', $form_id);
            acf_reset_validation_errors();
        }
        if ($errors) return new \WP_Error('forma_acf_validation', implode(' ', array_column($errors, 'message')), ['status' => 400, 'fields' => $errors]);
        return $values;
    }

    public static function unsupported_changes(int $post_id, int $revision): bool
    {
        if (!function_exists('acf_get_meta')) return false;
        $revision_meta = acf_get_meta($revision) ?: [];
        if (!$revision_meta) return false;
        $parent_meta = acf_get_meta($post_id) ?: [];
        $ignored = array_merge(self::keys(), ['_acf_changed']);
        foreach (array_unique(array_merge(array_keys($parent_meta), array_keys($revision_meta))) as $key) {
            if (!in_array($key, $ignored, true) && ($parent_meta[$key] ?? null) !== ($revision_meta[$key] ?? null)) return true;
        }
        return false;
    }

    /** Save through core; attach ACF before core takes the final parent revision. */
    public static function save(\WP_Post $post, \WP_REST_Request $core, array $values, bool $autosave)
    {
        if (!self::fields($post->ID)) return rest_do_request($core);
        self::$saving = $post->ID;
        $previous_post = $_POST;
        $form_id = acf_get_form_data('post_id');
        $own_draft = $autosave && $post->post_status === 'draft' && (int) $post->post_author === get_current_user_id();
        $is_parent = !$autosave || $own_draft;
        $save_fields = static function ($saved) use ($post, $values): void {
            $saved_id = $saved instanceof \WP_Post ? $saved->ID : (int) $saved;
            if ($saved_id === $post->ID) acf_save_post($post->ID, wp_slash($values));
        };
        $hook = $own_draft ? 'wp_after_insert_post' : 'rest_after_insert_' . $post->post_type;
        $priority = $own_draft ? 8 : 10;
        if ($is_parent) {
            // The autosave endpoint updates an author's own draft directly and
            // ignores REST metadata. Attach fields to that update, before core's
            // priority-9 revision hook, retaining DOING_AUTOSAVE semantics.
            add_action($hook, $save_fields, $priority);
        } else {
            $meta = [];
            foreach (self::fields($post->ID) as $field) $meta[$field['name']] = $values[$field['key']];
            $core->set_param('meta', $meta);
        }
        try {
            $result = rest_do_request($core);
            if (!$result->is_error() && !$is_parent) {
                $revision = wp_get_post_autosave($post->ID, get_current_user_id());
                if (!$revision) return new \WP_Error('forma_acf_autosave', __('Autosparningen kunde inte hittas.', 'forma-editor'), ['status' => 500]);
                // Also upgrade old Forma autosaves which predate ACF support.
                $existing = acf_get_meta($revision->ID);
                if (!$existing) acf_copy_metadata($post->ID, $revision->ID);
                acf_save_post($revision->ID, wp_slash($values));
            }
            return $result;
        } finally {
            $_POST = $previous_post;
            acf_set_form_data('post_id', $form_id);
            remove_action($hook, $save_fields, $priority);
            self::$saving = 0;
        }
    }
}

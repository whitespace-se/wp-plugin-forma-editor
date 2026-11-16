<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

/** Coordinates core autosaves and advisory post locks; never stores a Forma copy. */
final class Workflow
{
    public static function register(): void
    {
        register_rest_route('forma/v1', '/posts/(?P<id>\d+)/workflow', [
            'methods' => 'POST',
            'permission_callback' => static fn(\WP_REST_Request $r): bool => Plugin::can_open(get_post((int) $r['id'])),
            'callback' => [self::class, 'handle'],
            'args' => [
                'operation' => ['required' => true, 'enum' => ['open', 'pulse', 'takeover', 'resume', 'discard', 'autosave', 'publish', 'draft']],
                'title' => ['type' => 'string'],
                'content' => ['type' => 'string'],
                'navigation' => ['type' => 'object'],
            ],
        ]);
    }

    public static function handle(\WP_REST_Request $request)
    {
        require_once ABSPATH . 'wp-admin/includes/post.php';
        $post = get_post((int) $request['id']);
        // Also check here: internal callers must obey the same policy as HTTP.
        if (!Plugin::can_open($post)) {
            return new \WP_Error('forma_forbidden', __('Posten kan inte redigeras.', 'forma-editor'), ['status' => 403]);
        }
        $operation = $request['operation'];
        $owner = wp_check_post_lock($post->ID);
        if ($owner && $operation !== 'takeover') {
            if (in_array($operation, ['open', 'pulse'], true)) {
                return self::state($post, false);
            }
            return new \WP_Error('forma_locked', sprintf(__('Posten redigeras av %s.', 'forma-editor'), get_userdata($owner)->display_name), ['status' => 409]);
        }
        wp_set_post_lock($post->ID);
        $autosave = wp_get_post_autosave($post->ID, get_current_user_id());
        $navigation = NavigationFields::values($post->ID, $autosave ? $autosave->ID : null);
        if (in_array($operation, ['autosave', 'publish', 'draft'], true) && NavigationFields::fields($post->ID)) {
            $navigation = NavigationFields::validate($post->ID, $request['navigation'] ?? $navigation);
            if (is_wp_error($navigation)) return $navigation;
        } elseif ($request['navigation']) {
            return new \WP_Error('forma_acf_unavailable', __('Navigationsfälten stöds inte på den här posten.', 'forma-editor'), ['status' => 400]);
        }

        if ($operation === 'discard' && $autosave) {
            $deleted = wp_delete_post_revision($autosave->ID);
            if (!$deleted || is_wp_error($deleted)) {
                return new \WP_Error('forma_discard_failed', __('Autosparningen kunde inte kastas.', 'forma-editor'), ['status' => 500]);
            }
        }
        if ($operation === 'autosave') {
            if (!is_string($request['title'])) {
                return new \WP_Error('forma_title_required', __('Titel saknas.', 'forma-editor'), ['status' => 400]);
            }
            if ($autosave && self::other_changes($post, $autosave)) {
                return new \WP_Error('forma_other_changes', __('Autosparningen innehåller fler ändringar. Fortsätt i klassiska editorn eller kasta autosparningen.', 'forma-editor'), ['status' => 409]);
            }
            // Core returns an existing autosave unchanged when the new values
            // equal the parent. Remove it explicitly when undoing all supported fields.
            if ($autosave && $request['title'] === $post->post_title && ($request['content'] ?? $autosave->post_content) === $post->post_content && $navigation === NavigationFields::values($post->ID)) {
                wp_delete_post_revision($autosave->ID);
                return self::state($post, false);
            }
            // Preserve the rest of a shared classic-editor autosave. Core's
            // revision constructor otherwise fills omitted revision fields with blanks.
            $source = $autosave ?: $post;
            $core = new \WP_REST_Request('POST', rest_get_route_for_post($post) . '/autosaves');
            $core->set_body_params([
                'title' => $request['title'],
                'content' => $request['content'] ?? $source->post_content,
                'excerpt' => $source->post_excerpt,
            ]);
            $result = NavigationFields::save($post, $core, $navigation, true);
            if ($result->is_error()) {
                return $result;
            }
            if ($autosave && $post->post_status === 'draft' && (int) $post->post_author === get_current_user_id()) {
                wp_delete_post_revision($autosave->ID);
            }
        }
        if (in_array($operation, ['publish', 'draft'], true)) {
            $type = get_post_type_object($post->post_type);
            if (!current_user_can($type->cap->publish_posts)) {
                return new \WP_Error('forma_cannot_publish', __('Du saknar publiceringsbehörighet.', 'forma-editor'), ['status' => 403]);
            }
            // Do not silently publish excerpt or metadata changes from another editor.
            if ($autosave && self::other_changes($post, $autosave)) {
                return new \WP_Error('forma_other_changes', __('Autosparningen innehåller fler ändringar. Publicera eller återställ dom i klassiska editorn.', 'forma-editor'), ['status' => 409]);
            }
            $core = new \WP_REST_Request('POST', rest_get_route_for_post($post));
            $core->set_body_params([
                'title' => $autosave ? $autosave->post_title : $post->post_title,
                'content' => $autosave ? $autosave->post_content : $post->post_content,
                'status' => $operation === 'publish' ? 'publish' : 'draft',
            ]);
            $result = NavigationFields::save($post, $core, $navigation, false);
            if ($result->is_error()) {
                return $result;
            }
            if ($autosave) {
                wp_delete_post_revision($autosave->ID);
            }
        }
        // Opening resumes only autosaves Forma can edit without losing fields
        // from the classic editor. Other users' locks return above.
        $resume = in_array($operation, ['open', 'takeover'], true)
            && $autosave && !self::other_changes($post, $autosave);
        return self::state(get_post($post->ID), $resume || in_array($operation, ['resume', 'autosave'], true));
    }

    private static function other_changes(\WP_Post $post, \WP_Post $autosave): bool
    {
        if ($post->post_excerpt !== $autosave->post_excerpt) {
            return true;
        }
        foreach (wp_post_revision_meta_keys($post->post_type) as $key) {
            if (NavigationFields::fields($post->ID) && in_array($key, array_merge(NavigationFields::keys(), ['_acf_changed']), true)) continue;
            if (get_post_meta($post->ID, $key) !== get_post_meta($autosave->ID, $key)) {
                return true;
            }
        }
        return NavigationFields::unsupported_changes($post->ID, $autosave->ID);
    }

    private static function state(\WP_Post $post, bool $preview_autosave): array
    {
        $autosave = wp_get_post_autosave($post->ID, get_current_user_id());
        $navigation = NavigationFields::values($post->ID);
        $autosave_navigation = $autosave ? NavigationFields::values($post->ID, $autosave->ID) : [];
        $different = $autosave && ($post->post_title !== $autosave->post_title || $post->post_content !== $autosave->post_content || $navigation !== $autosave_navigation || self::other_changes($post, $autosave));
        $owner = wp_check_post_lock($post->ID);
        $preview_args = [
            'forma-preview' => $post->ID,
            '_forma_nonce' => wp_create_nonce('forma-preview-' . $post->ID),
        ];
        if ($preview_autosave && $different) {
            $preview_args['preview_id'] = $post->ID;
            $preview_args['preview_nonce'] = wp_create_nonce('post_preview_' . $post->ID);
        }
        $url = $preview_autosave && $different ? get_preview_post_link($post) : Plugin::view_url($post);
        $revisions = wp_get_post_revisions($post->ID, ['numberposts' => 20]);
        $revision_url = null;
        foreach ($revisions as $revision) {
            if (!wp_is_post_autosave($revision)) {
                $revision_url = admin_url('revision.php?revision=' . $revision->ID);
                break;
            }
        }
        return [
            'title' => $post->post_title,
            'content' => $post->post_content,
            'navigation' => (object) $navigation,
            'status' => $post->post_status,
            'autosave' => $different ? ['title' => $autosave->post_title, 'content' => $autosave->post_content, 'navigation' => (object) $autosave_navigation, 'otherChanges' => self::other_changes($post, $autosave)] : null,
            'canPublish' => current_user_can(get_post_type_object($post->post_type)->cap->publish_posts),
            'lockOwner' => $owner ? get_userdata($owner)->display_name : null,
            'lock' => $owner ? null : get_post_meta($post->ID, '_edit_lock', true),
            'previewUrl' => add_query_arg($preview_args, $url),
            'viewUrl' => Plugin::view_url($post),
            'revisionUrl' => $revision_url,
        ];
    }
}

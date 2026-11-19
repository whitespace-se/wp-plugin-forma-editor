<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

/** Local opt-in only while TASK-288 evaluates the editing experience. */
final class Blocks
{
    public static function enabled(int $id): bool
    {
        return in_array(wp_get_environment_type(), ['local', 'development'], true)
            && get_post_meta($id, '_forma_block_trial', true) === '1';
    }

    public static function enqueue(): void
    {
        $id = Plugin::request_post_id('forma-preview');
        if (!Plugin::is_frame_request() || !self::enabled($id) || get_queried_object_id() !== $id) return;
        $post = get_post($id);
        require_once ABSPATH . 'wp-admin/includes/post.php';
        $context = new \WP_Block_Editor_Context(['post' => $post, 'name' => 'forma/block-trial']);
        $settings = get_block_editor_settings([], $context);
        // Both list and list-item are needed by current core's nested lists.
        $settings['allowedBlockTypes'] = ['core/paragraph', 'core/heading', 'core/list', 'core/list-item', 'core/image'];
        $settings['hasFixedToolbar'] = true;
        $settings['canLockBlocks'] = false;
        $settings['codeEditingEnabled'] = false;
        $settings['__experimentalCanUserUseUnfilteredHTML'] = false;
        $settings['enableOpenverseMediaCategory'] = false;
        wp_enqueue_media(['post' => $id]);
        wp_enqueue_script('wp-format-library');
        wp_add_inline_script('wp-blocks', 'wp.blocks.unstable__bootstrapServerSideBlockDefinitions(' . wp_json_encode(get_block_editor_server_block_settings(), JSON_HEX_TAG | JSON_UNESCAPED_SLASHES) . ');');
        $url = plugin_dir_url(FORMA_EDITOR_FILE) . 'build/';
        $dir = dirname(__DIR__) . '/build/';
        wp_enqueue_script('forma-blocks', $url . 'blocks.js', [
            'react', 'react-dom', 'wp-block-editor', 'wp-block-library', 'wp-blocks',
            'wp-components', 'wp-data', 'wp-hooks', 'wp-api-fetch', 'wp-format-library',
        ], (string) filemtime($dir . 'blocks.js'), true);
        wp_enqueue_style('forma-blocks', $url . 'blocks.css', [
            'wp-components', 'wp-block-editor', 'wp-block-library',
        ], (string) filemtime($dir . 'blocks.css'));
        wp_add_inline_script('forma-blocks', 'FormaBlocks.start(' . wp_json_encode([
            'pageId' => $id,
            'origin' => Plugin::editor_origin(),
            'nonce' => wp_create_nonce('wp_rest'),
            'settings' => $settings,
            'categories' => get_block_categories($context),
        ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ');');
    }
}

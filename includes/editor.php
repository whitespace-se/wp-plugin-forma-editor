<?php

namespace Whitespace\FormaEditor;

defined('ABSPATH') || exit;

function supported_post(?\WP_Post $post): bool
{
    if (!$post || !in_array($post->post_status, ['publish', 'draft'], true) || $post->post_password !== '') {
        return false;
    }

    // Custom types must opt in: REST visibility alone must not expose modules
    // or other internal content as standalone pages in the editor.
    $types = apply_filters('forma_editor_post_types', ['post', 'page']);
    $type = get_post_type_object($post->post_type);

    return in_array($post->post_type, $types, true)
        && $type && $type->show_in_rest && is_post_type_viewable($type)
        && post_type_supports($post->post_type, 'title')
        && (bool) rest_get_route_for_post($post);
}

function can_open(?\WP_Post $post): bool
{
    return supported_post($post) && current_user_can('edit_post', $post->ID);
}

function request_post_id(string $key): int
{
    $value = $_GET[$key] ?? '';
    return is_string($value) && ctype_digit($value) ? (int) $value : 0;
}

function editor_url(\WP_Post $post): string
{
    return add_query_arg(['page' => 'forma-editor', 'post' => $post->ID], admin_url('admin.php'));
}

function view_url(\WP_Post $post): string
{
    return (string) ($post->post_status === 'draft' ? get_preview_post_link($post) : get_permalink($post));
}

function classic_url(\WP_Post $post): string
{
    return add_query_arg('forma-classic', '1', get_edit_post_link($post->ID, 'raw'));
}

function select_classic_editor(bool $use_block_editor, \WP_Post $post): bool
{
    // Scope the classic destination to this explicit navigation, not other
    // WordPress editing links or the site's editor preferences.
    return isset($_GET['forma-classic']) && $_GET['forma-classic'] === '1' && can_open($post)
        ? false : $use_block_editor;
}

function is_editor_screen(): bool
{
    return is_admin() && get_current_screen()?->id === 'admin_page_forma-editor';
}

function register_screen(): void
{
    $hook = add_submenu_page('', 'Forma Editor', 'Forma Editor', 'read', 'forma-editor', __NAMESPACE__ . '\\render_screen');
    add_action('load-' . $hook, __NAMESPACE__ . '\\load_screen');
}

function load_screen(): void
{
    $id = request_post_id('post');
    $post = $id > 0 ? get_post($id) : null;
    if (!can_open($post)) {
        wp_die(esc_html__('Den här posten kan inte öppnas i Forma Editor.', 'forma-editor'), '', ['response' => 403]);
    }

    add_filter('admin_body_class', static fn(string $classes): string => $classes . ' forma-editor-screen');
    add_action('admin_enqueue_scripts', __NAMESPACE__ . '\\enqueue_editor');
}

function enqueue_editor(): void
{
    if (!wp_script_is('forma-editor', 'registered')) {
        return;
    }

    $post = get_post(request_post_id('post'));
    $preview = add_query_arg([
        'forma-preview' => $post->ID,
        '_forma_nonce' => wp_create_nonce('forma-preview-' . $post->ID),
    ], view_url($post));

    wp_enqueue_script('forma-editor');
    wp_enqueue_style('forma-editor');
    wp_add_inline_script('forma-editor', 'FormaEditor.start(' . wp_json_encode([
        'postId' => $post->ID,
        'restPath' => rest_get_route_for_post($post),
        'nonce' => wp_create_nonce('wp_rest'),
        'previewUrl' => $preview,
        'labels' => [
            'title' => __('Titel', 'forma-editor'),
            'preview' => __('Förhandsvisning av sidan', 'forma-editor'),
            'loading' => __('Hämtar titel…', 'forma-editor'),
            'error' => __('Titeln kunde inte hämtas. Försök igen.', 'forma-editor'),
            'retry' => __('Försök igen', 'forma-editor'),
        ],
    ], JSON_HEX_TAG | JSON_HEX_AMP | JSON_HEX_APOS | JSON_HEX_QUOT) . ');');
}

function render_screen(): void
{
    if (!wp_script_is('forma-editor', 'registered')) {
        echo '<div class="wrap"><h1>Forma Editor</h1><p>';
        esc_html_e('Editorns byggfiler saknas. Installera en byggd version av pluginet.', 'forma-editor');
        echo '</p></div>';
        return;
    }
    echo '<div id="forma-editor-root" class="forma-editor"></div>';
    echo '<noscript><p>';
    esc_html_e('Forma Editor kräver JavaScript.', 'forma-editor');
    echo '</p></noscript>';
}

function adapt_admin_bar(\WP_Admin_Bar $bar): void
{
    if (!is_admin()) {
        $post = get_queried_object();
        if ($post instanceof \WP_Post && can_open($post) && $bar->get_node('edit')) {
            $bar->add_node(['id' => 'edit', 'href' => editor_url($post)]);
        }
        return;
    }

    $forma = is_editor_screen();
    $screen = get_current_screen();
    if (!$forma && (!$screen || $screen->base !== 'post' || $screen->is_block_editor())) {
        return;
    }
    $post = $forma ? get_post(request_post_id('post')) : get_post();
    if (!can_open($post)) {
        return;
    }

    if ($forma) {
        $bar->add_node([
            'id' => 'view',
            'title' => $post->post_status === 'draft' ? __('Förhandsgranska', 'forma-editor') : __('Visa sida', 'forma-editor'),
            'href' => view_url($post),
        ]);
    }
    $bar->add_node([
        'id' => 'forma-editor-switch',
        'title' => $forma ? __('Editor: Visuell', 'forma-editor') : __('Editor: Klassisk', 'forma-editor'),
        'href' => false,
    ]);
    $bar->add_node([
        'id' => 'forma-editor-switch-target',
        'parent' => 'forma-editor-switch',
        'title' => $forma ? __('Klassisk editor', 'forma-editor') : __('Visuell editor', 'forma-editor'),
        'href' => $forma ? classic_url($post) : editor_url($post),
    ]);
}

function is_frame_request(): bool
{
    $id = request_post_id('forma-preview');
    $nonce = $_GET['_forma_nonce'] ?? '';
    return !is_admin() && $id > 0 && is_string($nonce)
        && wp_verify_nonce($nonce, 'forma-preview-' . $id)
        && can_open(get_post($id));
}

function preview_admin_bar(bool $show): bool
{
    return is_frame_request() ? false : $show;
}

function preview_headers(): void
{
    if (is_frame_request()) {
        // A toolbar-free authenticated preview must never become a cached
        // public response. This marker does not grant access to draft content.
        nocache_headers();
    }
}

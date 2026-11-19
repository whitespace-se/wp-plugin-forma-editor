<?php
// wp eval-file tests/inline-content-integration.php <source-page> <serialized-file>
// Only a temporary copy is published. Never touches the source's autosave/lock.
if (!defined('WP_CLI') || !WP_CLI || !in_array(wp_get_environment_type(), ['local', 'development'], true)) {
    throw new RuntimeException('Local/development only');
}
require_once ABSPATH . 'wp-admin/includes/post.php';
if (!defined('WP_RUN_CORE_TESTS')) define('WP_RUN_CORE_TESTS', true);
$source = get_post((int) ($args[0] ?? 0));
$edited = file_get_contents($args[1] ?? '');
if (!$source || !$edited) throw new RuntimeException('Source and serialized content required');
$original = $source->post_content;
$user = get_current_user_id();
$admin = get_users(['role' => 'administrator', 'number' => 1])[0] ?? null;
if (!$admin) throw new RuntimeException('Local administrator required');
wp_set_current_user($admin->ID);
$id = 0;
$check = static function ($condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
};
$call = static function (string $operation, ?string $content = null) use (&$id) {
    $request = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    $request->set_param('id', $id);
    $request->set_param('operation', $operation);
    if ($content !== null) {
        $request->set_param('content', $content);
        $request->set_param('title', get_post($id)->post_title);
    }
    $result = \Whitespace\FormaEditor\Workflow::handle($request);
    if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
    if ($result instanceof WP_REST_Response) {
        if ($result->is_error()) throw new RuntimeException($result->as_error()->get_error_message());
        return $result->get_data();
    }
    return $result;
};
try {
    $id = wp_insert_post(wp_slash(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Forma inline test ' . wp_generate_uuid4(), 'post_content' => $original]), true);
    if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
    $baseline = get_post($id)->post_content;
    $call('open');
    $call('autosave', $edited);
    $check(get_post($id)->post_content === $baseline, 'Autosave changed published content');
    $check(wp_get_post_autosave($id, $admin->ID)->post_content === $edited, 'Autosave lost serialized content');
    $check($call('open')['autosave']['content'] === $edited, 'Reopen lost working content');
    $check(_set_preview(clone get_post($id))->post_content === $edited, 'Preview lost serialized content');
    $call('publish');
    $check(get_post($id)->post_content === $edited, 'Publication lost serialized content');
    $call('autosave', $baseline);
    $call('discard');
    $check(get_post($id)->post_content === $edited && !wp_get_post_autosave($id, $admin->ID), 'Discard changed published content');
    $check(get_post($source->ID)->post_content === $original, 'Source page changed');
    echo "Inline content persistence: autosave, reopen, preview, publish, discard and source preservation passed.\n";
} finally {
    if (is_int($id) && $id > 0) {
        wp_delete_post($id, true);
        $check(!get_post($id), 'Temporary post cleanup failed');
        $check(!get_posts(['post_type' => 'revision', 'post_status' => 'inherit', 'post_parent' => $id]), 'Temporary revisions remain');
    }
    wp_set_current_user($user);
}

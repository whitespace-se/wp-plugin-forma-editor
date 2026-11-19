<?php
// Explicit local integration. Use serialized output from blocks-wordpress.test.mjs.
if (!defined('WP_CLI') || !WP_CLI || wp_get_environment_type() !== 'local') {
    throw new RuntimeException('Local WordPress required');
}
require_once ABSPATH . 'wp-admin/includes/post.php';
if (!defined('WP_RUN_CORE_TESTS')) define('WP_RUN_CORE_TESTS', true);
$source_file = getenv('FORMA_TEST_CONTENT');
$edited_file = getenv('FORMA_TEST_OUTPUT');
if (!$source_file || !$edited_file) throw new RuntimeException('Source and edited block fixtures required');
$source = file_get_contents($source_file);
$edited = file_get_contents($edited_file);
$original_user = get_current_user_id();
$user = get_users(['role' => 'administrator', 'number' => 1])[0] ?? null;
if (!$user) throw new RuntimeException('Local administrator required');
wp_set_current_user($user->ID);
$id = wp_insert_post(['post_type' => 'page', 'post_status' => 'publish', 'post_title' => 'Temporary Forma block workflow', 'post_content' => wp_slash($source), 'post_author' => $user->ID], true);
if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
$call = static function (string $operation, ?string $content = null) use ($id): array {
    $request = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    $request->set_param('id', $id);
    $request->set_param('operation', $operation);
    if ($content !== null) {
        $request->set_param('title', 'Temporary Forma block workflow');
        $request->set_param('content', $content);
    }
    $result = \Whitespace\FormaEditor\Workflow::handle($request);
    if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
    if ($result instanceof WP_REST_Response) $result = $result->get_data();
    return $result;
};
$check = static function (bool $value, string $message): void {
    if (!$value) throw new RuntimeException($message);
};
try {
    $call('open');
    $call('autosave', $edited);
    $check(get_post($id)->post_content === $source, 'Autosave must not publish');
    $check(wp_get_post_autosave($id, $user->ID)->post_content === $edited, 'Autosave preserves serialized blocks');
    $check($call('open')['autosave']['content'] === $edited, 'Reopen restores exact block content');
    $call('publish');
    $check(get_post($id)->post_content === $edited, 'Publish keeps exact block content');
    $check(parse_blocks(get_post($id)->post_content) === parse_blocks($edited), 'Block attributes and structure preserved');
    $call('autosave', $source);
    $call('discard');
    $check(get_post($id)->post_content === $edited && !wp_get_post_autosave($id, $user->ID), 'Discard returns to published blocks');
    echo "Block autosave, reopen, publish and discard passed.\n";
} finally {
    wp_delete_post($id, true);
    wp_set_current_user($original_user);
    if (get_post($id)) throw new RuntimeException('Temporary post was not removed');
}

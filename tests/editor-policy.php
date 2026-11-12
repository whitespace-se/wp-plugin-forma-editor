<?php

// Isolated policy tests; WordPress rendering, cookies and theme compatibility
// still require an authenticated integration test in a real installation.
define('ABSPATH', __DIR__);

class WP_Post
{
    public int $ID = 42;
    public string $post_type = 'page';
    public string $post_status = 'publish';
    public string $post_password = '';
}

$post = new WP_Post();
$allowed = true;
$admin = false;
$types = ['post', 'page'];
$rest = true;
$viewable = true;
$title_support = true;

function apply_filters($hook, $value) { return $GLOBALS['types']; }
function get_post_type_object($type) { return (object) ['show_in_rest' => $GLOBALS['rest']]; }
function is_post_type_viewable($type) { return $GLOBALS['viewable']; }
function post_type_supports($type, $feature) { return $GLOBALS['title_support']; }
function rest_get_route_for_post($post) { return '/wp/v2/pages/' . $post->ID; }
function current_user_can($capability, $id) { return $GLOBALS['allowed'] && $id === 42; }
function get_post($id = 0) { return !$id || $id === 42 ? $GLOBALS['post'] : null; }
function is_admin() { return $GLOBALS['admin']; }
function wp_verify_nonce($nonce, $action) { return $nonce === 'valid-' . $action; }
function esc_html__($text, $domain) { return $text; }
function wp_die($message, $title, $args) { throw new RuntimeException($message, $args['response']); }
function add_action(...$args) {}
function add_filter(...$args) {}

require dirname(__DIR__) . '/includes/editor.php';

use function Whitespace\FormaEditor\can_open;
use function Whitespace\FormaEditor\load_screen;
use function Whitespace\FormaEditor\preview_admin_bar;
use function Whitespace\FormaEditor\select_classic_editor;

$checks = 0;
function check(bool $condition, string $message): void
{
    if (!$condition) {
        throw new RuntimeException($message);
    }
    $GLOBALS['checks']++;
}

check(can_open($post), 'Published page should be supported');
$post->post_status = 'draft';
check(can_open($post), 'Saved draft should be supported');
foreach (['private', 'future', 'pending', 'trash', 'auto-draft', 'inherit'] as $status) {
    $post->post_status = $status;
    check(!can_open($post), 'Unsupported status: ' . $status);
}
$post->post_status = 'publish';
$post->post_password = 'secret';
check(!can_open($post), 'Password-protected content must be excluded');
$post->post_password = '';
$post->post_type = 'mod-text';
check(!can_open($post), 'Custom types require explicit opt-in');
$types[] = 'mod-text';
check(can_open($post), 'Explicitly opted-in viewable REST type should work');
foreach (['rest', 'viewable', 'title_support', 'allowed'] as $requirement) {
    $GLOBALS[$requirement] = false;
    check(!can_open($post), 'Missing requirement: ' . $requirement);
    $GLOBALS[$requirement] = true;
}
check(!can_open(null), 'Missing post must be rejected');

// get_post(0) falls back to the global post in WordPress. A malformed URL
// must not silently open whichever global post another plugin has selected.
foreach ([null, '', '0', '999', '-42', '42bad', ['42']] as $id) {
    $_GET = $id === null ? [] : ['post' => $id];
    try {
        load_screen();
        throw new RuntimeException('Invalid ID was accepted');
    } catch (RuntimeException $error) {
        check($error->getCode() === 403, 'Invalid ID must produce a 403');
    }
}
$_GET = ['post' => '42'];
load_screen();
$allowed = false;
try {
    load_screen();
    throw new RuntimeException('Unauthorized post was accepted');
} catch (RuntimeException $error) {
    check($error->getCode() === 403, 'Unauthorized direct link must produce a 403');
}
$allowed = true;

$_GET = [];
check(preview_admin_bar(true), 'Ordinary page keeps toolbar');
$_GET = ['forma-preview' => '42', '_forma_nonce' => 'bad'];
check(preview_admin_bar(true), 'Unverified marker keeps toolbar');
$_GET['_forma_nonce'] = ['invalid'];
check(preview_admin_bar(true), 'Array nonce must not cause a type error');
$_GET['_forma_nonce'] = 'valid-forma-preview-42';
check(!preview_admin_bar(true), 'Authenticated preview hides toolbar');
$allowed = false;
check(preview_admin_bar(true), 'Nonce does not replace post capability');
$allowed = true;
$admin = true;
check(preview_admin_bar(true), 'Preview marker must not hide admin toolbar');

$_GET = [];
check(select_classic_editor(true, $post), 'Normal edit links retain editor preference');
$_GET['forma-classic'] = '1';
check(!select_classic_editor(true, $post), 'Explicit classic link opens classic editor');
$allowed = false;
check(select_classic_editor(true, $post), 'Unauthorized request cannot change editor selection');

echo $checks . " policy checks passed.\n";

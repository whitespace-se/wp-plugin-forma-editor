<?php

// Run through WP-CLI on a local installation with Modularity enabled.
if (!defined('WP_CLI') || !WP_CLI || !in_array(wp_get_environment_type(), ['local', 'development'], true)) throw new RuntimeException('Local only');
$draft_request = ($args[0] ?? '') === 'draft-request';
if (!$draft_request && !defined('WP_RUN_CORE_TESTS')) define('WP_RUN_CORE_TESTS', true);
require_once ABSPATH . 'wp-admin/includes/post.php';

use Whitespace\FormaEditor\Modules;
use Whitespace\FormaEditor\Workflow;

$ids = [];
$original = get_current_user_id();
$cleanup = static function () use (&$ids, $original): void {
    $_GET = [];
    foreach (array_reverse($ids) as $id) {
        wp_delete_post($id, true);
        if (get_post($id)) throw new RuntimeException('Cleanup failed');
    }
    $ids = [];
    wp_set_current_user($original);
};
register_shutdown_function($cleanup);
$checks = 0;
$check = static function ($ok, $message) use (&$checks): void {
    if (!$ok) throw new RuntimeException($message);
    $checks++;
};
$call = static function ($id, $page, $op, $title = null, $content = null) {
    $r = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    foreach (['id' => $id, 'context' => $page, 'operation' => $op, 'title' => $title, 'content' => $content] as $key => $value) if ($value !== null) $r->set_param($key, $value);
    return Workflow::handle($r);
};
try {
    $users = get_users(['role' => 'administrator', 'number' => 1]);
    if (!$users) throw new RuntimeException('Existing local admin required');
    wp_set_current_user($users[0]->ID);
    foreach (['page', 'page', 'mod-text', 'mod-text', 'mod-spacer'] as $type) {
        $id = wp_insert_post(['post_type' => $type, 'post_status' => 'publish', 'post_title' => 'Forma module fixture ' . wp_generate_uuid4(), 'post_content' => 'Published body', 'post_author' => get_current_user_id()], true);
        if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
        $ids[] = $id;
    }
    [$page, $otherPage, $module, $other, $spacer] = $ids;
    update_post_meta($page, 'modularity-modules', ['content-area' => [['postid' => $module], ['postid' => (string) $other], ['postid' => $spacer]]]);
    update_post_meta($otherPage, 'modularity-modules', ['content-area' => [['postid' => (string) $module]]]);
    if ($draft_request) {
        wp_update_post(['ID' => $module, 'post_status' => 'draft']);
        $before = count(wp_get_post_revisions($module));
        $result = $call($module, $page, 'autosave', 'Own draft', 'Autosaved own draft');
        $check(defined('DOING_AUTOSAVE') && DOING_AUTOSAVE, 'Real autosave request constant');
        $check(is_array($result) && get_post($module)->post_content === 'Autosaved own draft', 'Own draft saved');
        $check(!wp_get_post_autosave($module), 'No separate own draft autosave');
        $check(count(wp_get_post_revisions($module)) === $before, 'No ordinary revision per draft autosave');
        echo "$checks own-draft module checks passed.\n";
        return;
    }
    $check(count(Modules::items($page)) === 3, 'List all module types');
    $check(Modules::items($page)[2]['url'] === null, 'Other types are not editable');
    $check(Modules::usage($module) === 2, 'Integer and string placements both count');
    wp_update_post(['ID' => $otherPage, 'post_status' => 'trash']);
    $check(Modules::usage($module) === 1, 'Usage excludes trashed pages from upstream results');
    wp_update_post(['ID' => $otherPage, 'post_status' => 'publish']);
    $contextRequest = new WP_REST_Request('GET', '/forma/v1/pages/' . $page . '/editor-context');
    $contextRequest['id'] = $page;
    $contextRequest['module'] = $module;
    $context = Whitespace\FormaEditor\Plugin::editor_context($contextRequest);
    $check($context['postId'] === $module && $context['lockNonce'] === wp_create_nonce('update-post_' . $module), 'Module context has matching post and lock nonce');
    $check($context['heading'] === get_post_type_object('mod-text')->labels->singular_name, 'Breadcrumb uses module type');
    $contextRequest['module'] = 0;
    $context = Whitespace\FormaEditor\Plugin::editor_context($contextRequest);
    $check($context['postId'] === $page && count($context['modules']) === 3 && $context['parentUrl'] === null, 'Page context restores module list');
    $contextRequest['module'] = $spacer;
    $check(is_wp_error(Whitespace\FormaEditor\Plugin::editor_context($contextRequest)), 'Context cannot open unsupported module');
    $contextRequest['module'] = $other;
    $contextRequest['id'] = $otherPage;
    $check(is_wp_error(Whitespace\FormaEditor\Plugin::editor_context($contextRequest)), 'Context rejects unrelated module');
    $check(!get_post_type_object('mod-text')->show_in_rest, 'Do not expose modules through core REST');
    $check(is_wp_error($call($other, $otherPage, 'open')), 'Reject unrelated module context');
    $check(is_wp_error($call($spacer, $page, 'open')), 'Reject unsupported module type');
    $result = $call($module, $page, 'open');
    $check(is_array($result) && !$result['autosave'], 'Open module');
    $result = $call($module, $page, 'autosave', 'Module changed', '<p>Unpublished module</p>');
    if (is_wp_error($result)) throw new RuntimeException($result->get_error_message());
    $check($result['autosave']['content'] === '<p>Unpublished module</p>', 'Autosave content');
    $check(get_post($module)->post_content === 'Published body', 'Module publication unchanged');
    $check(get_post($page)->post_content === 'Published body' && !wp_get_post_autosave($page), 'Page unaffected');
    $check(!wp_get_post_autosave($other), 'Other module unaffected');
    $check($call($module, $page, 'open')['autosave']['title'] === 'Module changed', 'Resume module after navigation');
    $check(str_contains($result['previewUrl'], 'forma-module=' . $module), 'Contextual page preview URL');
    $check(!str_contains($result['previewUrl'], 'preview_id=' . $module), 'Never preview module as main query');
    $savedRevision = wp_get_post_autosave($module, get_current_user_id());
    $result = $call($module, $page, 'publish');
    $check(is_array($result) && get_post($module)->post_title === 'Module changed', 'Publish module');
    $check(!wp_get_post_autosave($module), 'Published autosave removed');
    $check(get_post($otherPage)->post_content === 'Published body', 'Shared page post not modified');
    $revisions = wp_get_post_revisions($module);
    $check(count($revisions) > 0, 'Ordinary module revisions exist');
    $call($module, $page, 'autosave', 'Discard this', 'Discard body');
    $call($module, $page, 'discard');
    $check(!wp_get_post_autosave($module) && get_post($module)->post_title === 'Module changed', 'Discard restores published module');
    wp_update_post(['ID' => $other, 'post_status' => 'draft']);
    $result = $call($other, $page, 'autosave', 'Draft changed', 'Own draft body');
    $check(is_array($result) && get_post($other)->post_content === 'Own draft body' && !wp_get_post_autosave($other), 'Own drafts save directly');
    wp_set_current_user(0);
    $check(is_wp_error($call($module, $page, 'open')), 'Unauthorized editor rejected');
    wp_set_current_user($users[0]->ID);
    $second = get_users(['exclude' => [$users[0]->ID], 'number' => 1]);
    if (!$second) throw new RuntimeException('Existing second user required for lock test');
    update_post_meta($module, '_edit_lock', time() . ':' . $second[0]->ID);
    $check(!empty($call($module, $page, 'open')['lockOwner']), 'Other editor lock visible');
    $check(is_wp_error($call($module, $page, 'autosave', 'Blocked', 'Blocked')), 'Lock prevents overwrite');
    $check(empty($call($module, $page, 'takeover')['lockOwner']), 'Takeover uses native lock');
    update_post_meta($module, '_fixture_acf', 'field_fixture_acf');
    update_post_meta($module, 'fixture_acf', 'Retain metadata');
    $call($module, $page, 'autosave', 'Preview module', '<p>Preview-only module content</p>');
    $revision = wp_get_post_autosave($module, get_current_user_id());
    $check(get_post_meta($revision->ID, 'fixture_acf', true) === 'Retain metadata', 'Revision retains untouched ACF fields');
    $check(wp_restore_post_revision($revision->ID) === $module, 'Core restores module revision');
    $check(get_post($module)->post_title === 'Preview module', 'Restored title shared with classic editor');
    $check(get_post_meta($module, 'fixture_acf', true) === 'Retain metadata', 'Restore preserves unrelated ACF metadata');
    wp_update_post(['ID' => $other, 'post_status' => 'publish']);
    $call($other, $page, 'autosave', 'Other unpublished', 'Other unpublished body');
    $call($module, $page, 'autosave', 'Active preview', '<p>Active preview body</p>');
    $GLOBALS['wp_query'] = new WP_Query(['page_id' => $page]);
    $_GET = ['forma-preview' => (string) $page, '_forma_nonce' => wp_create_nonce('forma-preview-' . $page),
        'forma-module' => (string) $module, 'forma-module-autosave' => '1', '_forma_module_nonce' => 'invalid'];
    Modules::prepare_preview();
    $before = Modularity\Editor::getModule($module);
    $check($before->post_title !== 'Active preview', 'Invalid preview nonce cannot overlay');
    $_GET['_forma_module_nonce'] = wp_create_nonce('forma-module-' . $page . '-' . $module);
    Modules::prepare_preview();
    $pageRevision = _wp_put_post_revision($page, true);
    $check(apply_filters('acf/validate_post_id', $pageRevision, $page) === $page, 'Module preview does not select page ACF revision');
    $renderPost = Modularity\Editor::getModule($module);
    $check($renderPost->post_title === 'Active preview', 'Real module loader overlays active autosave');
    $check(Modularity\Editor::getModule($other)->post_title !== 'Other unpublished', 'Other module stays published');
    $html = Modularity\App::$display->outputModule($renderPost, [], [], false);
    $check(str_contains($html, 'Active preview body'), 'Real Blade module renderer uses autosaved content: ' . substr($html, 0, 1600));
    $check(get_post($module)->post_title !== 'Active preview', 'Preview does not mutate object cache');
    $check(defined('MODULARITY_DISABLE_FRAGMENT_CACHE') && MODULARITY_DISABLE_FRAGMENT_CACHE, 'Preview bypasses shared fragment cache');
    echo "$checks module integration checks passed.\n";
} finally {
    $cleanup();
}

<?php
// Run explicitly with wp eval-file on a disposable/local WordPress database.
// Creates only temporary users and posts; finally removes all test records.
require_once dirname(__DIR__) . '/source/Workflow.php';
require_once ABSPATH . 'wp-admin/includes/post.php';
require_once ABSPATH . 'wp-admin/includes/user.php';
// This suite performs multiple REST requests in one PHP process. Use core's
// own test switch so DOING_AUTOSAVE does not leak into later publish requests.
if (!defined('WP_RUN_CORE_TESTS')) define('WP_RUN_CORE_TESTS', true);

use Whitespace\FormaEditor\Workflow;

$original_user = get_current_user_id();
$users = [];
$posts = [];
$GLOBALS['forma_workflow_checks'] = 0;
function check_workflow($condition, string $message): void {
    if (!$condition) throw new RuntimeException($message);
    $GLOBALS['forma_workflow_checks']++;
}
function call_workflow(int $id, string $operation, ?string $title = null) {
    $request = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    $request->set_param('id', $id);
    $request->set_param('operation', $operation);
    if ($title !== null) $request->set_param('title', $title);
    $result = Workflow::handle($request);
    if ($result instanceof WP_REST_Response) {
        if ($result->is_error()) return $result->as_error();
        return $result->get_data();
    }
    return $result;
}
try {
    foreach (['editor', 'editor', 'contributor'] as $role) {
        $user = wp_insert_user(['user_login' => 'forma-test-' . wp_generate_uuid4(), 'user_pass' => wp_generate_password(), 'role' => $role]);
        if (is_wp_error($user)) throw new RuntimeException($user->get_error_message());
        $users[] = $user;
        if ($role === 'contributor') (new WP_User($user))->add_cap('publish_posts', false);
    }
    wp_set_current_user($users[0]);
    foreach (['publish', 'draft'] as $status) {
        $posts[] = wp_insert_post(['post_type' => 'post', 'post_status' => $status, 'post_title' => 'Original', 'post_content' => 'Keep content', 'post_excerpt' => 'Keep excerpt', 'post_author' => $users[0]], true);
    }
    [$published, $draft] = $posts;
    $state = call_workflow($published, 'open');
    check_workflow(is_array($state) && $state['lock'] && !$state['lockOwner'], 'Open acquires native lock');
    $state = call_workflow($published, 'autosave', 'Working title');
    check_workflow(is_array($state), 'Autosave succeeds: ' . (is_wp_error($state) ? $state->get_error_message() : ''));
    check_workflow(get_post($published)->post_title === 'Original', 'Public title unchanged');
    $auto = wp_get_post_autosave($published, $users[0]);
    check_workflow($auto && $auto->post_title === 'Working title' && $auto->post_content === 'Keep content' && $auto->post_excerpt === 'Keep excerpt', 'Native autosave preserves other fields');
    check_workflow(str_contains($state['previewUrl'], 'preview_nonce='), 'Preview renders native autosave');
    check_workflow(_set_preview(clone get_post($published))->post_title === 'Working title', 'Core preview overlays own autosave');
    check_workflow(call_workflow($published, 'open')['autosave']['title'] === 'Working title', 'Reopen discovers autosave');
    call_workflow($published, 'autosave', 'Original');
    check_workflow(!wp_get_post_autosave($published, $users[0]), 'Reverting title removes stale autosave');
    call_workflow($published, 'autosave', 'Updated title');
    $state = call_workflow($published, 'publish');
    check_workflow(!is_wp_error($state) && get_post($published)->post_title === 'Updated title' && get_post_status($published) === 'publish', 'Update publishes latest title');
    check_workflow(!$state['autosave'], 'No stale restore after update');
    check_workflow((bool) $state['revisionUrl'] === wp_revisions_enabled(get_post($published)), 'Revision link respects site revision policy');
    call_workflow($published, 'draft');
    check_workflow(get_post_status($published) === 'draft', 'Explicit unpublish');
    call_workflow($draft, 'autosave', 'Draft title');
    check_workflow(get_post($draft)->post_title === 'Draft title' && get_post_status($draft) === 'draft', 'Own draft core autosave');
    call_workflow($draft, 'publish');
    check_workflow(get_post_status($draft) === 'publish', 'Publish draft');
    // Classic-editor autosaves use this same core function and storage.
    wp_create_post_autosave(['post_ID' => $draft, 'post_type' => 'post', 'post_title' => 'Classic title', 'post_content' => 'Classic content', 'post_excerpt' => 'Keep excerpt']);
    $state = call_workflow($draft, 'resume');
    check_workflow($state['autosave']['otherChanges'], 'Detect classic content work');
    check_workflow(is_wp_error(call_workflow($draft, 'autosave', 'Do not overwrite')), 'Do not overwrite classic content');
    check_workflow(is_wp_error(call_workflow($draft, 'publish')), 'Do not silently publish classic content');
    call_workflow($draft, 'discard');
    check_workflow(!wp_get_post_autosave($draft, $users[0]) && get_post($draft)->post_content === 'Keep content', 'Discard only own autosave');
    wp_set_current_user($users[1]);
    check_workflow((bool) call_workflow($draft, 'open')['lockOwner'], 'Second editor sees lock');
    check_workflow(is_wp_error(call_workflow($draft, 'autosave', 'Blocked')), 'Locked write refused');
    check_workflow(!call_workflow($draft, 'takeover')['lockOwner'], 'Explicit takeover');
    wp_set_current_user($users[0]);
    check_workflow((bool) wp_check_post_lock($draft), 'Classic sees Forma lock');
    check_workflow(is_wp_error(call_workflow($draft, 'publish')), 'Old owner cannot publish');
    wp_set_post_lock($draft);
    wp_set_current_user($users[1]);
    check_workflow((bool) call_workflow($draft, 'pulse')['lockOwner'], 'Forma detects classic takeover');
    wp_set_current_user($users[0]);
    check_workflow(!call_workflow($draft, 'open')['lockOwner'], 'Same user follows native lock semantics');
    wp_set_current_user($users[2]);
    $contributor_post = wp_insert_post(['post_type' => 'post', 'post_status' => 'draft', 'post_title' => 'Contributor', 'post_author' => $users[2]], true);
    $posts[] = $contributor_post;
    check_workflow(!call_workflow($contributor_post, 'open')['canPublish'], 'Contributor has no publish control');
    check_workflow(!is_wp_error(call_workflow($contributor_post, 'autosave', 'Contributor draft')), 'Contributor autosave allowed');
    check_workflow(is_wp_error(call_workflow($contributor_post, 'publish')), 'Contributor publish denied');
    wp_set_current_user(0);
    check_workflow(is_wp_error(call_workflow($draft, 'open')), 'Anonymous cannot edit');
    echo $GLOBALS['forma_workflow_checks'] . " workflow integration checks passed.\n";
} finally {
    wp_set_current_user($original_user);
    foreach ($posts as $post) if (is_int($post)) wp_delete_post($post, true);
    foreach ($users as $user) wp_delete_user($user);
}

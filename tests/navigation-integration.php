<?php

// wp --path=wp --url=https://nora-m5.test eval-file <this file>
if (!defined('WP_CLI') || !WP_CLI || !in_array(wp_get_environment_type(), ['local', 'development'], true)) {
    throw new RuntimeException('Only run on an isolated local/development installation');
}
$single_draft_request = ($args[0] ?? '') === 'draft-request';
if (!$single_draft_request && !defined('WP_RUN_CORE_TESTS')) define('WP_RUN_CORE_TESTS', true);
require_once ABSPATH . 'wp-admin/includes/post.php';
use Whitespace\FormaEditor\NavigationFields;
use Whitespace\FormaEditor\NavigationPreview;
use Whitespace\FormaEditor\Workflow;

$ids = [];
$original_user = get_current_user_id();
$cleanup = static function () use (&$ids, $original_user): void {
    $_GET = [];
    foreach (array_reverse($ids) as $id) {
        wp_delete_post($id, true);
        if (get_post($id)) throw new RuntimeException('Fixture cleanup failed: ' . $id);
    }
    $ids = [];
    wp_set_current_user($original_user);
};
register_shutdown_function($cleanup);
$checks = 0;
$check = static function (bool $result, string $message) use (&$checks): void {
    if (!$result) throw new RuntimeException($message);
    $checks++;
};
$call = static function (int $id, string $op, ?array $values = null) {
    $request = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    $request->set_param('id', $id);
    $request->set_param('operation', $op);
    $request->set_param('title', get_post($id)->post_title);
    if ($values !== null) $request->set_param('navigation', $values);
    $result = Workflow::handle($request);
    if (is_wp_error($result)) throw new RuntimeException($result->get_error_code() . ': ' . $result->get_error_message());
    if ($result instanceof WP_REST_Response) throw new RuntimeException(wp_json_encode($result->get_data()));
    return $result;
};
try {
    $users = get_users(['role' => 'administrator', 'number' => 1]);
    if (!$users) throw new RuntimeException('An existing local administrator is required');
    wp_set_current_user($users[0]->ID);
    foreach ($single_draft_request ? ['draft'] : ['publish', 'draft', 'other-draft'] as $case) {
        $status = $case === 'other-draft' ? 'draft' : $case;
        $id = wp_insert_post(['post_type' => 'page', 'post_status' => $status, 'post_title' => 'Forma ACF fixture ' . wp_generate_uuid4(), 'post_author' => $case === 'other-draft' ? 0 : get_current_user_id()], true);
        if (is_wp_error($id)) throw new RuntimeException($id->get_error_message());
        $ids[] = $id;
        $check(count(NavigationFields::fields($id)) === 3, 'Expected the three effective navigation fields');
        $markup = NavigationFields::markup($id);
        $check(str_contains($markup, 'acf[field_56d83d4e77786]') && str_contains($markup, 'acf[field_page_hide_secondary_menu]') && str_contains($markup, 'acf[field_56d83d2777785]'), 'Actual ACF controls render all supported fields');
        $values = NavigationFields::values($id);
        $values['field_56d83d4e77786'] = 'Published navigation';
        acf_save_post($id, $values);
        update_metadata('post', $id, '_forma_fixture_unrelated', 'field_forma_fixture_unrelated');
        update_metadata('post', $id, 'forma_fixture_unrelated', 'Preserve this');
        wp_save_post_revision($id);
        $revision_count = count(wp_get_post_revisions($id));
        $values['field_56d83d4e77786'] = 'Autosaved "navigation" \\ title';
        $values['field_56d83d2777785'] = '1';
        $values['field_page_hide_secondary_menu'] = '1';
        $state = $call($id, 'autosave', $values);
        $source = wp_get_post_autosave($id, get_current_user_id());
        if ($single_draft_request) {
            $check(defined('DOING_AUTOSAVE') && DOING_AUTOSAVE, 'Uses real core autosave context');
            $check(!$source && (array) $state['navigation'] === $values, 'Core own-draft autosave stores ACF on parent');
            $check(count(wp_get_post_revisions($id)) === $revision_count, 'Own-draft autosave does not create ordinary revisions');
            echo "PASS $checks single-request draft checks with real DOING_AUTOSAVE; no users created\n";
            return;
        }
        if ($case !== 'draft') {
            $check((bool) $source, 'Metadata-only autosave must exist');
            $check(get_post_meta($id, 'custom_menu_title', true) === 'Published navigation', 'Published parent must not change');
            $check(get_post_meta($source->ID, 'forma_fixture_unrelated', true) === 'Preserve this', 'Autosave must preserve unrelated ACF metadata');
            $check((array) $state['autosave']['navigation'] === $values, 'Autosave roundtrip including quotes and slashes');
            $open = $call($id, 'open');
            $check(!$open['autosave']['otherChanges'], 'Supported ACF autosave can resume');
            $check(str_contains($open['previewUrl'], 'preview_nonce='), 'Metadata-only change gets a revision preview');
            $call($id, 'discard');
            $check(!wp_get_post_autosave($id, get_current_user_id()), 'Discard removes autosave');
            $check(get_post_meta($id, 'custom_menu_title', true) === 'Published navigation', 'Discard preserves parent');
            $call($id, 'autosave', $values);
        } else {
            $check(!$source, 'Own draft uses core parent save');
            $check((array) $state['navigation'] === $values, 'Own draft saves ACF values');
        }
        $state = $call($id, 'publish');
        $check($state['status'] === 'publish' && (array) $state['navigation'] === $values, 'Publishing carries supported ACF fields');
        $check(get_post_meta($id, 'forma_fixture_unrelated', true) === 'Preserve this', 'Publishing preserves unrelated fields');
        $revisions = wp_get_post_revisions($id);
        $saved = reset($revisions);
        $check(get_post_meta($saved->ID, 'custom_menu_title', true) === $values['field_56d83d4e77786'], 'Final revision contains ACF values');
        $values['field_56d83d4e77786'] = 'Next revision';
        $call($id, 'autosave', $values);
        $call($id, 'publish');
        wp_restore_post_revision($saved->ID);
        $check(get_post_meta($id, 'custom_menu_title', true) === 'Autosaved "navigation" \\ title', 'Core revision restore restores ACF values');
        $check(get_post_meta($id, 'forma_fixture_unrelated', true) === 'Preserve this', 'Core restore preserves unrelated ACF');
        $state = $call($id, 'draft');
        $check($state['status'] === 'draft', 'Change to draft retains workflow');
    }
    // The same core storage is used when returning from the classic editor.
    wp_update_post(['ID' => $id, 'post_status' => 'publish']);
    $classic = wp_create_post_autosave(['post_ID' => $id, 'post_type' => 'page', 'post_title' => 'Classic title', 'post_content' => '', 'post_excerpt' => '']);
    $check(is_int($classic) && $classic > 0, 'Classic core autosave created');
    acf_copy_metadata($id, $classic);
    $values['field_56d83d4e77786'] = 'Classic navigation';
    acf_save_post($classic, $values);
    $state = $call($id, 'open');
    $check(!$state['autosave']['otherChanges'] && ((array) $state['autosave']['navigation'])['field_56d83d4e77786'] === 'Classic navigation', 'Classic revision can resume in Forma');
    update_metadata('post', $classic, 'forma_fixture_unrelated', 'Unsupported edit');
    $check($call($id, 'open')['autosave']['otherChanges'], 'Unsupported classic fields block Forma editing');
    $call($id, 'discard');
    $check(get_post_meta($id, 'forma_fixture_unrelated', true) === 'Preserve this', 'Discarding unsupported autosave preserves published data');

    $reject = static fn() => 'Intentional validation failure';
    add_filter('acf/validate_value/key=field_56d83d4e77786', $reject);
    $check(is_wp_error(NavigationFields::validate($id, $values)), 'Native ACF validation hook is respected');
    remove_filter('acf/validate_value/key=field_56d83d4e77786', $reject);
    $reject_save = static function (): void { acf_add_validation_error('', 'Intentional form-level rejection'); };
    add_action('acf/validate_save_post', $reject_save);
    $check(is_wp_error(NavigationFields::validate($id, $values)), 'ACF form-level validation hook is respected');
    remove_action('acf/validate_save_post', $reject_save);
    $check(is_wp_error(NavigationFields::validate($id, $values + ['field_unexpected' => 'x'])), 'Unknown fields rejected');
    $check(is_wp_error(NavigationFields::validate($id, ['field_56d83d4e77786' => 'Only one field'])), 'Incomplete payload rejected');
    $values = NavigationFields::values($id);
    $request = new WP_REST_Request('POST', '/forma/v1/posts/' . $id . '/workflow');
    $request->set_body_params(['id' => $id, 'operation' => 'autosave', 'title' => get_post($id)->post_title, 'navigation' => $values + ['field_unexpected' => 'x']]);
    $check(is_wp_error(Workflow::handle($request)), 'Workflow rejects unknown fields before any write');
    $user_id = get_current_user_id();
    wp_set_current_user(0);
    $check(is_wp_error(Workflow::handle($request)), 'Unauthenticated ACF writes rejected');
    wp_set_current_user($user_id);
    $other_users = get_users(['exclude' => [$user_id], 'number' => 1, 'fields' => 'ID']);
    if (!$other_users) throw new RuntimeException('A second existing local account is required for the lock check');
    update_post_meta($id, '_edit_lock', time() . ':' . $other_users[0]);
    $request->set_param('navigation', $values);
    $locked = Workflow::handle($request);
    $check(is_wp_error($locked) && $locked->get_error_code() === 'forma_locked', 'Another editor lock rejects ACF writes');
    $check($call($id, 'takeover')['lockOwner'] === null, 'Explicit takeover permits editing');
    $changed = $values;
    $changed['field_56d83d4e77786'] = 'Temporary change';
    $call($id, 'autosave', $changed);
    $call($id, 'autosave', $values);
    $check(!wp_get_post_autosave($id, get_current_user_id()), 'Reverting all ACF fields removes autosave');

    $values['field_56d83d4e77786'] = 'Preview navigation';
    $values['field_56d83d2777785'] = '0';
    $values['field_page_hide_secondary_menu'] = '0';
    $call($id, 'autosave', $values);
    $own_revision = wp_get_post_autosave($id, get_current_user_id());
    // A later ordinary revision must not replace the user's preview values.
    // This represents a separate request. ACF's did_action('acf/save_post')
    // counter cannot be reset between the simulated requests in this process.
    add_filter('acf/revisions/skip_legacy_metabox_handling', '__return_true');
    $later = _wp_put_post_revision($id);
    remove_filter('acf/revisions/skip_legacy_metabox_handling', '__return_true');
    acf_copy_metadata($id, $later);
    wp_set_current_user((int) $other_users[0]);
    add_filter('acf/revisions/skip_legacy_metabox_handling', '__return_true');
    $other_revision = _wp_put_post_revision($id, true);
    remove_filter('acf/revisions/skip_legacy_metabox_handling', '__return_true');
    acf_copy_metadata($id, $other_revision);
    update_metadata('post', $other_revision, 'custom_menu_title', 'Another editor private draft');
    wp_set_current_user($user_id);
    $GLOBALS['post'] = _set_preview(clone get_post($id));
    $GLOBALS['wp_query']->queried_object = get_post($id);
    $GLOBALS['wp_query']->queried_object_id = $id;
    $_GET = ['forma-preview' => (string) $id, '_forma_nonce' => wp_create_nonce('forma-preview-' . $id), 'preview_id' => (string) $id, 'preview_nonce' => 'invalid', 'preview' => 'true'];
    $key_before = apply_filters('Municipio/Navigation/Cache/Key', 'hide_in_menu');
    $cache_before = wp_cache_get($key_before);
    NavigationPreview::prepare();
    $check(apply_filters('Municipio/Navigation/Cache/Key', 'hide_in_menu') === $key_before, 'Invalid nonce cannot install preview overlay');
    $_GET['preview_nonce'] = wp_create_nonce('post_preview_' . $id);
    NavigationPreview::prepare();
    acf_get_store('values')->reset();
    acf()->revisions->cache = [];
    $check(get_field('custom_menu_title', $id) === 'Preview navigation', 'ACF previews own autosave rather than latest revision: ' . wp_json_encode(['value' => get_field('custom_menu_title', $id), 'revision' => $own_revision->ID, 'raw' => get_post_meta($own_revision->ID, 'custom_menu_title', true), 'resolved' => acf_get_valid_post_id($id), 'has_meta' => (bool) acf_get_meta($own_revision->ID)]));
    $check(get_post_meta($id, 'custom_menu_title', true) === 'Preview navigation', 'Core metadata preview cannot use another user autosave');
    $check(!get_field('page_hide_secondary_menu', $id), 'Secondary navigation uses preview value');
    $check(!in_array($id, Municipio\Controller\Navigation\Helper\GetHiddenPostIds::getHiddenPostIds()), 'Real Municipio hidden-page helper uses preview value');
    $menu = new class($id) implements Municipio\Controller\Navigation\MenuInterface {
        public function __construct(private int $id) {}
        public function getMenu(): array { return ['items' => [['id' => $this->id, 'label' => 'Unmodified']]]; }
        public function getConfig(): Municipio\Controller\Navigation\Config\MenuConfigInterface { throw new RuntimeException('Unused'); }
    };
    $decorator = new Municipio\Controller\Navigation\Decorators\Menu\PageTreeAppendMenuItemsCustomTitle($menu);
    $check($decorator->getMenu()['items'][0]['label'] === 'Preview navigation', 'Real menu decorator uses preview title');
    $check(wp_cache_get($key_before) === $cache_before, 'Public cache unchanged by preview');
    $check(get_post_meta($id)['custom_menu_title'][0] !== 'Preview navigation', 'Preview does not write parent');
    $check(apply_filters('Municipio/Navigation/Cache/Key', 'hide_in_menu') !== $key_before, 'Preview derived caches use separate namespace');
    echo "PASS $checks navigation workflow checks; no users created\n";
} finally {
    $cleanup();
    echo "All temporary pages and revisions removed and absence verified\n";
}

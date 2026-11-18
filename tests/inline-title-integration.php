<?php

// Read-only rendering against an existing local page; no posts/users are created.
if (!defined('WP_CLI') || !WP_CLI || !in_array(wp_get_environment_type(), ['local', 'development'], true)) throw new RuntimeException('Local only');

use Whitespace\FormaEditor\Plugin;

$id = (int) ($args[0] ?? 175);
$mode = $args[1] ?? 'preview';
$admin = get_users(['role' => 'administrator', 'number' => 1])[0] ?? null;
if (!$admin || !get_post($id)) throw new RuntimeException('Existing admin and page required');
wp_set_current_user($admin->ID);
$before = get_post($id)->post_title;
$_GET = $mode === 'public' ? [] : ['forma-preview' => (string) $id, '_forma_nonce' => wp_create_nonce('forma-preview-' . $id)];
if ($mode === 'invalid') $_GET['_forma_nonce'] = 'invalid';
global $wp_query, $wp_the_query, $post;
$wp_query = $wp_the_query = new WP_Query(['page_id' => $id]);
$post = get_post($id);
if ($mode === 'empty') {
    add_filter('Municipio/viewData', static function (array $data) use ($id): array {
        $object = $data['post'] ?? null;
        if ($object instanceof \Municipio\PostObject\PostObjectInterface && $object->getId() === $id) {
            $data['post'] = new class($object) extends \Municipio\PostObject\Decorators\AbstractPostObjectDecorator {
                public function getTitle(): string { return ''; }
            };
        }
        return $data;
    }, 99);
}
do_action('wp');
ob_start();
do_action('template_redirect');
apply_filters('template_include', get_page_template());
$html = ob_get_clean();
$dom = new DOMDocument();
@$dom->loadHTML($html);
$xpath = new DOMXPath($dom);
$inline = $xpath->query('//script[@id="forma-inline-title-js"]');
$expected = in_array($mode, ['preview', 'empty'], true);
if ($inline->length !== ($expected ? 1 : 0)) throw new RuntimeException('Unexpected inline asset exposure: ' . $mode);
if ($expected) {
    $config = json_decode($inline->item(0)->getAttribute('data-config'), true, 512, JSON_THROW_ON_ERROR);
    if ($config['pageId'] !== $id || $config['origin'] !== 'https://nora-m5.test') throw new RuntimeException('Wrong message target');
    $headings = $xpath->query('//h1[@id="page-title"]');
    if ($headings->length !== 1) throw new RuntimeException('Expected exactly one Municipio title; rendering: ' . substr(strip_tags($html), 0, 500));
    if ($mode === 'empty' && !str_contains($headings->item(0)->textContent, "\u{200B}")) throw new RuntimeException('Empty heading not retained');
}
if (get_post($id)->post_title !== $before) throw new RuntimeException('Rendering changed persisted title');
echo "Inline title rendering passed: {$mode}; database unchanged.\n";

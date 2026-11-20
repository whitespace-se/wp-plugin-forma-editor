<?php
/**
 * Plugin Name: Forma Editor
 * Plugin URI: https://github.com/whitespace-se/wp-plugin-forma-editor
 * Description: A visual editing workspace for WordPress and Municipio.
 * Version: 0.1.0-alpha.2
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * Author: Whitespace
 * Author URI: https://whitespace.se
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 * Text Domain: forma-editor
 */

declare(strict_types=1);

namespace Whitespace\FormaEditor;

defined('ABSPATH') || exit;

define('FORMA_EDITOR_FILE', __FILE__);
define('FORMA_EDITOR_VERSION', '0.1.0-alpha.2');

$autoload = __DIR__ . '/vendor/autoload.php';
if (is_readable($autoload)) {
    require_once $autoload;
}

// Composer sites supply the root autoloader. ZIP installs must also work
// without requiring Composer or Node on the WordPress host.
if (!class_exists(Plugin::class)) {
    require_once __DIR__ . '/source/Plugin.php';
}
if (!class_exists(Assets::class)) {
    require_once __DIR__ . '/source/Assets.php';
}
if (!class_exists(Workflow::class)) {
    require_once __DIR__ . '/source/Workflow.php';
}
add_action('rest_api_init', [Workflow::class, 'register']);
add_action('rest_api_init', [Plugin::class, 'register_context']);
require_once __DIR__ . '/source/Modules.php';
// Modularity collects its posts on wp; install the preview overlay first.
add_action('wp', [Modules::class, 'prepare_preview'], -100);
require_once __DIR__ . '/source/NavigationFields.php';
require_once __DIR__ . '/source/NavigationPreview.php';
NavigationFields::register();
add_action('template_redirect', [NavigationPreview::class, 'prepare'], -10);

// Registration is inert until the editor screen explicitly enqueues its assets.
add_action('init', [Assets::class, 'register']);
require_once __DIR__ . '/source/Blocks.php';
add_action('wp_enqueue_scripts', [Blocks::class, 'enqueue'], 100);
add_action('admin_menu', [Plugin::class, 'register_screen']);
add_action('admin_bar_menu', [Plugin::class, 'adapt_admin_bar'], 100);
add_filter('show_admin_bar', [Plugin::class, 'preview_admin_bar'], 100);
add_filter('use_block_editor_for_post', [Plugin::class, 'select_editor'], 100, 2);
add_action('template_redirect', [Plugin::class, 'preview_headers']);
add_action('wp_head', [Plugin::class, 'preview_guard'], -100);
add_filter('Municipio/viewData', [Plugin::class, 'inline_title_data'], 100);

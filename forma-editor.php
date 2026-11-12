<?php
/**
 * Plugin Name: Forma Editor
 * Plugin URI: https://github.com/whitespace-se/wp-plugin-forma-editor
 * Description: Foundation for a visual WordPress editing workspace.
 * Version: 0.1.0-dev
 * Requires at least: 6.6
 * Requires PHP: 8.1
 * Author: Whitespace
 * Author URI: https://whitespace.se
 * License: GPL-2.0-or-later
 * License URI: https://www.gnu.org/licenses/old-licenses/gpl-2.0.html
 * Text Domain: forma-editor
 */

namespace Whitespace\FormaEditor;

defined('ABSPATH') || exit;

require_once __DIR__ . '/includes/assets.php';
require_once __DIR__ . '/includes/editor.php';

// Registration is inert until the editor screen explicitly enqueues its assets.
add_action('init', __NAMESPACE__ . '\\register_assets');
add_action('admin_menu', __NAMESPACE__ . '\\register_screen');
add_action('admin_bar_menu', __NAMESPACE__ . '\\adapt_admin_bar', 100);
add_filter('show_admin_bar', __NAMESPACE__ . '\\preview_admin_bar', 100);
add_filter('use_block_editor_for_post', __NAMESPACE__ . '\\select_classic_editor', 100, 2);
add_action('template_redirect', __NAMESPACE__ . '\\preview_headers');

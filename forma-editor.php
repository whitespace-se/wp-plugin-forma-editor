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

// Registration is inert until the editor screen explicitly enqueues its assets.
add_action('init', __NAMESPACE__ . '\\register_assets');

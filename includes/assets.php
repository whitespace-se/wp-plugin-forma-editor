<?php

namespace Whitespace\FormaEditor;

defined('ABSPATH') || exit;

function register_assets(): void
{
    $directory = dirname(__DIR__) . '/build/';

    // A source checkout must remain activatable before the first frontend build.
    if (!is_readable($directory . 'editor.asset.php') || !is_readable($directory . 'editor.js') || !is_readable($directory . 'editor.css')) {
        return;
    }

    $asset = require $directory . 'editor.asset.php';
    $url = plugin_dir_url(dirname(__DIR__) . '/forma-editor.php') . 'build/';

    wp_register_script('forma-editor', $url . 'editor.js', $asset['dependencies'], $asset['version'], true);

    wp_register_style('forma-editor', $url . 'editor.css', [], $asset['version']);
}

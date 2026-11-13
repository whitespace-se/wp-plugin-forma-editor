<?php

declare(strict_types=1);

namespace Whitespace\FormaEditor;

final class Assets
{
    public static function register(): void
    {
        $directory = dirname(__DIR__) . '/build/';

        if (!is_readable($directory . 'editor.asset.php') || !is_readable($directory . 'editor.js') || !is_readable($directory . 'editor.css')) {
            return;
        }

        $asset = require $directory . 'editor.asset.php';
        // Use the registered plugin file so WordPress also resolves symlinked
        // local Composer installs inside the public plugin URL space.
        $url = plugin_dir_url(FORMA_EDITOR_FILE) . 'build/';
        wp_register_script('forma-editor', $url . 'editor.js', [...$asset['dependencies'], 'heartbeat'], $asset['version'], true);
        wp_register_style('forma-editor', $url . 'editor.css', [], $asset['version']);
    }
}

/**
 * VSCode Recent Folders — Preferences
 * Settings UI for the GNOME Shell extension.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class VSCodeRecentFoldersPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'VS Code Recent Folders',
            icon_name: 'folder-recent-symbolic',
        });
        window.add(page);

        // ── Launch Settings group ─────────────────────────────────────────────
        const launchGroup = new Adw.PreferencesGroup({
            title: 'Launch Settings',
            description: 'Configure how VS Code windows are opened from the dock menu',
        });
        page.add(launchGroup);

        const ozoneRow = new Adw.SwitchRow({
            title: 'Use Ozone X11 Platform',
            subtitle: 'Launch VS Code with --ozone-platform=x11 (useful on Wayland sessions)',
        });
        settings.bind('use-ozone-x11', ozoneRow, 'active', Gio.SettingsBindFlags.DEFAULT);
        launchGroup.add(ozoneRow);

        // ── Menu Settings group ───────────────────────────────────────────────
        const menuGroup = new Adw.PreferencesGroup({
            title: 'Menu Settings',
            description: 'Configure the recent folders context menu',
        });
        page.add(menuGroup);

        const maxRow = new Adw.SpinRow({
            title: 'Maximum Recent Folders',
            subtitle: 'Number of folders to show in the dock right-click menu',
            adjustment: new Gtk.Adjustment({
                lower: 1,
                upper: 50,
                step_increment: 1,
                value: 10,
            }),
        });
        settings.bind('max-recent-folders', maxRow, 'value', Gio.SettingsBindFlags.DEFAULT);
        menuGroup.add(maxRow);
    }
}

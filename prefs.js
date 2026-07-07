/**
 * Smart Dock Menus — Preferences
 * Settings UI for the GNOME Shell extension.
 */

import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';
import Gio from 'gi://Gio';
import { ExtensionPreferences } from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

export default class SmartDockMenusPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const s = this.getSettings();
        window.set_default_size(600, 700);

        window.add(this._buildCodeEditorsPage(s));
        window.add(this._buildFilesPage(s));
        window.add(this._buildAppsPage(s));
        window.add(this._buildSystemPage(s));
    }

    _spinRow(title, subtitle, key, lower, upper, s) {
        const row = new Adw.SpinRow({
            title,
            subtitle,
            adjustment: new Gtk.Adjustment({ lower, upper, step_increment: 1, value: lower }),
        });
        s.bind(key, row, 'value', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _switchRow(title, subtitle, key, s) {
        const row = new Adw.SwitchRow({ title, subtitle });
        s.bind(key, row, 'active', Gio.SettingsBindFlags.DEFAULT);
        return row;
    }

    _group(title, description) {
        return new Adw.PreferencesGroup({ title, description });
    }

    // ── Page 1: Code Editors ─────────────────────────────────────────────────
    _buildCodeEditorsPage(s) {
        const page = new Adw.PreferencesPage({
            title: 'Code Editors',
            icon_name: 'text-editor-symbolic',
        });

        // VS Code
        const vsGroup = this._group('Visual Studio Code',
            'Right-click the VS Code dock icon to jump into a recent project');
        vsGroup.add(this._switchRow('Enable VS Code', 'Show recent folders in the VS Code dock menu', 'enable-vscode', s));
        vsGroup.add(this._switchRow('Enable VSCodium', 'Show recent folders in the VSCodium dock menu', 'enable-vscodium', s));
        vsGroup.add(this._switchRow('Enable Cursor', 'Show recent folders in the Cursor dock menu', 'enable-cursor', s));
        vsGroup.add(this._spinRow('Maximum Recent Folders', 'Applies to VS Code, VSCodium, and Cursor', 'max-recent-folders', 1, 50, s));
        page.add(vsGroup);

        // Wayland
        const waylandGroup = this._group('Wayland Compatibility',
            'Only needed if editors appear blurry or fail to open on Wayland');
        waylandGroup.add(this._switchRow(
            'Use Ozone X11 Platform',
            'Launches editors with --ozone-platform=x11',
            'use-ozone-x11', s));
        page.add(waylandGroup);

        return page;
    }

    // ── Page 2: Files & Documents ─────────────────────────────────────────────
    _buildFilesPage(s) {
        const page = new Adw.PreferencesPage({
            title: 'Files & Docs',
            icon_name: 'folder-symbolic',
        });

        const filesGroup = this._group('GNOME Files',
            'Right-click the Files icon to open a recently used file');
        filesGroup.add(this._switchRow('Enable Files', 'Show recent files in the Nautilus dock menu', 'enable-files', s));
        filesGroup.add(this._spinRow('Maximum Recent Files', 'Number of files to show', 'max-recent-files', 1, 50, s));
        page.add(filesGroup);

        const editorGroup = this._group('Text Editor',
            'Right-click Text Editor to pick up where you left off — filtered to text file types only');
        editorGroup.add(this._switchRow('Enable Text Editor', 'Show recent documents in the Text Editor dock menu', 'enable-text-editor', s));
        editorGroup.add(this._spinRow('Maximum Recent Documents', 'Number of documents to show', 'max-recent-docs', 1, 50, s));
        page.add(editorGroup);

        return page;
    }

    // ── Page 3: Apps ─────────────────────────────────────────────────────────
    _buildAppsPage(s) {
        const page = new Adw.PreferencesPage({
            title: 'Apps',
            icon_name: 'application-x-executable-symbolic',
        });

        const spotifyGroup = this._group('Spotify',
            'Right-click Spotify to see what\'s playing and control playback via MPRIS');
        spotifyGroup.add(this._switchRow('Enable Spotify', 'Show now playing + controls in the Spotify dock menu', 'enable-spotify', s));
        page.add(spotifyGroup);

        const gkGroup = this._group('GitKraken',
            'Right-click GitKraken to jump into a recently opened repository');
        gkGroup.add(this._switchRow('Enable GitKraken', 'Show recent repos in the GitKraken dock menu', 'enable-gitkraken', s));
        gkGroup.add(this._spinRow('Maximum Recent Repos', 'Number of repositories to show', 'max-recent-repos', 1, 50, s));
        page.add(gkGroup);

        const obsGroup = this._group('Obsidian',
            'Right-click Obsidian to open a recently used vault (sorted by last opened)');
        obsGroup.add(this._switchRow('Enable Obsidian', 'Show recent vaults in the Obsidian dock menu', 'enable-obsidian', s));
        obsGroup.add(this._spinRow('Maximum Recent Vaults', 'Number of vaults to show', 'max-recent-vaults', 1, 20, s));
        page.add(obsGroup);

        return page;
    }

    // ── Page 4: System ───────────────────────────────────────────────────────
    _buildSystemPage(s) {
        const page = new Adw.PreferencesPage({
            title: 'System',
            icon_name: 'preferences-system-symbolic',
        });

        const settingsGroup = this._group('GNOME Settings',
            'Right-click Settings to jump directly to Wi-Fi, Sound, Displays, Power, and more');
        settingsGroup.add(this._switchRow('Enable Settings shortcuts',
            'Show quick panel shortcuts in the Settings dock menu', 'enable-settings', s));

        const panelsRow = new Adw.ActionRow({
            title: 'Panels shown',
            subtitle: 'Wi-Fi · Bluetooth · Network · Sound · Displays · Power · Appearance · Notifications · Privacy · Apps',
        });
        settingsGroup.add(panelsRow);
        page.add(settingsGroup);

        return page;
    }
}

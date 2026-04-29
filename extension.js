/**
 * VSCode Recent Folders — GNOME Shell Extension
 * Adds recently opened VS Code folders to the right-click dock icon menu.
 * Compatible with GNOME 46, Dash-to-Dock, and Ubuntu Dock.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

// ── VS Code app IDs to recognise ─────────────────────────────────────────────
const VSCODE_APP_IDS = [
    'code.desktop',
    'code-url-handler.desktop',
    'visual-studio-code.desktop',
    'com.visualstudio.code.desktop',
    'snap.code.code.desktop',
];

const PATCH_MARKER = Symbol('vscodeRecentFoldersPatch');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVSCodeApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return (
        VSCODE_APP_IDS.some(id => id.toLowerCase() === lower) ||
        lower.includes('visual-studio-code') ||
        lower.includes('vscode') ||
        lower.startsWith('code.')
    );
}

function getDbPaths() {
    const home = GLib.get_home_dir();
    return [
        `${home}/.config/Code/User/globalStorage/state.vscdb`,
        `${home}/snap/code/common/.config/Code/User/globalStorage/state.vscdb`,
        `${home}/.var/app/com.visualstudio.code/config/Code/User/globalStorage/state.vscdb`,
    ];
}

function getRecentFolders(maxFolders) {
    const python3 = GLib.find_program_in_path('python3') ?? '/usr/bin/python3';
    const pyScript = [
        'import sqlite3, sys',
        'con = sqlite3.connect(sys.argv[1])',
        "cur = con.execute(\"SELECT value FROM ItemTable WHERE key='history.recentlyOpenedPathsList'\")",
        'row = cur.fetchone()',
        'print(row[0] if row else "", end="")',
    ].join('\n');

    for (const dbPath of getDbPaths()) {
        try {
            const file = Gio.File.new_for_path(dbPath);
            if (!file.query_exists(null)) continue;

            const [ok, stdout] = GLib.spawn_sync(
                null,
                [python3, '-c', pyScript, dbPath],
                null,
                GLib.SpawnFlags.DEFAULT,
                null
            );
            if (!ok || !stdout?.length) continue;

            const raw = new TextDecoder('utf-8').decode(stdout).trim();
            if (!raw) continue;

            const json = JSON.parse(raw);
            const entries = json?.entries;
            if (!entries?.length) continue;

            const folders = [];
            for (const entry of entries) {
                const uri = entry.folderUri;
                if (!uri?.startsWith('file://')) continue;
                const path = decodeURIComponent(uri.slice(7));
                if (!path) continue;
                const label = GLib.path_get_basename(path) || path;
                folders.push({ path, label });
                if (folders.length >= maxFolders) break;
            }

            if (folders.length > 0) return folders;
        } catch (_e) { }
    }
    return [];
}

function openInVSCode(folderPath, useOzoneX11) {
    const code = GLib.find_program_in_path('code');
    const extraFlags = useOzoneX11 ? ['--ozone-platform=x11'] : [];
    const candidates = [
        ...(code ? [[code, '--new-window', ...extraFlags, folderPath]] : []),
        ['/usr/bin/code', '--new-window', ...extraFlags, folderPath],
        ['/snap/bin/code', '--new-window', ...extraFlags, folderPath],
        ['/usr/local/bin/code', '--new-window', ...extraFlags, folderPath],
    ];
    for (const cmd of candidates) {
        try { Gio.Subprocess.new(cmd, Gio.SubprocessFlags.NONE); return; } catch (_e) { }
    }
}

// ── Menu injection ────────────────────────────────────────────────────────────

function appendFoldersToMenu(menu, settings) {
    const maxFolders = settings.get_int('max-recent-folders');
    const useOzoneX11 = settings.get_boolean('use-ozone-x11');
    const folders = getRecentFolders(maxFolders);
    if (!folders.length) return;
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Folders'));
    for (const { path, label } of folders)
        menu.addAction(label, () => openInVSCode(path, useOzoneX11));
}

function patchPopupOpen(settings) {
    if (PopupMenu.PopupMenu.prototype[PATCH_MARKER]) return;
    const original = PopupMenu.PopupMenu.prototype.open;
    PopupMenu.PopupMenu.prototype[PATCH_MARKER] = original;
    PopupMenu.PopupMenu.prototype.open = function (animate) {
        try {
            const appId = this.sourceActor?.app?.get_id?.() ?? '';
            if (isVSCodeApp(appId))
                appendFoldersToMenu(this, settings);
        } catch (_e) { }
        original.call(this, animate);
    };
}

function unpatchPopupOpen() {
    const original = PopupMenu.PopupMenu.prototype[PATCH_MARKER];
    if (!original) return;
    PopupMenu.PopupMenu.prototype.open = original;
    delete PopupMenu.PopupMenu.prototype[PATCH_MARKER];
}

// ── Extension entry point ─────────────────────────────────────────────────────

export default class VSCodeRecentFoldersExtension extends Extension {
    enable() {
        this._settings = this.getSettings();
        patchPopupOpen(this._settings);
    }
    disable() {
        unpatchPopupOpen();
        this._settings = null;
    }
}

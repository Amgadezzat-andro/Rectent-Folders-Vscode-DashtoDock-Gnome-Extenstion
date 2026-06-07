/**
 * VSCode Recent Folders — GNOME Shell Extension
 * Adds recently opened VS Code folders to the right-click dock icon menu.
 * Compatible with GNOME 46, Dash-to-Dock, and Ubuntu Dock.
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

// ── VS Code app IDs to recognise ─────────────────────────────────────────────
const VSCODE_APP_IDS = [
    'code.desktop',
    'code-url-handler.desktop',
    'visual-studio-code.desktop',
    'com.visualstudio.code.desktop',
    'snap.code.code.desktop',
];

const PATCH_MARKER = Symbol('vscodeRecentFoldersPatch');

// ── Folder cache (populated asynchronously) ───────────────────────────────────
let _folderCache = [];

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

function _folderLabel(path) {
    const home = GLib.get_home_dir();
    const parent = GLib.path_get_dirname(path);
    const displayParent = parent.startsWith(home) ? '~' + parent.slice(home.length) : parent;
    return `${GLib.path_get_basename(path) || path}  ${displayParent}`;
}

function _workspaceLabel(configPath) {
    const home = GLib.get_home_dir();
    const basename = GLib.path_get_basename(configPath).replace(/\.code-workspace$/, '');
    const parent = GLib.path_get_dirname(configPath);
    const displayParent = parent.startsWith(home) ? '~' + parent.slice(home.length) : parent;
    return `${basename}  ${displayParent}`;
}

async function fetchRecentFoldersAsync(maxFolders) {
    const python3 = GLib.find_program_in_path('python3') ?? '/usr/bin/python3';
    const extensionDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
    const pyScript = `${extensionDir}/fetch_recent.py`;

    for (const dbPath of getDbPaths()) {
        try {
            const file = Gio.File.new_for_path(dbPath);
            if (!file.query_exists(null)) continue;

            const proc = Gio.Subprocess.new(
                [python3, pyScript, dbPath],
                Gio.SubprocessFlags.STDOUT_PIPE | Gio.SubprocessFlags.STDERR_SILENCE
            );
            const [stdout] = await proc.communicate_utf8_async(null, null);
            if (!stdout?.length) continue;

            const raw = stdout.trim();
            if (!raw) continue;

            const json = JSON.parse(raw);

            // Modern format: { entries: [{ folderUri }, { workspace: { configPath } }, ...] }
            // Legacy format: { workspaces3: ["file://...", ...], files2: [...] }
            let entries = json?.entries;
            if (!entries?.length) {
                const ws3 = json?.workspaces3;
                if (ws3?.length)
                    entries = ws3.map(uri => ({ folderUri: uri }));
            }
            if (!entries?.length) continue;

            const folders = [];
            for (const entry of entries) {
                let uri, path, label;
                if (entry.folderUri) {
                    uri = entry.folderUri;
                    if (!uri.startsWith('file://')) continue;
                    path = decodeURIComponent(uri.slice(7));
                    if (!path) continue;
                    label = _folderLabel(path);
                } else if (entry.workspace?.configPath) {
                    // recently.opened format: workspace.configPath is a URI string
                    uri = entry.workspace.configPath;
                    if (!uri.startsWith('file://')) continue;
                    path = decodeURIComponent(uri.slice(7));
                    if (!path) continue;
                    label = _workspaceLabel(path);
                } else if (entry.workspaceUri) {
                    // workspace.json format: workspaceUri is a direct URI string
                    uri = entry.workspaceUri;
                    if (!uri.startsWith('file://')) continue;
                    path = decodeURIComponent(uri.slice(7));
                    if (!path) continue;
                    label = _workspaceLabel(path);
                } else {
                    continue;
                }
                folders.push({ path, label });
                if (folders.length >= maxFolders) break;
            }

            if (folders.length > 0) return folders;
        } catch (_e) { }
    }

    // Fallback: read currently-open folders from storage.json (VS Code 1.95+ keeps these)
    return _readStorageJsonFolders(maxFolders);
}

async function _readStorageJsonFolders(maxFolders) {
    const home = GLib.get_home_dir();
    const storagePath = `${home}/.config/Code/User/globalStorage/storage.json`;
    try {
        const file = Gio.File.new_for_path(storagePath);
        if (!file.query_exists(null)) return [];
        const [, contents] = await file.load_contents_async(null);
        const data = JSON.parse(new TextDecoder().decode(contents));
        const rawFolders = data?.backupWorkspaces?.folders ?? [];
        const folders = [];
        for (const entry of rawFolders) {
            const uri = entry.folderUri;
            if (!uri?.startsWith('file://')) continue;
            const path = decodeURIComponent(uri.slice(7));
            if (!path) continue;
            folders.push({ path, label: _folderLabel(path) });
            if (folders.length >= maxFolders) break;
        }
        return folders;
    } catch (_e) { }
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

    // Display cached folders immediately (no blocking)
    if (_folderCache.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Folders'));
        for (const { path, label } of _folderCache.slice(0, maxFolders))
            menu.addAction(label, () => openInVSCode(path, useOzoneX11));
    }

    // Refresh cache asynchronously for next open
    fetchRecentFoldersAsync(maxFolders).then(folders => {
        _folderCache = folders;
    }).catch(() => {});
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
        // Pre-warm the cache so folders appear on first menu open
        const maxFolders = this._settings.get_int('max-recent-folders');
        fetchRecentFoldersAsync(maxFolders).then(folders => {
            _folderCache = folders;
        }).catch(() => {});
        patchPopupOpen(this._settings);
    }
    disable() {
        unpatchPopupOpen();
        _folderCache = [];
        this._settings = null;
    }
}

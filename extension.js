/**
 * Smart Dock Menus — GNOME Shell Extension
 * App-aware quick-access menus for dock icons:
 *   • VS Code  → recent folders & workspaces
 *   • Files    → recent files (matches Nautilus Recent view)
 *   • Spotify  → now playing + playback controls (via MPRIS)
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import { Extension } from 'resource:///org/gnome/shell/extensions/extension.js';

Gio._promisify(Gio.Subprocess.prototype, 'communicate_utf8_async', 'communicate_utf8_finish');
Gio._promisify(Gio.File.prototype, 'load_contents_async', 'load_contents_finish');

// ── App IDs to recognise ──────────────────────────────────────────────────────
const VSCODE_APP_IDS = [
    'code.desktop',
    'code-url-handler.desktop',
    'visual-studio-code.desktop',
    'com.visualstudio.code.desktop',
    'snap.code.code.desktop',
];

const NAUTILUS_APP_IDS = [
    'org.gnome.Nautilus.desktop',
    'nautilus.desktop',
];

const SPOTIFY_APP_IDS = [
    'spotify.desktop',
    'com.spotify.Client.desktop',
    'snap.spotify.spotify.desktop',
];

const SETTINGS_APP_IDS = [
    'org.gnome.Settings.desktop',
    'gnome-control-center.desktop',
];

const SETTINGS_PANELS = [
    { label: 'Wi-Fi',            panel: 'wifi'            },
    { label: 'Bluetooth',        panel: 'bluetooth'       },
    { label: 'Network',          panel: 'network'         },
    { label: 'Sound',            panel: 'sound'           },
    { label: 'Displays',         panel: 'display'         },
    { label: 'Power',            panel: 'power'           },
    { label: 'Appearance',       panel: 'background'      },
    { label: 'Notifications',    panel: 'notifications'   },
    { label: 'Privacy',          panel: 'privacy'         },
    { label: 'Apps',             panel: 'applications'    },
];

const PATCH_MARKER = Symbol('vscodeRecentFoldersPatch');

// ── VS Code folder cache (pre-warmed on load) ─────────────────────────────────
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

function isFilesApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return NAUTILUS_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('nautilus');
}

function isSpotifyApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return SPOTIFY_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('spotify');
}

function isSettingsApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return SETTINGS_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('gnome-control-center');
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

// ── GNOME Files (Nautilus) recent files ───────────────────────────────────────

function _fileLabel(uri) {
    const home = GLib.get_home_dir();
    const path = decodeURIComponent(uri.slice(7));
    const parent = GLib.path_get_dirname(path);
    const displayParent = parent.startsWith(home) ? '~' + parent.slice(home.length) : parent;
    return `${GLib.path_get_basename(path)}  ${displayParent}`;
}

function _readRecentFiles(maxFiles) {
    const home = GLib.get_home_dir();
    const xbelPath = `${home}/.local/share/recently-used.xbel`;
    try {
        const bookmarks = new GLib.BookmarkFile();
        bookmarks.load_from_file(xbelPath);
        const uris = bookmarks.get_uris().filter(u => u.startsWith('file://'));
        uris.sort((a, b) => {
            try {
                const getTs = (uri) => {
                    let m = 0, v = 0;
                    try { m = bookmarks.get_modified(uri); } catch (_e) {}
                    try { v = bookmarks.get_visited(uri); } catch (_e) {}
                    return Math.max(m, v);
                };
                return getTs(b) - getTs(a);
            } catch (_e) { return 0; }
        });
        return uris.slice(0, maxFiles).map(uri => ({ uri, label: _fileLabel(uri) }));
    } catch (_e) {}
    return [];
}

function openFile(uri) {
    const gio = GLib.find_program_in_path('gio');
    if (gio) {
        try { Gio.Subprocess.new([gio, 'open', uri], Gio.SubprocessFlags.NONE); return; }
        catch (_e) {}
    }
    const xdg = GLib.find_program_in_path('xdg-open');
    if (xdg) {
        try { Gio.Subprocess.new([xdg, decodeURIComponent(uri.slice(7))], Gio.SubprocessFlags.NONE); }
        catch (_e) {}
    }
}

function appendFilesToMenu(menu, settings) {
    const maxFiles = settings.get_int('max-recent-files');
    // Read synchronously so items are always available on first open
    const files = _readRecentFiles(maxFiles);
    if (files.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Files'));
        for (const { uri, label } of files)
            menu.addAction(label, () => openFile(uri));
    }
}

// ── GNOME Settings ───────────────────────────────────────────────────────────

function appendSettingsToMenu(menu) {
    const gcc = GLib.find_program_in_path('gnome-control-center');
    if (!gcc) return;
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Quick Settings'));
    for (const { label, panel } of SETTINGS_PANELS)
        menu.addAction(label, () => {
            try { Gio.Subprocess.new([gcc, panel], Gio.SubprocessFlags.NONE); }
            catch (_e) {}
        });
}

// ── Spotify (MPRIS) ───────────────────────────────────────────────────────────

function _getSpotifyPlayer() {
    try {
        return Gio.DBusProxy.new_for_bus_sync(
            Gio.BusType.SESSION,
            Gio.DBusProxyFlags.NONE,
            null,
            'org.mpris.MediaPlayer2.spotify',
            '/org/mpris/MediaPlayer2',
            'org.mpris.MediaPlayer2.Player',
            null
        );
    } catch (_e) {}
    return null;
}

function _mprisCall(player, method) {
    try { player.call_sync(method, null, Gio.DBusCallFlags.NONE, -1, null); }
    catch (_e) {}
}

function appendSpotifyToMenu(menu) {
    const player = _getSpotifyPlayer();
    if (!player) return;

    const metaVar = player.get_cached_property('Metadata');
    const statusVar = player.get_cached_property('PlaybackStatus');
    if (!metaVar) return;

    const meta = metaVar.recursiveUnpack();
    const title = meta['xesam:title'] || '';
    if (!title) return;

    const rawArtists = meta['xesam:artist'];
    const artist = Array.isArray(rawArtists) ? rawArtists.join(', ') : (rawArtists ?? '');
    const isPlaying = statusVar?.unpack() === 'Playing';

    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Now Playing'));
    menu.addAction(`${title}  ${artist}`, () => _mprisCall(player, 'PlayPause'));
    menu.addAction(isPlaying ? '⏸  Pause'    : '▶  Resume',  () => _mprisCall(player, 'PlayPause'));
    menu.addAction('⏭  Next Track',                           () => _mprisCall(player, 'Next'));
    menu.addAction('⏮  Previous Track',                       () => _mprisCall(player, 'Previous'));
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
            const appId = this.sourceActor?.app?.get_id?.() ??
                          this.sourceActor?._app?.get_id?.() ?? '';
            if (isVSCodeApp(appId))
                appendFoldersToMenu(this, settings);
            else if (isFilesApp(appId))
                appendFilesToMenu(this, settings);
            else if (isSpotifyApp(appId))
                appendSpotifyToMenu(this);
            else if (isSettingsApp(appId))
                appendSettingsToMenu(this);
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
        const maxFolders = this._settings.get_int('max-recent-folders');
        fetchRecentFoldersAsync(maxFolders).then(f => { _folderCache = f; }).catch(() => {});
        patchPopupOpen(this._settings);
    }
    disable() {
        unpatchPopupOpen();
        _folderCache = [];
        this._settings = null;
    }
}

/**
 * Smart Dock Menus — GNOME Shell Extension
 * App-aware quick-access menus for dock icons:
 *   • VS Code / VSCodium / Cursor → recent folders & workspaces
 *   • Files    → recent files (matches Nautilus Recent view)
 *   • Spotify  → now playing + playback controls (via MPRIS)
 *   • GitKraken → recently opened repositories
 *   • Obsidian  → recently opened vaults
 *   • Text Editor → recent documents
 *   • Settings  → quick panel shortcuts
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

const VSCODIUM_APP_IDS = [
    'codium.desktop',
    'codium-url-handler.desktop',
    'vscodium.desktop',
    'com.vscodium.codium.desktop',
];

const CURSOR_APP_IDS = [
    'cursor.desktop',
    'cursor-url-handler.desktop',
];

const GITKRAKEN_APP_IDS = [
    'gitkraken.desktop',
    'gitkraken-url-handler.desktop',
    'com.axosoft.GitKraken.desktop',
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

const TEXT_EDITOR_APP_IDS = [
    'org.gnome.TextEditor.desktop',
    'org.gnome.gedit.desktop',
    'gedit.desktop',
];

const TEXT_EDITOR_MIMES = new Set([
    'application/json',
    'application/x-php',
    'application/x-shellscript',
    'application/sql',
    'application/x-zerosize',
]);

const OBSIDIAN_APP_IDS = [
    'obsidian_obsidian.desktop',
    'md.obsidian.Obsidian.desktop',
    'obsidian.desktop',
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

// ── Caches (pre-warmed async in enable, read sync in menu) ───────────────────
const _folderCaches = { vscode: [], vscodium: [], cursor: [] };
let _gitKrakenCache = [];
let _obsidianCache  = [];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isVSCodeApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return VSCODE_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('visual-studio-code') ||
           lower.includes('vscode') ||
           lower.startsWith('code.');
}

function isVSCodiumApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return VSCODIUM_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('codium');
}

function isCursorApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return CURSOR_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower === 'cursor.desktop' || lower === 'cursor-url-handler.desktop';
}

function isGitKrakenApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return GITKRAKEN_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('gitkraken');
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

function isTextEditorApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return TEXT_EDITOR_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower === 'org.gnome.texteditor.desktop';
}

function isObsidianApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return OBSIDIAN_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('obsidian');
}

function isSettingsApp(appId) {
    if (!appId) return false;
    const lower = appId.toLowerCase();
    return SETTINGS_APP_IDS.some(id => id.toLowerCase() === lower) ||
           lower.includes('gnome-control-center');
}

function getDbPaths(editor = 'vscode') {
    const home = GLib.get_home_dir();
    const paths = {
        vscode: [
            `${home}/.config/Code/User/globalStorage/state.vscdb`,
            `${home}/snap/code/common/.config/Code/User/globalStorage/state.vscdb`,
            `${home}/.var/app/com.visualstudio.code/config/Code/User/globalStorage/state.vscdb`,
        ],
        vscodium: [
            `${home}/.config/VSCodium/User/globalStorage/state.vscdb`,
            `${home}/snap/codium/current/.config/VSCodium/User/globalStorage/state.vscdb`,
            `${home}/.var/app/com.vscodium.codium/config/VSCodium/User/globalStorage/state.vscdb`,
        ],
        cursor: [
            `${home}/.config/Cursor/User/globalStorage/state.vscdb`,
            `${home}/snap/cursor/current/.config/Cursor/User/globalStorage/state.vscdb`,
        ],
    };
    return paths[editor] ?? paths.vscode;
}

function _editorBin(editor) {
    const bins = {
        vscode:   ['code', '/usr/bin/code', '/snap/bin/code', '/usr/local/bin/code'],
        vscodium: ['codium', '/usr/bin/codium', '/snap/bin/codium'],
        cursor:   ['cursor', '/usr/bin/cursor', '/usr/local/bin/cursor'],
    };
    for (const b of (bins[editor] ?? bins.vscode)) {
        const resolved = b.startsWith('/') ? b : GLib.find_program_in_path(b);
        if (resolved && Gio.File.new_for_path(resolved).query_exists(null)) return resolved;
    }
    return null;
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

async function fetchRecentFoldersAsync(maxFolders, editor = 'vscode') {
    const python3 = GLib.find_program_in_path('python3') ?? '/usr/bin/python3';
    const extensionDir = Gio.File.new_for_uri(import.meta.url).get_parent().get_path();
    const pyScript = `${extensionDir}/fetch_recent.py`;

    for (const dbPath of getDbPaths(editor)) {
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
        const [contents] = await file.load_contents_async(null);
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

function _readXbel(maxItems, mimeFilter = false) {
    const home = GLib.get_home_dir();
    const xbelPath = `${home}/.local/share/recently-used.xbel`;
    try {
        const bookmarks = new GLib.BookmarkFile();
        bookmarks.load_from_file(xbelPath);
        let uris = bookmarks.get_uris().filter(u => u.startsWith('file://'));
        if (mimeFilter) {
            uris = uris.filter(u => {
                try {
                    const mime = bookmarks.get_mime_type(u);
                    return mime?.startsWith('text/') || TEXT_EDITOR_MIMES.has(mime);
                } catch (_e) { return false; }
            });
        }
        uris.sort((a, b) => {
            try {
                const ts = u => {
                    let m = 0, v = 0;
                    try { m = bookmarks.get_modified(u); } catch (_e) {}
                    try { v = bookmarks.get_visited(u); } catch (_e) {}
                    return Math.max(m, v);
                };
                return ts(b) - ts(a);
            } catch (_e) { return 0; }
        });
        return uris.slice(0, maxItems).map(uri => ({ uri, label: _fileLabel(uri) }));
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
    const files = _readXbel(settings.get_int('max-recent-files'));
    if (!files.length) return;
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Files'));
    for (const { uri, label } of files)
        menu.addAction(label, () => openFile(uri));
}

// ── GNOME Text Editor ────────────────────────────────────────────────────────

function appendTextEditorToMenu(menu, settings) {
    const files = _readXbel(settings.get_int('max-recent-docs'), true);
    if (!files.length) return;
    menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Documents'));
    for (const { uri, label } of files)
        menu.addAction(label, () => openFile(uri));
}

// ── GitKraken ────────────────────────────────────────────────────────────────

async function _fetchGitKrakenReposAsync(maxRepos) {
    const home = GLib.get_home_dir();
    const configPath = `${home}/.gitkraken/config`;
    try {
        const file = Gio.File.new_for_path(configPath);
        const [bytes] = await file.load_contents_async(null);
        const data = JSON.parse(new TextDecoder().decode(bytes));
        const openRepo = data?.fuzzyFinderMetadata?.itemMetadata?.OPEN_REPO ?? {};
        const repos = Object.entries(openRepo).map(([key, val]) => {
            const path = key.replace(/^openRepo-/, '');
            const lastTs = Math.max(...(val.timestamps ?? [0]));
            const parent = GLib.path_get_dirname(path);
            const displayParent = parent.startsWith(home) ? '~' + parent.slice(home.length) : parent;
            return { path, lastTs, label: `${GLib.path_get_basename(path)}  ${displayParent}` };
        }).filter(r => r.path);
        repos.sort((a, b) => b.lastTs - a.lastTs);
        return repos.slice(0, maxRepos);
    } catch (_e) {}
    return [];
}

function appendGitKrakenToMenu(menu, settings) {
    const maxRepos = settings.get_int('max-recent-repos');
    if (_gitKrakenCache.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Repos'));
        for (const { label, path } of _gitKrakenCache.slice(0, maxRepos)) {
            menu.addAction(label, () => {
                try {
                    const gk = GLib.find_program_in_path('gitkraken') ?? '/usr/bin/gitkraken';
                    Gio.Subprocess.new([gk, '-p', path], Gio.SubprocessFlags.NONE);
                } catch (_e) {}
            });
        }
    }
    _fetchGitKrakenReposAsync(maxRepos).then(r => { _gitKrakenCache = r; }).catch(() => {});
}

// ── Obsidian ─────────────────────────────────────────────────────────────────

async function _fetchObsidianVaultsAsync(maxVaults) {
    const home = GLib.get_home_dir();
    const configPaths = [
        `${home}/snap/obsidian/current/.config/obsidian/obsidian.json`,
        `${home}/.config/obsidian/obsidian.json`,
        `${home}/.var/app/md.obsidian.Obsidian/config/obsidian/obsidian.json`,
    ];
    for (const configPath of configPaths) {
        try {
            const file = Gio.File.new_for_path(configPath);
            if (!file.query_exists(null)) continue;
            const [bytes] = await file.load_contents_async(null);
            const data = JSON.parse(new TextDecoder().decode(bytes));
            const vaults = Object.values(data?.vaults ?? {});
            if (!vaults.length) continue;
            vaults.sort((a, b) => (b.ts ?? 0) - (a.ts ?? 0));
            return vaults.slice(0, maxVaults).map(v => {
                const parent = GLib.path_get_dirname(v.path);
                const displayParent = parent.startsWith(home) ? '~' + parent.slice(home.length) : parent;
                return { label: `${GLib.path_get_basename(v.path)}  ${displayParent}`, path: v.path };
            });
        } catch (_e) {}
    }
    return [];
}

function appendObsidianToMenu(menu, settings) {
    const maxVaults = settings.get_int('max-recent-vaults');
    if (_obsidianCache.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Vaults'));
        for (const { label, path } of _obsidianCache.slice(0, maxVaults)) {
            menu.addAction(label, () => {
                try {
                    const encoded = encodeURIComponent(path).replace(/%2F/gi, '/');
                    const xdg = GLib.find_program_in_path('xdg-open');
                    if (xdg)
                        Gio.Subprocess.new([xdg, `obsidian://open?path=${encoded}`], Gio.SubprocessFlags.NONE);
                } catch (_e) {}
            });
        }
    }
    _fetchObsidianVaultsAsync(maxVaults).then(v => { _obsidianCache = v; }).catch(() => {});
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

function openInVSCode(folderPath, useOzoneX11, editor = 'vscode') {
    const bin = _editorBin(editor);
    if (!bin) return;
    const extraFlags = useOzoneX11 ? ['--ozone-platform=x11'] : [];
    try { Gio.Subprocess.new([bin, '--new-window', ...extraFlags, folderPath], Gio.SubprocessFlags.NONE); }
    catch (_e) {}
}

// ── Menu injection ────────────────────────────────────────────────────────────

function appendFoldersToMenu(menu, settings, editor = 'vscode') {
    const maxFolders = settings.get_int('max-recent-folders');
    const useOzoneX11 = settings.get_boolean('use-ozone-x11');
    const cache = _folderCaches[editor] ?? [];

    if (cache.length > 0) {
        menu.addMenuItem(new PopupMenu.PopupSeparatorMenuItem('Recent Folders'));
        for (const { path, label } of cache.slice(0, maxFolders))
            menu.addAction(label, () => openInVSCode(path, useOzoneX11, editor));
    }

    fetchRecentFoldersAsync(maxFolders, editor).then(folders => {
        _folderCaches[editor] = folders;
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
            const g = k => settings.get_boolean(k);
            if      (isVSCodeApp(appId)     && g('enable-vscode'))
                appendFoldersToMenu(this, settings, 'vscode');
            else if (isVSCodiumApp(appId)   && g('enable-vscodium'))
                appendFoldersToMenu(this, settings, 'vscodium');
            else if (isCursorApp(appId)     && g('enable-cursor'))
                appendFoldersToMenu(this, settings, 'cursor');
            else if (isGitKrakenApp(appId)  && g('enable-gitkraken'))
                appendGitKrakenToMenu(this, settings);
            else if (isFilesApp(appId)      && g('enable-files'))
                appendFilesToMenu(this, settings);
            else if (isSpotifyApp(appId)    && g('enable-spotify'))
                appendSpotifyToMenu(this);
            else if (isTextEditorApp(appId) && g('enable-text-editor'))
                appendTextEditorToMenu(this, settings);
            else if (isObsidianApp(appId)   && g('enable-obsidian'))
                appendObsidianToMenu(this, settings);
            else if (isSettingsApp(appId)   && g('enable-settings'))
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
        const s = this._settings;
        const maxFolders = s.get_int('max-recent-folders');
        for (const editor of ['vscode', 'vscodium', 'cursor'])
            fetchRecentFoldersAsync(maxFolders, editor)
                .then(f => { _folderCaches[editor] = f; }).catch(() => {});
        _fetchGitKrakenReposAsync(s.get_int('max-recent-repos'))
            .then(r => { _gitKrakenCache = r; }).catch(() => {});
        _fetchObsidianVaultsAsync(s.get_int('max-recent-vaults'))
            .then(v => { _obsidianCache = v; }).catch(() => {});
        patchPopupOpen(this._settings);
    }
    disable() {
        unpatchPopupOpen();
        for (const k of Object.keys(_folderCaches)) _folderCaches[k] = [];
        _gitKrakenCache = [];
        _obsidianCache  = [];
        this._settings = null;
    }
}

/* Winacux Flow: intent -> workspace.
 *
 * A flow is a recipe: a workspace index plus the apps and files that belong to
 * an intent. Recipes live in ~/.config/winacux/flows/*.json, so users can add
 * their own without touching the extension:
 *
 *   {
 *     "name": "Study",
 *     "workspace": 1,
 *     "apps": ["org.gnome.Nautilus", "org.gnome.Firefox", "gnome-calculator"],
 *     "files": ["~/Documents/Notes"]
 *   }
 *
 * The "wcx flow <name>" command in /usr/bin simply writes the flow name into
 * ~/.config/winacux/active-flow; this module watches that file and runs it, so
 * any program (keybinding, AI assistant, script) can trigger a flow.
 */

import Gio from 'gi://Gio';
import Meta from 'gi://Meta';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getWorkspaceManager} from 'resource:///org/gnome/shell/ui/workspace.js';

const CONFIG_DIR = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'winacux']);
const FLOWS_DIR = GLib.build_filenamev([CONFIG_DIR, 'flows']);
const ACTIVE_FILE = GLib.build_filenamev([CONFIG_DIR, 'active-flow']);
const LAYOUT_FILE = GLib.build_filenamev([CONFIG_DIR, 'layouts.json']);

/* Restore-my-desk: per-workspace memory of which apps were open, so a Flow can
 * put your desk back exactly as you left it instead of re-launching blindly. */
function captureLayouts() {
    const layouts = {};
    for (const meta of global.get_window_actors()) {
        const window = meta.meta_window;
        if (!window || window.is_skip_taskbar())
            continue;
        if (window.get_window_type() !== Meta.WindowType.NORMAL)
            continue;
        const workspace = window.get_workspace();
        const app = window.get_application();
        layouts[workspace.index()] = layouts[workspace.index()] || {apps: [], files: []};
        const appId = app ? app.get_id() : null;
        if (appId && !layouts[workspace.index()].apps.includes(appId))
            layouts[workspace.index()].apps.push(appId);
        const uri = window.get_uri();
        if (uri && !layouts[workspace.index()].files.includes(uri))
            layouts[workspace.index()].files.push(uri);
    }
    GLib.file_set_contents(LAYOUT_FILE, JSON.stringify(layouts, null, 2));
    return layouts;
}

function loadLayouts() {
    const [ok, bytes] = GLib.file_get_contents(LAYOUT_FILE);
    if (!ok)
        return {};
    try {
        return JSON.parse(new TextDecoder().decode(bytes));
    } catch (e) {
        return {};
    }
}

function expandHome(path) {
    if (path.startsWith('~'))
        return GLib.build_filenamev([GLib.get_home_dir(), path.slice(1)]);
    return path;
}

export class FlowEngine {
    constructor() {
        this._monitor = null;
        this._timeout = null;
    }

    enable() {
        this._ensureDirs();
        this._monitor = Gio.File.new_for_path(ACTIVE_FILE).monitor_file(
            Gio.FileMonitorFlags.NONE, null);
        this._monitor.connect('changed', () => this._onTriggered());

        // Remember the desk continuously, so a crash-free session is restorable.
        this._layoutTimer = GLib.timeout_add_seconds(GLib.PRIORITY_DEFAULT, 30, () => {
            try {
                captureLayouts();
            } catch (e) {
                logError(e, 'Winacux Flow: layout capture failed');
            }
            return GLib.SOURCE_CONTINUE;
        });
    }

    disable() {
        if (this._monitor) {
            this._monitor.cancel();
            this._monitor = null;
        }
        if (this._layoutTimer) {
            GLib.Source.remove(this._layoutTimer);
            this._layoutTimer = null;
        }
        if (this._timeout) {
            GLib.Source.remove(this._timeout);
            this._timeout = null;
        }
    }

    _ensureDirs() {
        for (const dir of [CONFIG_DIR, FLOWS_DIR]) {
            if (!GLib.file_test(dir, GLib.FileTest.IS_DIR)) {
                GLib.mkdir_with_parents(dir, 0o755);
            }
        }
    }

    _onTriggered() {
        const [ok, bytes] = GLib.file_get_contents(ACTIVE_FILE);
        if (!ok)
            return;

        const key = new TextDecoder().decode(bytes).trim();
        if (key)
            this.run(key);
    }

    listFlows() {
        const dir = Gio.File.new_for_path(FLOWS_DIR);
        let names = [];
        try {
            const enumerator = dir.enumerate_children('standard::name,standard::type',
                Gio.FileQueryInfoFlags.NONE, null);
            let info;
            while ((info = enumerator.next_file(null)) !== null) {
                if (info.get_name().endsWith('.json'))
                    names.push(info.get_name().replace(/\.json$/, ''));
            }
        } catch (e) {
            return [];
        }
        return names.sort();
    }

    loadFlow(name) {
        const path = GLib.build_filenamev([FLOWS_DIR, `${name}.json`]);
        const [ok, bytes] = GLib.file_get_contents(path);
        if (!ok)
            return null;
        try {
            return JSON.parse(new TextDecoder().decode(bytes));
        } catch (e) {
            logError(e, `Winacux Flow: bad recipe ${name}.json`);
            return null;
        }
    }

    run(name) {
        const flow = this.loadFlow(name);
        if (!flow) {
            log(`Winacux Flow: unknown flow "${name}"`);
            return;
        }

        const workspaces = getWorkspaceManager();
        const index = Math.max(0, Math.min(flow.workspace ?? 0, workspaces.get_n_workspaces() - 1));
        workspaces.get_workspace_by_index(index).activate();
        Main.overview.hide();

        // Skip anything from the flow that is already running here: that is
        // what makes a Flow feel like returning to a desk rather than a launch.
        const running = this._runningAppIds();
        for (const id of flow.apps ?? []) {
            if (running.has(id))
                continue;
            this._launch(id);
        }

        for (const file of flow.files ?? []) {
            const path = expandHome(file);
            if (GLib.file_test(path, GLib.FileTest.EXISTS))
                Gio.AppInfo.launch_default_for_uri(Gio.File.new_for_path(path).get_uri(), null);
        }

        Main.notify('Winacux Flow', `Opened “${flow.name ?? name}”`);
    }

    _runningAppIds() {
        const ids = new Set();
        for (const meta of global.get_window_actors()) {
            const app = meta.meta_window?.get_application?.();
            if (app)
                ids.add(app.get_id());
        }
        return ids;
    }

    captureLayouts() {
        return captureLayouts();
    }

    loadLayouts() {
        return loadLayouts();
    }

    _launch(appId) {
        let app = Gio.DesktopAppInfo.new(appId);
        if (!app) {
            // Not an app id - treat it as a command.
            const [cmd, ...args] = appId.split(' ');
            if (cmd) {
                try {
                    Gio.Subprocess.new([cmd, ...args], null);
                } catch (e) {
                    logError(e, `Winacux Flow: cannot launch ${appId}`);
                }
            }
            return;
        }
        app.launch(null);
    }
}
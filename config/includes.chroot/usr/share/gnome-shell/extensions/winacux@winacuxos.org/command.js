/* Winacux Command - the launcher that fronts the whole OS.
 *
 * Super+Space opens one search box. Everything is reachable through it:
 * applications, settings panels, Winacux Flows, system actions, file search and
 * the local AI. Fuzzy matching is subsequence based with word-start bonuses,
 * which is what makes "bt bt" find Bluetooth and "snap" find "snapshot now".
 *
 * Actions that need root are handed to the `wcx` CLI, which is the one place
 * privileged WinacuxOS behaviour lives.
 */

import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getWorkspaceManager} from 'resource:///org/gnome/shell/ui/workspace.js';

const WCX = '/usr/local/bin/wcx';
const AI_HOST = '127.0.0.1';
const AI_PORT = 8080;
const MAX_RESULTS = 8;

/* --------------------------------------------------------------- matching */

function fuzzyScore(query, target) {
    if (!query)
        return 0.1;

    const q = query.toLowerCase();
    const t = target.toLowerCase();
    if (t === q)
        return 1000;
    if (t.startsWith(q))
        return 900 - t.length;

    let score = 0;
    let ti = 0;
    let streak = 0;
    for (const ch of q) {
        const found = t.indexOf(ch, ti);
        if (found === -1)
            return -1;
        // Word-start and consecutive matches are worth much more.
        const wordStart = found === 0 || /[\s\-_.]/.test(t[found - 1]);
        streak = found === ti && ti > 0 ? streak + 1 : 0;
        score += 10 + (wordStart ? 25 : 0) + streak * 8;
        ti = found + 1;
    }
    return score - target.length * 0.2;
}

/* ---------------------------------------------------------------- sources */

function searchApps(query) {
    const results = [];
    const seen = new Set();
    for (const info of Gio.AppInfo.get_all()) {
        if (!info.should_show() || !info.launchable)
            continue;
        const id = info.get_id();
        if (seen.has(id))
            continue;
        const name = info.get_display_name() ?? info.get_name() ?? '';
        const score = fuzzyScore(query, `${name} ${info.get_name()}`);
        if (score > 0) {
            seen.add(id);
            results.push({
                score: score + 40,          // apps are the most likely intent
                title: name,
                detail: 'Application',
                icon: info.get_icon(),
                run: () => info.launch(null),
            });
        }
    }
    return results;
}

const SETTINGS_PANELS = [
    {title: 'Bluetooth', detail: 'Settings', keywords: 'bluetooth bt pair device', panel: 'bluetooth'},
    {title: 'Network', detail: 'Settings', keywords: 'network wifi wi-fi internet connection', panel: 'network'},
    {title: 'Power', detail: 'Settings', keywords: 'power battery energy saver', panel: 'power'},
    {title: 'Display', detail: 'Settings', keywords: 'display monitor screen resolution brightness', panel: 'display'},
    {title: 'Keyboard', detail: 'Settings', keywords: 'keyboard shortcuts keys typing', panel: 'keyboard'},
    {title: 'Mouse & Touchpad', detail: 'Winacux Mouse', keywords: 'mouse pointer cursor touchpad click trail', custom: true},
    {title: 'Sound', detail: 'Settings', keywords: 'sound audio volume mixer microphone', panel: 'sound'},
    {title: 'Privacy', detail: 'Settings', keywords: 'privacy permissions location camera mic', panel: 'privacy'},
    {title: 'Users', detail: 'Settings', keywords: 'users accounts login password', panel: 'users'},
    {title: 'Appearance', detail: 'Settings', keywords: 'appearance theme dark light accent style', panel: 'appearance'},
    {title: 'Date & Time', detail: 'Settings', keywords: 'date time clock timezone', panel: 'datetime'},
];

function searchSettings(query) {
    const results = [];
    for (const entry of SETTINGS_PANELS) {
        const score = fuzzyScore(query, `${entry.title} ${entry.keywords}`);
        if (score <= 0)
            continue;
        results.push({
            score,
            title: entry.title,
            detail: entry.detail,
            run: () => {
                if (entry.custom) {
                    GLib.spawn_command_line_async(`${WCX} mouse`);
                } else {
                    GLib.spawn_command_line_async(`gnome-control-center ${entry.panel}`);
                }
            },
        });
    }
    return results;
}

function flowNames() {
    const dir = GLib.build_filenamev([GLib.get_home_dir(), '.config', 'winacux', 'flows']);
    const file = Gio.File.new_for_path(dir);
    const names = [];
    try {
        const enumerator = file.enumerate_children('standard::name', Gio.FileQueryInfoFlags.NONE, null);
        let info;
        while ((info = enumerator.next_file(null)) !== null) {
            if (info.get_name().endsWith('.json'))
                names.push(info.get_name().replace(/\.json$/, ''));
        }
    } catch (e) {
        return [];
    }
    return names;
}

function searchFlows(query) {
    const results = [];
    for (const name of flowNames()) {
        const score = fuzzyScore(query, `${name} flow start begin`);
        if (score <= 0)
            continue;
        results.push({
            score: score + 30,
            title: `Start “${name}”`,
            detail: 'Winacux Flow',
            run: () => GLib.spawn_command_line_async(`${WCX} flow ${name}`),
        });
    }
    return results;
}

function searchFiles(query) {
    // Natural language file search runs through our own toolchain, not a
    // cloud index: `fd` inside the home directory.
    const terms = query.replace(/^(find|search|locate|show me|open)\s+/i, '').trim();
    if (!terms)
        return [];

    return [{
        score: 200,
        title: `Find files matching “${terms}”`,
        detail: 'Search · local',
        run: () => GLib.spawn_command_line_async(`${WCX} find ${_shellQuote(terms)}`),
    }];
}

function _shellQuote(text) {
    return `'${text.replace(/'/g, `'\\''`)}'`;
}

function systemActions() {
    return [
        {title: 'Snapshot now', detail: 'Winacux Snapshot', keywords: 'snapshot backup timeshift restore point',
            run: () => GLib.spawn_command_line_async(`${WCX} snapshot create`)},
        {title: 'Restore a snapshot', detail: 'Winacux Snapshot', keywords: 'restore rollback undo timeshift',
            run: () => GLib.spawn_command_line_async(`${WCX} snapshot restore`)},
        {title: 'Check for updates', detail: 'Winacux Update Center', keywords: 'update upgrade patch software',
            run: () => GLib.spawn_command_line_async(`${WCX} update check`)},
        {title: 'Diagnose this system', detail: 'Winacux Safe Mode', keywords: 'doctor diagnose fix problems broken error',
            run: () => GLib.spawn_command_line_async(`${WCX} doctor`)},
        {title: 'Theme Studio', detail: 'Winacux', keywords: 'theme accent colour color style appearance studio',
            run: () => GLib.spawn_command_line_async(`${WCX} theme`)},
        {title: 'Mouse settings', detail: 'Winacux', keywords: 'mouse cursor pointer trail click',
            run: () => GLib.spawn_command_line_async(`${WCX} mouse`)},
        {title: 'Next workspace', detail: 'QuickSpace', keywords: 'workspace next switch desktop',
            run: () => {
                const manager = getWorkspaceManager();
                manager.get_active_workspace().activate();
                Main.overview.show();
            }},
        {title: 'Previous workspace', detail: 'QuickSpace', keywords: 'workspace previous back desktop',
            run: () => {
                const manager = getWorkspaceManager();
                manager.get_active_workspace().activate();
                Main.overview.show();
            }},
        {title: 'Toggle overview', detail: 'Winacux', keywords: 'activities overview windows',
            run: () => Main.overview.toggle()},
        {title: 'Lock screen', detail: 'System', keywords: 'lock screen lock',
            run: () => global.get_compositor_private().get_letterbox?.() ?? Main.overview.hide()},
    ];
}

function searchActions(query) {
    const results = [];
    for (const action of systemActions()) {
        const score = fuzzyScore(query, `${action.title} ${action.keywords}`);
        if (score <= 0)
            continue;
        results.push({
            score: score + 20,
            title: action.title,
            detail: action.detail,
            run: action.run,
        });
    }
    return results;
}

function askAI(query) {
    const session = new Soup.Session();
    const payload = JSON.stringify({
        model: 'winacux-local',
        stream: false,
        messages: [
            {role: 'system', content:
                'You are Winacux AI, the offline assistant inside WinacuxOS. ' +
                'Answer in one or two short sentences.'},
            {role: 'user', content: query},
        ],
    });
    const message = Soup.Message.new('POST', `http://${AI_HOST}:${AI_PORT}/v1/chat/completions`);
    message.set_request_body_from_bytes('application/json',
        new TextEncoder().encode(payload));

    return new Promise(resolve => {
        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null, (session, result) => {
            try {
                const bytes = session.send_and_read_finish(result);
                const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                resolve(data?.choices?.[0]?.message?.content?.trim() ?? '');
            } catch (e) {
                resolve('');
            }
        });
    });
}

/* ------------------------------------------------------------- the palette */

const WinacuxCommand = GObject.registerClass(
class WinacuxCommand extends St.BoxLayout {
    _init(extension) {
        super._init({
            vertical: true,
            style_class: 'winacux-command',
            visible: false,
        });
        this._extension = extension;

        this._entry = new St.Entry({
            style_class: 'winacux-command-entry',
            hint_text: 'Search apps, settings, flows…  (try “start study” or “snap now”)',
            can_focus: true,
        });
        this.add_child(this._entry);

        this._results = new St.BoxLayout({vertical: true, style_class: 'winacux-command-results'});
        this.add_child(this._results);

        this._status = new St.Label({style_class: 'winacux-command-status', text: ''});
        this.add_child(this._status);

        this._items = [];
        this._selected = 0;

        this._entry.clutter_text.connect('text-changed', () => this._refresh());
        this._entry.clutter_text.connect('key-press-event', (actor, event) => this._onKey(event));

        Main.layoutManager.addChrome(this, {trackFullscreen: false});

        // Global keybinding: Super+Space
        this._settings = extension.getSettings();
        Main.wm.addKeybinding('win-space', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => this.toggle());
    }

    toggle() {
        if (this.visible)
            this.close();
        else
            this.open();
    }

    open() {
        this.visible = true;
        this._entry.set_text('');
        this._status.text = '';
        this._refresh();
        this._entry.grab_key_focus();
        Main.overview.hide();
    }

    close() {
        this.visible = false;
        this._results.destroy_all_children();
        this._items = [];
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Down) {
            this._move(1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Up) {
            this._move(-1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this._activate(this._selected);
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _move(delta) {
        if (!this._items.length)
            return;
        this._selected = (this._selected + delta + this._items.length) % this._items.length;
        this._renderSelection();
    }

    _activate(index) {
        const item = this._items[index];
        if (!item)
            return;
        this.close();
        // Small delay so the palette is gone before the action animates in.
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 60, () => {
            try {
                item.run();
            } catch (e) {
                logError(e, 'Winacux Command: action failed');
            }
            return GLib.SOURCE_REMOVE;
        });
    }

    async _refresh() {
        const query = this._entry.get_text().trim();
        this._results.destroy_all_children();
        this._items = [];
        this._status.text = '';

        if (!query) {
            this._status.text = 'Try: start study · bluetooth settings · snap now · find receipts';
            return;
        }

        const results = [
            ...searchFlows(query),
            ...searchActions(query),
            ...searchFiles(query),
            ...searchApps(query),
            ...searchSettings(query),
        ];

        results.sort((a, b) => b.score - a.score);
        this._items = results.slice(0, MAX_RESULTS);

        // Nothing matched well: ask the local model instead of shrugging.
        if (!this._items.length || this._items[0].score < 120) {
            this._items.unshift({
                title: `Ask Winacux AI: “${query}”`,
                detail: 'Offline AI',
                run: () => {
                    const ask = () => askAI(query).then(answer => {
                        Main.notify('Winacux AI', answer || 'No answer from the local model.');
                    });
                    ask();
                },
            });
            this._status.text = 'Asking the local model…';
            askAI(query).then(answer => {
                if (this.visible && query === this._entry.get_text().trim())
                    this._status.text = answer ? `AI: ${answer}` : 'Winacux AI is offline.';
            });
        }

        this._renderSelection();
    }

    _renderSelection() {
        this._results.destroy_all_children();
        this._items.forEach((item, index) => {
            const row = new St.Button({
                style_class: index === this._selected
                    ? 'winacux-command-row winacux-command-row-active'
                    : 'winacux-command-row',
                x_expand: true,
            });

            const box = new St.BoxLayout({x_expand: true});
            if (item.icon) {
                box.add_child(new St.Icon({
                    gicon: item.icon,
                    style_class: 'winacux-command-icon',
                }));
            }
            const labels = new St.BoxLayout({vertical: true, x_expand: true});
            labels.add_child(new St.Label({text: item.title, style_class: 'winacux-command-title'}));
            if (item.detail)
                labels.add_child(new St.Label({text: item.detail, style_class: 'winacux-command-detail'}));
            box.add_child(labels);
            row.set_child(box);

            row.connect('clicked', () => {
                this._selected = index;
                this._activate(index);
            });
            this._results.add_child(row);
        });
    }
});

export function createCommandPalette(extension) {
    return new WinacuxCommand(extension);
}
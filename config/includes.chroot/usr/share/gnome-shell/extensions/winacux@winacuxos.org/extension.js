/* WinacuxOS shell extension entry point. */

import Gio from 'gi://Gio';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {createWidgetColumn} from './widgets.js';
import {createPillsBar} from './pills.js';
import {createLiveWallpaper} from './wallpaper.js';
import {FlowEngine} from './flow.js';
import {CursorPhysics} from './cursorfx.js';

export default class WinacuxExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        this._addStyle();

        /* Flow engine (also backs the "wcx flow" CLI) */
        this._flow = new FlowEngine();
        this._flow.enable();

        /* Top bar: Flow buttons + workspace pills */
        this._bar = createPillsBar(name => this._flow.run(name));
        Main.panel.addToStatusArea('winacux', this._bar);

        /* Right-hand widget cards from the mockup */
        this._widgets = createWidgetColumn();
        Main.layoutManager.addChrome(this._widgets, {trackFullscreen: true});

        /* Live wallpaper */
        if (this._settings.get_boolean('live-wallpaper'))
            this._wallpaper = createLiveWallpaper(this);

        /* Cursor physics trail */
        this._cursorFx = new CursorPhysics(this);
        this._cursorFx.enable();

        this._settingsChanged = this._settings.connect('changed', () => {
            const enabled = this._settings.get_boolean('live-wallpaper');
            if (enabled && !this._wallpaper)
                this._wallpaper = createLiveWallpaper(this);
            else if (!enabled && this._wallpaper) {
                this._wallpaper.destroy();
                this._wallpaper = null;
            }
        });
    }

    disable() {
        if (this._settingsChanged) {
            this._settings.disconnect(this._settingsChanged);
            this._settingsChanged = null;
        }

        if (this._wallpaper) {
            this._wallpaper.destroy();
            this._wallpaper = null;
        }
        if (this._widgets) {
            this._widgets.destroy();
            this._widgets = null;
        }
        if (this._bar) {
            this._bar.destroy();
            this._bar = null;
        }
        if (this._flow) {
            this._flow.disable();
            this._flow = null;
        }
        if (this._cursorFx) {
            this._cursorFx.disable();
            this._cursorFx = null;
        }
        this._removeStyle();
    }

    _addStyle() {
        const file = Gio.File.new_for_path(`${this.path}/stylesheet.css`);
        const [, data] = file.load_contents(null);
        this._provider = new St.CssProvider();
        this._provider.load_from_data(data, null);
        Main.getThemeContext().add_provider(this._provider, 1000);
    }

    _removeStyle() {
        if (this._provider) {
            Main.getThemeContext().remove_provider(this._provider);
            this._provider = null;
        }
    }
}
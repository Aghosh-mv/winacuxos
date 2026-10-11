/* WinacuxOS shell extension entry point. */

import Gio from 'gi://Gio';
import Gtk from 'gi://Gtk?version=4.0';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';

import {createWidgetColumn} from './widgets.js';
import {createPillsBar} from './pills.js';
import {createLiveWallpaper} from './wallpaper.js';
import {FlowEngine} from './flow.js';
import {CursorPhysics} from './cursorfx.js';
import {createCommandPalette} from './command.js';
import {createComposer} from './composer.js';

export default class WinacuxExtension extends Extension {
    enable() {
        this._settings = this.getSettings();

        // Logged so boot tests can prove the extension loaded, instead of
        // inferring it from pixels.
        console.log('WinacuxOS: extension enabled');

        try {
            this._addStyle();
        } catch (e) {
            logError(e, 'Winacux: stylesheet setup failed; continuing unstyled');
        }

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

        /* Winacux Command: Super+Space reaches everything */
        this._command = createCommandPalette(this);

        /* Window Composer: our Alt+Tab */
        this._composer = createComposer();
        Main.wm.addKeybinding('composer-toggle', this._settings,
            Meta.KeyBindingFlags.IGNORE_AUTOREPEAT,
            Shell.ActionMode.NORMAL | Shell.ActionMode.OVERVIEW,
            () => {
                if (!this._composer.open())
                    this._composer.close();
            });

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
        if (this._composer) {
            this._composer.destroy();
            this._composer = null;
        }
        if (this._command) {
            this._command.destroy();
            this._command = null;
        }
        if (this._cursorFx) {
            this._cursorFx.disable();
            this._cursorFx = null;
        }
        this._removeStyle();
    }

    /* GNOME 46 replaced St.CssProvider with GTK4's provider, and a missing
     * stylesheet must never take the desktop down with it - so probe, and if
     * neither path works, carry on unstyled. */
    _loadCss(css) {
        if (this._provider) {
            try {
                Main.getThemeContext().remove_provider(this._provider);
            } catch (e) {
                // old GNOME
            }
            this._provider = null;
        }

        try {
            if (St.CssProvider) {
                const provider = new St.CssProvider();
                provider.load_from_data(css, null);
                Main.getThemeContext().add_provider(provider, 1000);
                this._provider = provider;
                return;
            }
        } catch (e) {
            logError(e, 'Winacux: St stylesheet path failed');
        }

        try {
            const provider = new Gtk.CssProvider();
            provider.load_from_string(css);
            Gtk.StyleContext.add_provider_for_display(global.display, provider, 1000);
            this._provider = provider;
            this._gtkProvider = true;
        } catch (e) {
            logError(e, 'Winacux: could not load the stylesheet; running unstyled');
        }
    }

    _removeProvider(provider) {
        if (!provider)
            return;
        try {
            if (this._gtkProvider)
                Gtk.StyleContext.remove_provider_for_display(global.display, provider);
            else
                Main.getThemeContext().remove_provider(provider);
        } catch (e) {
            // Removing a provider that is already gone is not worth reporting.
        }
    }

    _addStyle() {
        const file = Gio.File.new_for_path(`${this.path}/stylesheet.css`);
        const [, data] = file.load_contents(null);
        this._loadCss(new TextDecoder().decode(data));
        this._watchThemeFile();
    }

    /* Theme Studio writes ~/.config/winacux/theme.css; reload the moment it
       changes so picking an accent repaints the desktop instantly. */
    _watchThemeFile() {
        const path = this._settings.get_string('theme-css') ||
            `${GLib.get_home_dir()}/.config/winacux/theme.css`;
        const file = Gio.File.new_for_path(path);

        this._loadThemeFile(file);

        this._themeMonitor = file.monitor_file(Gio.FileMonitorFlags.NONE, null);
        this._themeMonitor.connect('changed', () => this._loadThemeFile(file));
    }

    _loadThemeFile(file) {
        try {
            const [ok, data] = file.load_contents(null);
            if (!ok || data.length === 0)
                return;
            this._removeProvider(this._themeProvider);
            this._themeProvider = null;
            this._loadCss(new TextDecoder().decode(data));
        } catch (e) {
            // No theme file yet, or it is being rewritten: not an error.
        }
    }

    _removeStyle() {
        if (this._themeMonitor) {
            this._themeMonitor.cancel();
            this._themeMonitor = null;
        }
        this._removeProvider(this._themeProvider);
        this._themeProvider = null;
        this._removeProvider(this._provider);
        this._provider = null;
    }
}
/* Window Composer - WinacuxOS's own window switcher.
 *
 * Alt+Tab opens a workspace-aware switcher. Cards show a live thumbnail when
 * the compositor offers window cloning (feature-detected, so it degrades to
 * icon + title cards instead of breaking), cycle with Comma/Period or the arrow
 * keys, and commit after a short idle - the same muscle memory as every other
 * switcher, but with the Winacux look and easing.
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import GObject from 'gi://GObject';
import Meta from 'gi://Meta';
import Shell from 'gi://Shell';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const IDLE_COMMIT_MS = 260;
const CARD_WIDTH = 300;

function canClone() {
    // Mutter has changed this API across releases; probe instead of assuming.
    const workspace = global.workspace_manager.get_active_workspace();
    for (const meta of global.get_window_actors()) {
        const compositor = meta.meta_window?.get_compositor_private?.();
        if (compositor && typeof compositor.clone_new === 'function')
            return true;
    }
    return false;
}

const WinacuxComposer = GObject.registerClass({
    Signals: {opened: {}, committed: {}},
}, class WinacuxComposer extends St.Widget {
    _init() {
        super._init({
            style_class: 'winacux-composer-overlay',
            visible: false,
            reactive: false,
            x_expand: true,
            y_expand: true,
        });

        this._panel = new St.BoxLayout({
            vertical: true,
            style_class: 'winacux-composer',
        });
        this._cards = new St.BoxLayout({style_class: 'winacux-composer-cards'});
        this._panel.add_child(this._cards);
        this.add_child(this._panel);

        this._windows = [];
        this._index = 0;
        this._idleTimer = null;
        this._clones = [];
        this._cloningSupported = false;

        Main.layoutManager.addChrome(this, {trackFullscreen: true});
        this.connect('key-press-event', (actor, event) => this._onKey(event));
        this.grab_key_focus();
    }

    /* ------------------------------------------------------------- collecting */

    _collect() {
        const workspace = global.workspace_manager.get_active_workspace();
        const windows = [];
        for (const meta of global.get_window_actors()) {
            const window = meta.meta_window;
            if (!window || window.is_skip_taskbar() || window.get_workspace() !== workspace)
                continue;
            if (window.get_window_type() !== Meta.WindowType.NORMAL)
                continue;
            if (window.minimized)
                continue;
            windows.push({meta, window});
        }
        return windows;
    }

    /* -------------------------------------------------------------- rendering */

    _render() {
        this._cards.destroy_all_children();

        this._windows.forEach((entry, index) => {
            const {window, meta} = entry;
            const active = index === this._index;

            const card = new St.Bin({
                style_class: active
                    ? 'winacux-composer-card winacux-composer-card-active'
                    : 'winacux-composer-card',
                x_expand: false,
            });

            const thumb = new St.Bin({
                style_class: 'winacux-composer-thumb',
                height: CARD_WIDTH * 0.6,
            });
            card.add_child(thumb);

            if (this._cloningSupported) {
                const clone = this._makeClone(meta);
                if (clone) {
                    entry.clone = clone;
                    thumb.set_child(clone);
                    this._clones.push(clone);
                }
            }
            if (!thumb.get_child()) {
                // Fallback: app icon, so the switcher is still useful.
                const app = window.get_application();
                thumb.set_child(new St.Icon({
                    gicon: app ? app.get_icon() : null,
                    style_class: 'winacux-composer-icon',
                }));
            }

            const caption = new St.BoxLayout({
                vertical: true,
                style_class: 'winacux-composer-caption',
            });
            caption.add_child(new St.Label({
                text: window.get_title() ?? 'Window',
                style_class: 'winacux-composer-title',
            }));
            const app = window.get_application();
            if (app)
                caption.add_child(new St.Label({
                    text: app.get_name(),
                    style_class: 'winacux-composer-app',
                }));
            card.add_child(caption);

            this._cards.add_child(card);
        });
    }

    _makeClone(meta) {
        try {
            const compositor = meta.meta_window?.get_compositor_private?.();
            if (!compositor || typeof compositor.clone_new !== 'function')
                return null;

            // Recent mutter dropped the CloneFlags argument; try the modern
            // signature first and fall back to the old one.
            let clone;
            try {
                clone = compositor.clone_new();
            } catch (e) {
                clone = compositor.clone_new(Clutter.CloneFlags.FULL_RECT);
            }
            const [x, y, width, height] = meta.get_transformed_frame();
            if (width > 0 && height > 0) {
                const scale = Math.min(CARD_WIDTH / width, 1);
                clone.set_scale(scale, scale);
                clone.set_position(-x * scale, -y * scale);
            }
            clone.hide();
            return clone;
        } catch (e) {
            logError(e, 'Winacux Composer: clone failed');
            return null;
        }
    }

    _showClones() {
        for (const clone of this._clones)
            clone.show();
    }

    _destroyClones() {
        for (const clone of this._clones)
            clone.destroy();
        this._clones = [];
        for (const entry of this._windows)
            entry.clone = null;
    }

    /* ------------------------------------------------------------ interaction */

    open() {
        this._windows = this._collect();
        if (!this._windows.length)
            return false;

        this._cloningSupported = canClone();
        this._index = Math.min(1, this._windows.length - 1);
        this._render();
        this._showClones();

        this.visible = true;
        this._panel.opacity = 0;
        this._panel.set_scale(0.94, 0.94);
        this._panel.ease({
            opacity: 255,
            scale_x: 1,
            scale_y: 1,
            duration: 170,
            mode: Clutter.AnimationMode.EASE_OUT_CUBIC,
        });
        this.grab_key_focus();
        this.emit('opened');
        this._resetIdle();
        return true;
    }

    cycle(delta) {
        if (!this.visible || !this._windows.length)
            return;
        this._index = (this._index + delta + this._windows.length) % this._windows.length;
        this._render();
        this._showClones();
        this._resetIdle();
    }

    commit() {
        if (!this.visible)
            return;
        const chosen = this._windows[this._index];
        this.close();
        if (!chosen)
            return;
        chosen.window.activate(global.get_current_time());
        chosen.window.focus(global.get_current_time());
        this.emit('committed');
    }

    close() {
        this._destroyClones();
        this.visible = false;
        if (this._idleTimer) {
            GLib.Source.remove(this._idleTimer);
            this._idleTimer = null;
        }
    }

    _onKey(event) {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Escape) {
            this.close();
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Right || symbol === Clutter.KEY_comma) {
            this.cycle(1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Left || symbol === Clutter.KEY_period) {
            this.cycle(-1);
            return Clutter.EVENT_STOP;
        }
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            this.commit();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    }

    _resetIdle() {
        if (this._idleTimer)
            GLib.Source.remove(this._idleTimer);
        this._idleTimer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, IDLE_COMMIT_MS, () => {
            this._idleTimer = null;
            this.commit();
            return GLib.SOURCE_REMOVE;
        });
    }

    destroy() {
        this.close();
        super.destroy();
    }
});

export function createComposer() {
    return new WinacuxComposer();
}
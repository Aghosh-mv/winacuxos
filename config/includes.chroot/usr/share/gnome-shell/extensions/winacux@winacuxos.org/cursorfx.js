/* Cursor physics for WinacuxOS.
 *
 * Real physics, not a fade-out: the trail is a chain of point masses. Each node
 * is pulled toward the one ahead of it by a spring, damped by friction, and
 * additionally pulled by gravity. Nodes are rendered as actors whose stretch is
 * driven by their own velocity, so a fast flick produces a long streak and a
 * slow drift produces a tight cluster - exactly like a real moving object.
 *
 * Settings (org.gnome.shell.extensions.winacux):
 *   cursor-trail        on/off
 *   cursor-trail-length  number of nodes (visual length)
 *   cursor-trail-spread  node radius in px
 *   cursor-trail-gravity extra downward pull
 *   cursor-trail-fade    how quickly old nodes disappear
 */

import Clutter from 'gi://Clutter';
import GLib from 'gi://GLib';
import St from 'gi://St';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const FRAME_MS = 16;              // ~60 Hz physics step
const NODE_LERP = 0.55;           // how hard a node chases its leader
const MAX_NODES = 48;

export class CursorPhysics {
    constructor(extension) {
        this._extension = extension;
        this._settings = extension.getSettings();
        this._nodes = [];
        this._actors = [];
        this._layer = null;
        this._timeout = null;
        this._pointer = global.get_pointer();
        this._lastX = this._pointer[0];
        this._lastY = this._pointer[1];
        this._speed = 0;
    }

    get _enabled() {
        return this._settings.get_boolean('cursor-trail');
    }

    enable() {
        if (!this._enabled || this._layer)
            return;

        this._layer = new St.Widget({
            reactive: false,
            can_focus: false,
            x_expand: true,
            y_expand: true,
            style_class: 'winacux-cursor-layer',
        });

        this._buildActors();
        // Inserted at the very bottom of the UI group: the trail lives behind
        // windows and panels, like a real shadow trail.
        Main.layoutManager.uiGroup.insert_child_at_index(this._layer, 0);

        this._settingsChanged = this._settings.connect('changed', () => {
            if (!this._enabled)
                this._reset();
        });

        this._timeout = GLib.timeout_add(GLib.PRIORITY_DEFAULT, FRAME_MS,
            () => this._tick());
    }

    disable() {
        if (this._timeout) {
            GLib.Source.remove(this._timeout);
            this._timeout = null;
        }
        if (this._settingsChanged) {
            this._settings.disconnect(this._settingsChanged);
            this._settingsChanged = null;
        }
        this._reset();
    }

    _reset() {
        for (const actor of this._actors)
            actor.destroy();
        this._actors = [];
        this._nodes = [];
        if (this._layer) {
            this._layer.destroy();
            this._layer = null;
        }
    }

    _buildActors() {
        const wanted = Math.min(
            MAX_NODES,
            Math.max(6, this._settings.get_int('cursor-trail-length') || 22));
        const spread = this._settings.get_int('cursor-trail-spread') || 9;

        for (let i = 0; i < wanted; i++) {
            const node = new St.Widget({
                style_class: 'winacux-cursor-node',
                width: spread * 2,
                height: spread * 2,
                reactive: false,
                can_focus: false,
                opacity: 0,
            });
            this._layer.add_child(node);
            this._actors.push(node);
        }
    }

    _tick() {
        if (!this._layer)
            return GLib.SOURCE_REMOVE;

        const [x, y] = global.get_pointer();
        const dx = x - this._lastX;
        const dy = y - this._lastY;
        this._lastX = x;
        this._lastY = y;

        // Velocity (px/frame) with a little smoothing.
        const instant = Math.sqrt(dx * dx + dy * dy);
        this._speed = this._speed * 0.7 + instant * 0.3;

        const spread = this._settings.get_int('cursor-trail-spread') || 9;
        const gravity = this._settings.get_double('cursor-trail-gravity') || 0.0;
        const fade = this._settings.get_double('cursor-trail-fade') || 0.86;

        // The head node tracks the pointer exactly.
        if (this._nodes.length === 0)
            this._nodes.push({x, y, vx: 0, vy: 0});

        const head = this._nodes[0];
        const ax = (x - head.x) * NODE_LERP;
        const ay = (y - head.y) * NODE_LERP + gravity;
        head.vx = (head.vx + ax) * 0.82;
        head.vy = (head.vy + ay) * 0.82;
        head.x += head.vx;
        head.y += head.vy;

        // Every other node is a spring-damper chasing its leader.
        for (let i = 1; i < this._nodes.length; i++) {
            const node = this._nodes[i];
            const leader = this._nodes[i - 1];
            node.vx = (node.vx + (leader.x - node.x) * NODE_LERP) * 0.86;
            node.vy = (node.vy + (leader.y - node.y) * NODE_LERP + gravity) * 0.86;
            node.x += node.vx;
            node.y += node.vy;
        }

        // Grow the chain while the pointer is actually moving.
        if (instant > 1.5 && this._nodes.length < this._actors.length)
            this._nodes.push({x, y, vx: -dx * 0.3, vy: -dy * 0.3});
        if (instant <= 0.4 && this._nodes.length > 1)
            this._nodes.pop();

        // Render.
        for (let i = 0; i < this._actors.length; i++) {
            const actor = this._actors[i];
            const node = this._nodes[i];
            if (!node) {
                actor.opacity = Math.max(0, actor.opacity * 0.8);
                continue;
            }

            const age = i / Math.max(1, this._nodes.length - 1);
            const velocity = Math.sqrt(node.vx * node.vx + node.vy * node.vy);

            actor.set_position(node.x - spread, node.y - spread);

            // Stretch along the direction of travel: fast = streak, slow = dot.
            const stretch = 1 + Math.min(2.4, velocity / 6);
            const angle = Math.atan2(node.vy, node.vx);
            actor.set_pivot_point(0.5, 0.5);
            actor.set_rotation_angle_z(angle);
            actor.set_scale(stretch, 1);

            const life = 1 - age;
            const target = life * life * Math.min(1, velocity / 2 + 0.15);
            actor.opacity = actor.opacity * fade + target * 255 * (1 - fade);
        }

        return GLib.SOURCE_CONTINUE;
    }
}
/* WinacuxOS live wallpaper.
 *
 * GNOME draws its background once; this adds a second, animated layer behind
 * the desktop: the artwork drifts slowly (GPU-friendly actor translation, not
 * per-frame redraw) and a soft glow breathes behind it.
 *
 * Anime artwork drop-in: point the "wallpaper-art" setting at any image, or
 * drop a file at ~/Pictures/winacux-wallpaper.png. Anything you provide is
 * used as-is; the default ships the WinacuxOS dusk-lake scene.
 */

import Clutter from 'gi://Clutter';
import St from 'gi://St';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';

const DEFAULT_ART = '/usr/share/winacuxos/wallpaper.png';
const USER_ART_PATHS = [
    GLib.get_home_dir() + '/Pictures/winacux-wallpaper.png',
    GLib.get_home_dir() + '/Pictures/Winacux Wallpaper.png',
];

function findArtwork(setting) {
    const custom = setting.get_string();
    if (custom && GLib.file_test(custom, GLib.FileTest.EXISTS))
        return custom;

    for (const path of USER_ART_PATHS) {
        if (GLib.file_test(path, GLib.FileTest.EXISTS))
            return path;
    }
    return DEFAULT_ART;
}

function fileExists(path) {
    return GLib.file_test(path, GLib.FileTest.EXISTS);
}

export function createLiveWallpaper(extension) {
    const setting = extension.getSettings();
    const monitor = Main.layoutManager.primaryMonitor;

    const layer = new St.Widget({
        reactive: false,
        can_focus: false,
        x_expand: true,
        y_expand: true,
        x_align: Clutter.ActorAlign.FILL,
        y_align: Clutter.ActorAlign.FILL,
        style_class: 'winacux-wallpaper-layer',
    });

    const art = new St.Widget({
        style_class: 'winacux-wallpaper-art',
        width: Math.round(monitor.width * 1.06),
        height: Math.round(monitor.height * 1.06),
        x_align: Clutter.ActorAlign.START,
        y_align: Clutter.ActorAlign.START,
        x_expand: true,
        y_expand: true,
    });

    const applyArt = () => {
        const uri = Gio.File.new_for_path(findArtwork(setting)).get_uri();
        art.style = `background-image: url('${uri}'); background-size: 100% 100%;`;
    };
    applyArt();
    setting.connect('changed::wallpaper-art', applyArt);

    const glow = new St.Widget({
        style_class: 'winacux-wallpaper-glow',
        x_expand: true,
        y_expand: true,
    });

    layer.add_child(glow);
    layer.add_child(art);

    // Sit directly behind the desktop UI, above GNOME's static background.
    const layout = Main.layoutManager;
    const previousParent = art.get_parent();
    layout.uiGroup.insert_child_at_index(layer, 0);

    // Drift: ping-pong across a few percent of the screen over a long period.
    const driftX = (monitor.width * 0.06) / 2;
    const driftY = (monitor.height * 0.06) / 2;

    art.ease({
        translation_x: driftX,
        translation_y: driftY,
        duration: 60000,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
    });

    const breathe = glow.ease({
        opacity: 255,
        duration: 9000,
        mode: Clutter.AnimationMode.EASE_IN_OUT_SINE,
    });

    layer.connect('destroy', () => {
        setting.disconnect(applyArt);
        if (previousParent)
            previousParent.remove_child(layer);
    });

    return layer;
}
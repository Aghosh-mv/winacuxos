/* WinacuxOS desktop widget cards.
 *
 * The four cards from the WinacuxOS mockup: system identity, weather,
 * system usage and a calendar. Brand text follows BRANDING.md: identity
 * strings keep their mockup values, telemetry (uptime, CPU/memory/disk,
 * calendar) reads the real system.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Clutter from 'gi://Clutter';
import GdkPixbuf from 'gi://GdkPixbuf';
import Gio from 'gi://Gio';

import {createAICard} from './ai.js';

const BRAND = {
    name: 'WinacuxOS',
    version: 'v1.0.0',
    kernel: 'Winacux Kernel 6.6.0',
    architecture: 'x86_64',
    user: 'Geethu',
    tagline: 'Simple. Fast. Powerful.',
    weather: {
        place: 'Kochi, India',
        temp: '28°C',
        condition: 'Partly Cloudy',
        high: 'H: 31°',
        low: 'L: 24°',
    },
};

/* ------------------------------------------------------------------ data */

function readProcFile(path) {
    const [ok, bytes] = GLib.file_get_contents(path);
    if (!ok)
        return '';
    return new TextDecoder().decode(bytes);
}

function cpuUsage(previous) {
    const text = readProcFile('/proc/stat');
    const line = text.split('\n').find(l => l.startsWith('cpu '));
    if (!line)
        return {percent: 0, previous: null};

    const values = line.trim().split(/\s+/).slice(1).map(Number);
    const idle = values[3] + (values[4] || 0);
    const total = values.reduce((a, b) => a + b, 0);

    if (!previous)
        return {percent: 0, previous: {idle, total}};

    const idleDelta = idle - previous.idle;
    const totalDelta = total - previous.total;
    const percent = totalDelta > 0
        ? Math.max(0, Math.min(100, Math.round((1 - idleDelta / totalDelta) * 100)))
        : 0;

    return {percent, previous: {idle, total}};
}

function memoryUsage() {
    const text = readProcFile('/proc/meminfo');
    const value = name => {
        const match = text.match(new RegExp(`^${name}:\\s+(\\d+)`, 'm'));
        return match ? parseInt(match[1], 10) : 0;
    };
    const total = value('MemTotal');
    const available = value('MemAvailable');
    if (!total)
        return 0;
    return Math.round(((total - available) / total) * 100);
}

function diskUsage() {
    try {
        const file = Gio.File.new_for_path('/');
        const info = file.query_filesystem_info('filesystem::*',
            Gio.FileQueryInfoFlags.NONE, null);
        const size = info.get_attribute_uint64('filesystem::size');
        const used = info.get_attribute_uint64('filesystem::used');
        if (!size)
            return 0;
        return Math.round((used / size) * 100);
    } catch (e) {
        return 0;
    }
}

function uptimeText() {
    const text = readProcFile('/proc/uptime');
    const seconds = parseFloat(text.split(' ')[0]);
    if (!seconds)
        return '0m';

    const days = Math.floor(seconds / 86400);
    const hours = Math.floor((seconds % 86400) / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);

    if (days > 0)
        return `${days}d ${hours}h`;
    if (hours > 0)
        return `${hours}h ${minutes}m`;
    return `${minutes}m`;
}

/* ---------------------------------------------------------------- widgets */

function card(title) {
    const box = new St.BoxLayout({
        vertical: true,
        style_class: 'winacux-card',
    });
    if (title) {
        box.add_child(new St.Label({
            text: title,
            style_class: 'winacux-card-title',
        }));
    }
    return box;
}

function systemCard() {
    const box = card(null);
    box.add_child(new St.Label({
        text: `${BRAND.name}  ${BRAND.version}`,
        style_class: 'winacux-card-title',
    }));

    const logo = new St.Bin({
        style_class: 'winacux-logo-bin',
        child: new St.Widget({
            style_class: 'winacux-logo',
            background_image: `file:///usr/share/winacuxos/logo-256.png`,
        }),
    });
    box.add_child(logo);

    const rows = new St.BoxLayout({vertical: true, style_class: 'winacux-rows'});
    const addRow = (label, value, valueClass = '') => {
        const row = new St.BoxLayout({style_class: 'winacux-row'});
        row.add_child(new St.Label({text: label, style_class: 'winacux-row-key'}));
        const val = new St.Label({text: value, style_class: `winacux-row-value ${valueClass}`});
        row.add_child(val);
        rows.add_child(row);
        return val;
    };

    addRow('Kernel', BRAND.kernel, 'winacux-mono');
    addRow('Architecture', BRAND.architecture, 'winacux-mono');
    addRow('Uptime', uptimeText(), 'winacux-mono');
    addRow('User', BRAND.user);

    box.add_child(rows);
    box.add_child(new St.Label({
        text: BRAND.tagline,
        style_class: 'winacux-tagline',
    }));
    return box;
}

function weatherCard() {
    const box = card(null);
    const header = new St.BoxLayout({style_class: 'winacux-row'});
    header.add_child(new St.Label({
        text: BRAND.weather.place,
        style_class: 'winacux-card-title',
    }));
    box.add_child(header);

    const temp = new St.Label({
        text: BRAND.weather.temp,
        style_class: 'winacux-temp',
    });
    box.add_child(temp);

    box.add_child(new St.Label({
        text: BRAND.weather.condition,
        style_class: 'winacux-row-value',
    }));

    const footer = new St.BoxLayout({style_class: 'winacux-row'});
    footer.add_child(new St.Label({
        text: BRAND.weather.high,
        style_class: 'winacux-row-value',
    }));
    footer.add_child(new St.Label({
        text: BRAND.weather.low,
        style_class: 'winacux-row-value',
    }));
    box.add_child(footer);
    return box;
}

function usageCard() {
    const box = card('System Usage');
    const bars = {};

    for (const [key, color] of [['CPU', '#F5B942'], ['Memory', '#4DA3FF'], ['Disk', '#22C55E']]) {
        const row = new St.BoxLayout({style_class: 'winacux-usage-row'});
        row.add_child(new St.Label({text: key, style_class: 'winacux-usage-key'}));

        const track = new St.Widget({
            style_class: 'winacux-usage-track',
            layout_manager: new Clutter.BinLayout(),
        });
        const fill = new St.Widget({style_class: 'winacux-usage-fill'});
        fill.add_style_class_name(`winacux-usage-fill-${color.replace('#', '')}`);
        fill.set_style(`width: 0px;`);
        track.set_child(fill);
        row.add_child(track);

        const label = new St.Label({text: '0%', style_class: 'winacux-usage-value'});
        row.add_child(label);
        box.add_child(row);
        bars[key] = {fill, label};
    }

    box.refreshUsage = (cpu, mem, disk) => {
        for (const [key, value] of [['CPU', cpu], ['Memory', mem], ['Disk', disk]]) {
            const {fill, label} = bars[key];
            fill.set_style(`width: ${Math.max(2, Math.round(value * 1.6))}px;`);
            label.text = `${value}%`;
        }
    };
    box.refreshUsage(0, 0, 0);
    return box;
}

function calendarCard() {
    const box = card(null);
    const today = GLib.DateTime.new_now_local();
    let year = today.get_year();
    let month = today.get_month();

    const header = new St.BoxLayout({style_class: 'winacux-row'});
    const title = new St.Label({text: '', style_class: 'winacux-card-title'});
    header.add_child(title);
    box.add_child(header);

    const weekdays = new St.BoxLayout({style_class: 'winacux-cal-week'});
    for (const day of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) {
        weekdays.add_child(new St.Label({text: day, style_class: 'winacux-cal-weekday'}));
    }
    box.add_child(weekdays);

    const grid = new St.BoxLayout({vertical: true, style_class: 'winacux-cal-grid'});
    box.add_child(grid);

    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    box.refreshCalendar = () => {
        title.text = `${MONTHS[month - 1]} ${year}`;
        grid.destroy_all_children();

        const first = GLib.DateTime.new_local(year, month, 1);
        const daysInMonth = first.get_days_in_month();
        const leading = first.get_day_of_week() % 7; // Sunday-first grid
        const now = GLib.DateTime.new_now_local();

        let row = null;
        let column = 0;
        const newRow = () => {
            row = new St.BoxLayout({style_class: 'winacux-cal-week'});
            grid.add_child(row);
            column = 0;
        };
        newRow();

        for (let i = 0; i < leading; i++, column++)
            row.add_child(new St.Widget({style_class: 'winacux-cal-day'}));

        for (let day = 1; day <= daysInMonth; day++, column++) {
            if (column === 7) {
                column = 0;
                newRow();
            }
            const isToday = day === now.get_day_of_month()
                && month === now.get_month() && year === now.get_year();
            row.add_child(new St.Label({
                text: `${day}`,
                style_class: isToday
                    ? 'winacux-cal-day winacux-cal-today'
                    : 'winacux-cal-day',
            }));
        }
    };

    box.refreshCalendar();
    return box;
}

/* ----------------------------------------------------------------- export */

export function createWidgetColumn() {
    const column = new St.BoxLayout({
        vertical: true,
        style_class: 'winacux-column',
        y_align: Clutter.ActorAlign.START,
        x_align: Clutter.ActorAlign.END,
    });

    const usage = usageCard();
    column.add_child(createAICard());
    column.add_child(systemCard());
    column.add_child(weatherCard());
    column.add_child(usage);
    column.add_child(calendarCard());

    let previousCpu = null;

    const tick = () => {
        const cpu = cpuUsage(previousCpu);
        previousCpu = cpu.previous;
        usage.refreshUsage(cpu.percent, memoryUsage(), diskUsage());
    };
    tick();

    const calendar = column.get_children()[3];

    column.connect('destroy', () => {
        clearInterval(timer);
    });

    const timer = setInterval(tick, 2000);
    const calendarTimer = setInterval(() => calendar.refreshCalendar(), 60000);

    return column;
}
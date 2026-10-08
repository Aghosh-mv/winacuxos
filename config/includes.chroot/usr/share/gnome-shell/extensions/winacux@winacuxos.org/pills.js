/* WinacuxOS top-bar identity: workspace pills and Flow launcher buttons. */

import St from 'gi://St';
import Clutter from 'gi://Clutter';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {getWorkspaceManager} from 'resource:///org/gnome/shell/ui/workspace.js';

const FLOWS = [
    {name: 'Study', key: 'study'},
    {name: 'Code', key: 'code'},
    {name: 'Focus', key: 'focus'},
    {name: 'Create', key: 'create'},
];

export function createPillsBar(runFlow) {
    const bar = new St.BoxLayout({
        style_class: 'winacux-bar',
        y_align: Clutter.ActorAlign.CENTER,
    });

    /* Flow buttons: WinacuxOS intent launcher */
    const flowBox = new St.BoxLayout({style_class: 'winacux-flow-box'});
    for (const flow of FLOWS) {
        const button = new St.Button({
            style_class: 'winacux-flow-button',
            label: flow.name,
            can_focus: true,
            y_align: Clutter.ActorAlign.CENTER,
        });
        button.connect('clicked', () => runFlow(flow.key));
        flowBox.add_child(button);
    }
    bar.add_child(flowBox);

    /* Workspace pills: 1 2 3 4 */
    const pills = new St.BoxLayout({style_class: 'winacux-pills'});
    const workspaceManager = getWorkspaceManager();

    const rebuild = () => {
        pills.destroy_all_children();
        for (let i = 0; i < workspaceManager.get_n_workspaces(); i++) {
            const index = i;
            const button = new St.Button({
                style_class: 'winacux-pill',
                label: `${i + 1}`,
                can_focus: true,
                y_align: Clutter.ActorAlign.CENTER,
            });
            if (i === workspaceManager.get_active_workspace().index())
                button.add_style_class_name('winacux-pill-active');
            button.connect('clicked', () => {
                workspaceManager.get_workspace_by_index(index).activate();
            });
            pills.add_child(button);
        }
    };

    rebuild();
    const workspacesChanged = workspaceManager.connect('workspaces-reordered', rebuild);
    const activeChanged = workspaceManager.connect('active-workspace-changed',
        (_mgr, before, after) => {
            if (before === after)
                return;
            rebuild();
        });

    bar.connect('destroy', () => {
        workspaceManager.disconnect(workspacesChanged);
        workspaceManager.disconnect(activeChanged);
    });

    bar.add_child(pills);
    return bar;
}
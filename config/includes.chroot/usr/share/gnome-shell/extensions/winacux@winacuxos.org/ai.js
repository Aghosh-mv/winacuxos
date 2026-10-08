/* Winacux AI: the desktop chat card.
 *
 * Talks to the local llama.cpp server (winacux-ai.service) over loopback.
 * Nothing leaves the machine - there is no cloud endpoint anywhere in here.
 */

import GLib from 'gi://GLib';
import St from 'gi://St';
import Soup from 'gi://Soup?version=3.0';

const HOST = '127.0.0.1';
const PORT = 8080;
const MODEL = 'winacux-local';

const SYSTEM_PROMPT =
    'You are Winacux AI, the offline assistant that ships inside WinacuxOS. ' +
    'Answer briefly and practically. You help with files, settings, errors and code. ' +
    'When the user describes an intent such as "I want to study", reply with the exact ' +
    'command: wcx flow <study|code|focus|create>.';

export function createAICard() {
    const box = new St.BoxLayout({
        vertical: true,
        style_class: 'winacux-card winacux-ai-card',
    });

    box.add_child(new St.Label({
        text: 'Winacux AI',
        style_class: 'winacux-card-title',
    }));
    box.add_child(new St.Label({
        text: 'offline · on this machine',
        style_class: 'winacux-ai-status',
    }));

    const answer = new St.Label({
        style_class: 'winacux-ai-answer',
        text: 'Ask me to find a file, explain an error, or help you code.',
    });
    box.add_child(answer);

    const row = new St.BoxLayout({style_class: 'winacux-row'});
    const entry = new St.Entry({
        style_class: 'winacux-ai-entry',
        hint_text: 'Ask Winacux AI...',
        can_focus: true,
        x_expand: true,
    });
    const send = new St.Button({
        style_class: 'winacux-ai-send',
        label: 'Ask',
        can_focus: true,
        y_align: Clutter.ActorAlign.CENTER,
    });
    row.add_child(entry);
    row.add_child(send);
    box.add_child(row);

    const session = new Soup.Session();
    let busy = false;

    function ask(question) {
        question = (question || '').trim();
        if (!question || busy)
            return;

        busy = true;
        send.label = '...';
        answer.text = 'Thinking...';

        const payload = JSON.stringify({
            model: MODEL,
            stream: false,
            messages: [
                {role: 'system', content: SYSTEM_PROMPT},
                {role: 'user', content: question},
            ],
        });

        const message = Soup.Message.new('POST', `http://${HOST}:${PORT}/v1/chat/completions`);
        message.set_request_body_from_bytes('application/json',
            new TextEncoder().encode(payload));

        session.send_and_read_async(message, GLib.PRIORITY_DEFAULT, null,
            (session, result) => {
                busy = false;
                send.label = 'Ask';
                try {
                    const bytes = session.send_and_read_finish(result);
                    const data = JSON.parse(new TextDecoder().decode(bytes.get_data()));
                    const text = data?.choices?.[0]?.message?.content ?? '';
                    answer.text = text.trim() || 'No answer.';
                } catch (e) {
                    answer.text = 'Winacux AI is offline. Start it with: sudo systemctl start winacux-ai';
                }
                entry.set_text('');
            });
    }

    send.connect('clicked', () => ask(entry.get_text()));
    entry.clutter_text.connect('key-press-event', (actor, event) => {
        const symbol = event.get_key_symbol();
        if (symbol === Clutter.KEY_Return || symbol === Clutter.KEY_KP_Enter) {
            ask(entry.get_text());
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });

    return box;
}
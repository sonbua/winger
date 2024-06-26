/* Send messages to the background frame */

import { getValue } from '../storage.js';
import { get as getModifiers } from '../modifier.js';
import { $currentWindowRow } from './common.js';

const sendMessage = browser.runtime.sendMessage;

//@ -> (Promise: Object)
export const popup = () => sendMessage({ type: 'popup' });
//@ (Number, String) -> state
export const updateChrome = (windowId, name) => sendMessage({ type: 'update', windowId, name });
//@ -> state
export const showWarningBadge = () => sendMessage({ type: 'warn' });
export const help = () => sendMessage({ type: 'help' });
export const debug = () => sendMessage({ type: 'debug' });

// Gather action parameters to create request. Proceed only if action string given via `command` or derived from `$action`.
//@ (Object) -> state|nil
export function action({ event, $action, command, argument }) {
    const request = { type: 'action' };
    if (command) {
        request.action = command;
    } else
    if ($action) {
        const $row = $action.$row || $action;
        if ($row.matches('.tabless') && (event.ctrlKey || event.shiftKey))
            return; // Do not allow send/bring to a "tabless" window via modifier-click on row (send/bring buttons should be disabled)
        request.windowId = $row._id;
        request.minimized = $row.matches('.minimized');
        request.action = $action.dataset.action || $row.dataset.action;
    }
    if (!request.action)
        return;
    request.argument = argument;
    request.modifiers = getModifiers(event);
    sendMessage(request); // request = { type: 'action', action, argument, minimized, modifiers, windowId }
    window.close();
}

//@ (Object) -> state
export async function stash(event) {
    const $row = event.target.closest('li') || $currentWindowRow;
    if ($row.matches('.tabless'))
        return; // Do not allow stashing a "tabless" window
    const $name = $row.$name;
    let name = $name.value;
    if (!name && await getValue('stash_nameless_with_title'))
        name = $name.placeholder;
    const close = !event.shiftKey;
    sendMessage({ type: 'stash', windowId: $row._id, name, close });
    window.close();
}

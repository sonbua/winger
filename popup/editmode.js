import {
    $body,
    $currentWindowRow,
    $omnibox,
    isField,
    isNameField,
    isInToolbar,
} from './common.js';
import * as Omnibox from './omnibox.js';
import * as Request from './request.js';

export let isActive = false; // Indicates if popup is in edit mode
let $names;

//@ (Object|undefined), state -> state
export function toggle($name = $currentWindowRow.$name) {
    isActive ? done() : activate($name);
}

//@ (Object), state -> state
function activate($name) {
    $names = [...$body.querySelectorAll('.name')];
    setActive(true);
    $name.focus();
    $name._original = $name.value; // Remember name at focus time
    if ($omnibox.value.startsWith('/'))
        Omnibox.clear();
}

//@ -> state
function done() {
    setActive(false);
    clearErrors();
    $currentWindowRow.$name.tabIndex = 0;
    $omnibox.focus();
}

//@ (Boolean) -> state
function setActive(isActivate) {
    isActive = isActivate;
    $body.dataset.mode = isActivate ? 'edit' : 'normal';
    toggleNameFields(isActivate);
}

//@ (Object) -> (Boolean), state|nil
export function handleMouseDown($el) {
    if (!isActive)
        return false;

    if (isNameField($el))
        return true;

    const $name = $el.closest('li')?.$name;
    if ($name) {
        $name.focus();
        $name.select();
    }
    return true;
}

//@ (Object, Object) -> (Boolean), state|nil
export function handleFocusIn($focused, $defocused) {
    if (!isActive)
        return false;

    // Allow focus only on fields and toolbar buttons
    if (!(isField($focused) || isInToolbar($focused))) {
        $defocused.focus();
        return true;
    }

    let isHandled = false;

    if (isNameField($defocused)) {
        trySaveName($defocused);
        isHandled = true;
    }
    if (isNameField($focused)) {
        $focused._original = $focused.value; // Remember name at focus time
        isHandled = true;
    }
    return isHandled;
}

//@ (Object) -> (Boolean), state|nil
export async function handleInput($name) {
    if (!isActive || !isNameField($name))
        return false;

    // Check name for validity, mark if invalid
    const error = await Request.checkName($name.$row._id, $name.value.trim());
    toggleError($name, error);

    return true;
}

//@ (Object, String) -> (Boolean), state|nil
export function handleKeyUp({ target, key }) {
    if (!isActive || !isNameField(target))
        return false;

    if (key === 'Enter') {
        trySaveName(target);
        done();
    }
    return true;
}

// If name is invalid: restore original name and return false.
// Otherwise: proceed to save, indicate success and return true.
//@ (Object) -> (Boolean), state|nil
function trySaveName($name) {
    // Revert if marked invalid
    if ($name.classList.contains('error')) {
        $name.value = $name._original;
        clearErrors();
        return false;
    }

    const name =
        $name.value =
        $name.value.trim();

    // Skip save if unchanged
    if (name === $name._original)
        return true;

    // Save
    const $row = $name.$row;
    const windowId = $row._id;
    Request.setName(windowId, name);

    // Indicate success
    $row.classList.add('success');
    setTimeout(() => $row.classList.remove('success'), 1000);

    return true;
}

// Indicate if name is invalid, as well as the duplicate name if any.
//@ (Object, Number) -> state
function toggleError($name, error) {
    if (!error)
        return clearErrors();
    if (error > 0) {
        const $sameName = $names.find($name => $name.$row._id == error);
        $sameName.classList.add('error');
    }
    $name.classList.add('error');
}

///@ -> state|nil
function clearErrors() {
    $names.forEach($name => $name.classList.remove('error'));
}

//@ (Boolean) -> state
function toggleNameFields(isEnable) {
    const tabIndex = isEnable ? 0 : -1;
    const isReadOnly = !isEnable;
    for (const $name of $names) {
        $name.tabIndex = tabIndex;
        $name.readOnly = isReadOnly;
    }
}
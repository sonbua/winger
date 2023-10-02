/*
A winfo ("window info") is similar to but distinct from a standard browser.windows window-object.
May contain as few or as many props as required; copied and/or derived from a window-object, and/or previously saved via browser.sessions.
*/
import * as Settings from '../settings.js';

// Dict of keys for sessions.getWindowValue() mapped to default values.
const PROPS_TO_LOAD = {
    givenName: '',
    firstSeen: 0,
    lastFocused: 0,
};

// Dict of keys mapped to functions that derive new values, adding new properties to (i.e. mutating) `winfo`.
//@ (Object, Object) -> state
const PROPS_TO_DERIVE = {
    minimized(window, winfo) {
        winfo.minimized = window.state === 'minimized';
    },
    // givenName ? tab title : window title
    // Requires `winfo.givenName`
    titleSansName(window, winfo, { nameAffixLength }) {
        const { givenName } = winfo;
        winfo.titleSansName = givenName ?
            window.title.slice(givenName.length + nameAffixLength) :
            window.title;
    },
    // Requires populated `window.tabs`
    // Also adds `winfo.selectedTabCount` if window is focused
    tabCount(window, winfo) {
        winfo.tabCount = window.tabs.length;
        if (window.focused)
            winfo.selectedTabCount = window.tabs.filter(tab => tab.highlighted).length;
    },
};

// Given a list of wanted properties, produce winfos for all windows.
// `windows` is optional; include if already procured before via browser.windows.getAll() or similar.
// Refer to PROPS_TO_LOAD, PROPS_TO_DERIVE and the standard window-object for property candidiates. 'id' is always included.
//@ ([String], undefined|[Object]), state -> ([Object])
export async function getAll(wantedProps = [], windows = null) {
    wantedProps = new Set(wantedProps);
    wantedProps.add('id');

    let nameAffixes;
    [windows, nameAffixes] = await Promise.all([
        windows ?? browser.windows.getAll({ populate: wantedProps.has('tabCount') }),
        wantedProps.has('titleSansName') && Settings.getValue(['title_preface_prefix', 'title_preface_postfix']),
    ]);

    // Split propsToLoad and propsToDerive out of wantedProps, leaving behind "propsToCopy"
    const propsToLoad = [];
    for (const prop in PROPS_TO_LOAD) {
        if (wantedProps.delete(prop))
            propsToLoad.push(prop);
    }
    const propsToDerive = [];
    for (const prop in PROPS_TO_DERIVE) {
        if (wantedProps.delete(prop))
            propsToDerive.push(prop);
    }

    const commonInfo = {
        propsToLoad,
        propsToDerive,
        propsToCopy: wantedProps,
        nameAffixLength: nameAffixes.join?.('').length ?? 0,
    };

    return Promise.all( windows.map(window => getOne(window, commonInfo)) );
}

//@ (Object, Object), state -> (Object)
async function getOne(window, commonInfo) {
    // Load window's saved props to start winfo with
    const windowId = window.id;
    const makeEntry = async prop => [ prop, (await browser.sessions.getWindowValue(windowId, prop) ?? PROPS_TO_LOAD[prop]) ];
    const makingEntries = [];
    for (const prop of commonInfo.propsToLoad) {
        if (prop in PROPS_TO_LOAD)
            makingEntries.push(makeEntry(prop));
    }
    const winfo = Object.fromEntries(await Promise.all(makingEntries));

    // Derive and add new props to winfo
    for (const prop of commonInfo.propsToDerive)
        PROPS_TO_DERIVE[prop](window, winfo, commonInfo);

    // Copy props from window to winfo
    for (const prop of commonInfo.propsToCopy)
        winfo[prop] = window[prop];

    return winfo;
}

// Split a list of winfos into the current-winfo and a SORTED list of other-winfos.
// Needs winfos with `focused` and `lastFocused` properties for arrange() to work correctly.
//@ ([Object]) -> (Object, [Object])
export function arrange(winfos) {
    const currentIndex = winfos.findIndex(winfo => winfo.focused);
    if (currentIndex === -1)
        throw 'Expected winfo.focused property';
    const currentWinfo = winfos.splice(currentIndex, 1)[0];
    winfos.sort((a, b) => (a.minimized - b.minimized) || (b.lastFocused - a.lastFocused));
    return {
        currentWinfo,
        otherWinfos: winfos,
    };
}

//@ (Number) -> state
export const saveLastFocused = windowId => browser.sessions.setWindowValue(windowId, 'lastFocused', Date.now());
//@ (Number) -> state
export const saveFirstSeen = windowId => browser.sessions.setWindowValue(windowId, 'firstSeen', Date.now());
//@ (Number), state -> (Promise: Number|undefined)
export const loadFirstSeen = windowId => browser.sessions.getWindowValue(windowId, 'firstSeen');


/*
StashProp module - Encode and decode tab/window properties into and from JSON annotations in folder/bookmark titles.
Example JSON annotation: '{"pinned":true,"id":"abcdef123","parentId":"uvwxyz789","container":"Personal"}'
Stash procedure:
- folderTitle = StashProp.Window.stringify(name, window)
- Create folder
- await StashProp.Tab.prepare(tabs)
- bookmarkTitle = StashProp.Tab.stringify(tab, folderId)
- Create bookmarks
Unstash procedure:
- [name, protoWindow] = StashProp.Window.parse(folderTitle)
- Create window
- protoTab = StashProp.Tab.parse(bookmarkTitle)
- await StashProp.Tab.preOpen(protoTabs, window)
- safeProtoTab = StashProp.Tab.scrub(protoTab) - remove properties unsupported by browser.tabs.create()
- Create tabs with safeProtoTabs
- StashProp.Tab.postOpen(protoTabs, tabs)
*/

import { GroupMap } from '../utils.js';

// Write and read simple window/tab properties.
// Only truthy properties are written.
const Props = {

    // Define annotation-property writer and reader functions here.
    //@ (Object) -> (Boolean)
    WINDOW: {
        writer: {
            private: ({ incognito }) => incognito, // 'private' as alias of 'incognito'; Firefox users are more familiar with the former
        },
        reader: {
            incognito: parsed => parsed.private || parsed.incognito, // Either 'private' or 'incognito' props are read
        },
    },
    TAB: {
        writer: {
            //@ (Object) -> (Boolean)
            active: ({ active }) => active,
            muted:  ({ mutedInfo: { muted } }) => muted,
            pinned: ({ pinned }) => pinned,
        },
        reader: {
            //@ (Object) -> (Boolean)
            active: ({ active }) => active,
            muted:  ({ muted }) => muted,
            pinned: ({ pinned }) => pinned,
        },
    },

    //@ (Object, Object) -> (Object)
    write(thing, { writer }) {
        const toStringify = {};
        for (const key in writer) {
            const value = writer[key](thing);
            if (value)
                toStringify[key] = value;
        }
        return toStringify;
    },

    //@ (Object, Object) -> (Object)
    read(parsed, { reader }) {
        const protoThing = {};
        for (const key in reader) {
            const value = reader[key](parsed);
            if (value)
                protoThing[key] = value;
        }
        return protoThing;
    },

}

const NON_CONTAINER_ID_SET = new Set(['firefox-default', 'firefox-private']);
const isContainered = tab => !NON_CONTAINER_ID_SET.has(tab.cookieStoreId); //@ (Object) -> (Boolean)

const Containers = {

    // Mark containered tabs with a container='container-name' property.
    //@ ([Object]) -> state
    async prepare(tabs) {
        if (!browser.contextualIdentities)
            return;

        // Find container ids among tabs to build Map(containerId: tabArray)
        const containerIdTabMap = new GroupMap();
        for (const tab of tabs) if (isContainered(tab))
            containerIdTabMap.group(tab.cookieStoreId, tab);

        if (!containerIdTabMap.size)
            return;

        // Get container names to build {cookieStoreIds: containerName} dict
        const containerIdNameDict = Object.fromEntries(
            (await Promise.all(
                [...containerIdTabMap.keys()].map(Containers._getIdNamePair)
            )).filter(Boolean)
        );
        // Assign container names to tabs
        for (const [containerId, tabs] of containerIdTabMap) {
            const containerName = containerIdNameDict[containerId];
            for (const tab of tabs)
                tab.container = containerName;
        }
    },

    //@ (Object) -> (Object|undefined)
    write: ({ container }) => container && { container },
    read:  ({ container }) => container && { container },

    // Replace any container properties in protoTabs with cookieStoreId.
    //@ ([Object], Object), state -> state
    async restore(protoTabs, window) {
        if (window.incognito || !browser.contextualIdentities) {
            // If private window or container feature disabled, forget container properties
            for (const protoTab of protoTabs)
                delete protoTab.container;
            return;
        }

        // Find container names among protoTabs to build Map(containerName: protoTabArray)
        const containerNameTabMap = new GroupMap();
        for (const protoTab of protoTabs) if (protoTab.container) {
            containerNameTabMap.group(protoTab.container, protoTab);
            delete protoTab.container;
        }
        if (!containerNameTabMap.size)
            return;

        // Get cookieStoreIds to build {containerName: cookieStoreIds} dict
        // Create new containers if needed
        const containerNameIdDict = Object.fromEntries(
            (await Promise.all(
                [...containerNameTabMap.keys()].map(Containers._getNameIdPair)
            )).filter(Boolean)
        );

        // Assign cookieStoreId to protoTabs
        for (const [containerName, protoTabs] of containerNameTabMap.entries()) {
            const cookieStoreId = containerNameIdDict[containerName];
            for (const protoTab of protoTabs)
                protoTab.cookieStoreId = cookieStoreId;
        }
    },

    // Find container of the given id and return [id, name] if found.
    //@ (String), state -> ([String, String]|undefined)
    async _getIdNamePair(id) {
        try {
            const container = await browser.contextualIdentities.get(id);
            if (container)
                return [id, container.name];
        } catch {}
    },

    // Find container matching the given name, creating one if not found, and return [name, id].
    //@ (String), state -> ([String, String]|undefined), state|nil
    async _getNameIdPair(name) {
        try {
            const container =
                (await browser.contextualIdentities.query({ name }))[0] ||
                await browser.contextualIdentities.create({ name, color: 'toolbar', icon: 'circle' });
            if (container)
                return [name, container.cookieStoreId];
        } catch {}
    },

}

const Parents = {

    // Mark tabs that are parents of other tabs with the isParent=true property.
    // Remove references to any parents that are not in the list of tabs.
    //@ ([Object]) -> state
    prepare(tabs) {
        const tabMap = new Map();
        for (const tab of tabs)
            tabMap.set(tab.id, tab);
        for (const tab of tabs) {
            const parentTab = tabMap.get(tab.openerTabId);
            if (parentTab)
                parentTab.isParent = true;
            else
                delete tab.openerTabId;
        }
    },

    // Produce tab id and parentId properties to later stringify.
    //@ (Object, String) -> (Object)
    write({ id, openerTabId, isParent }, folderId) {
        const props = {};
        if (isParent)
            props.id = folderId + id;
        if (openerTabId)
            props.parentId = folderId + openerTabId;
        return props;
    },

    // Produce stashId and stashParentId properties from parsed.
    //@ (Object) -> (Object)
    read({ id, parentId }) {
        const protoTab = {};
        if (id)
            protoTab.stashId = id;
        if (parentId)
            protoTab.stashParentId = parentId;
        return protoTab;
    },

    // Return shallow copy of protoTab sans stashId and stashParentId properties.
    //@ (Object) -> (Object)
    scrub(protoTab) {
        const safeProtoTab = { ...protoTab };
        delete safeProtoTab.stashId;
        delete safeProtoTab.stashParentId;
        return safeProtoTab;
    },

    // Restore tabs' openerTabId property based on parent-child relationships encoded in protoTabs.
    //@ ([Object], [Object]) -> state
    restore(protoTabs, tabs) {
        const tabMap = new Map();
        // protoTabs.length == tabs.length == tabMap.size
        // Map keys are id by default, or stashId if available; Map values are { id always, stashParentId optional }
        protoTabs.forEach(({ stashId, stashParentId }, index) => {
            const id = tabs[index].id;
            tabMap.set(stashId || id, { id, stashParentId });
        });
        for (const { id, stashParentId } of tabMap.values()) if (stashParentId) {
            const openerTabId = tabMap.get(stashParentId).id;
            browser.tabs.update(id, { openerTabId });
        }
    },

}

// Find valid JSON string at end of the title, split it off, and parse the JSON.
// Return [cleaned title, result object], or [title, null] if JSON not found or invalid.
//@ (String) -> ([String, Object|null])
function parseTitleJSON(title) {
    title = title.trim();
    if (title.at(-1) !== '}')
        return [title, null];

    // Extract JSON, retry with larger slices upon failure if more curly brackets found
    let parsed;
    let index = Infinity;
    do {
        index = title.lastIndexOf('{', index - 1);
        if (index === -1)
            return [title, null];
        try {
            parsed = JSON.parse(title.slice(index));
        } catch {}
    } while (!parsed);

    title = title.slice(0, index).trim();
    return [title, parsed];
}

export const Window = {

    /* Stashing */

    // Produce a bookmark folder title that encodes window properties. Title may contain both window name and properties, one of them, or neither (empty string).
    //@ (String, Object) -> (String)
    stringify(name, window) {
        const props = Props.write(window, Props.WINDOW);
        const annotation = Object.keys(props).length ?
            JSON.stringify(props) : '';
        return `${name} ${annotation}`.trim();
    },

    /* Unstashing */

    // Produce [cleaned title, protoWindow] from bookmark folder title. A protoWindow is an info object for browser.window.create().
    // If no properties found, return [original title, null].
    //@ (String) -> ([String, Object|null])
    parse(title) {
        const [name, parsed] = parseTitleJSON(title);
        const protoWindow = parsed ?
            Props.read(parsed, Props.WINDOW) : null;
        // browser.window.create() rejects unsupported properties, so return name and protoWindow separately
        return [name, protoWindow];
    },

}

export const Tab = {

    /* Stashing */

    // Add properties to tabs marking containers and parents. To be done before creating bookmarks.
    //@ ([Object]) -> state
    async prepare(tabs) {
        await Containers.prepare(tabs);
        Parents.prepare(tabs);
    },

    // Produce bookmark title that encodes tab properties.
    //@ (Object, String) -> (String)
    stringify(tab, folderId) {
        const props = {
            ...Props.write(tab, Props.TAB),
            ...Containers.write(tab),
            ...Parents.write(tab, folderId),
        };
        const annotation = Object.keys(props).length ?
            JSON.stringify(props) : '';
        return `${tab.title} ${annotation}`.trim();
    },

    /* Unstashing */

    // Produce protoTab from bookmark title if properties found.
    //@ (String) -> (Object)
    parse(title) {
        const [actualTitle, parsed] = parseTitleJSON(title);
        const protoTab = { title: actualTitle };
        if (parsed)
            Object.assign(
                protoTab,
                Props.read(parsed, Props.TAB),
                Containers.read(parsed),
                Parents.read(parsed),
            );
        return protoTab;
    },

    // Tasks before creating tabs.
    //@ ([Object], Object), state -> state
    async preOpen(protoTabs, window) {
        await Containers.restore(protoTabs, window);
    },

    // Return modified copy of protoTab that is safe to create a tab with.
    //@ (Object) -> (Object)
    scrub(protoTab) {
        return Parents.scrub(protoTab);
    },

    // Tasks after creating tabs.
    //@ ([Object], [Object]) -> state
    postOpen(protoTabs, tabs) {
        Parents.restore(protoTabs, tabs);
    },

}

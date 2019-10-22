'use strict';

var BrowserOp = {

    modifier: {
        sendTab: 'Shift', // moveTabs
        bringTab: 'Ctrl', // moveTabs + focusWindow
    },

    async respond(windowId, modifiers, sendTabsByDefault, tabObjects) {
        if (modifiers.includes(this.modifier.bringTab)) {
            await this.moveTabs(tabObjects, windowId, true, true);
            this.focusWindow(windowId);
        }
        else
        if (modifiers.includes(this.modifier.sendTab) || sendTabsByDefault) {
            this.moveTabs(tabObjects, windowId);
        }
        else
        {
            this.focusWindow(windowId);
        }
    },

    focusWindow(windowId) {
        browser.windows.update(windowId, { focused: true });
    },

    async moveTabs(tabObjects, windowId, stayActive, staySelected) {
        tabObjects = tabObjects && tabObjects.length ? tabObjects : await this.getSelectedTabs();
        const tabIds = tabObjects.map(tab => tab.id);
        await browser.tabs.move(tabIds, { windowId, index: -1 });
        if (stayActive) {
            const activeTab = tabObjects.find(tab => tab.active);
            if (activeTab) browser.tabs.update(activeTab.id, { active: true });
        }
        if (staySelected) {
            for (const tabId of tabIds) {
                browser.tabs.update(tabId, { highlighted: true, active: false });
            }
        }
    },

    async getSelectedTabs() {
        return await browser.tabs.query({ currentWindow: true, highlighted: true });
    },

    updateWindowBadge(windowId) {
        const data = Metadata[windowId];
        browser.browserAction.setBadgeText({ windowId, text: `${data.tabCount}` });
        browser.browserAction.setBadgeTextColor({ windowId, color: data.textColor });
        browser.browserAction.setBadgeBackgroundColor({ windowId, color: data.backColor });
    },

}

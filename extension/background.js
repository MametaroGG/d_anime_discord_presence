let playing_uuid = "";
let uuid_list = []; // {uuid, playing, tabId}

let isNativeConnected = false;
let port = {};
let lastNativePayload = null;

function assertNative() {
    if (isNativeConnected) return;

    if (port && port.disconnect) {
        try { port.disconnect(); } catch (_) {}
    }
    port = chrome.runtime.connectNative("com.danime.discord.presence.plus");
    isNativeConnected = true;
    port.onDisconnect.addListener(() => {
        if (chrome.runtime.lastError) {
            console.log("native connect error", chrome.runtime.lastError);
        }
        console.log("Native host disconnect");
        isNativeConnected = false;
    });

    if (lastNativePayload) {
        const payload = lastNativePayload;
        setTimeout(() => {
            if (!isNativeConnected) return;
            try {
                port.postMessage(payload);
                console.log("Re-pushed after reconnect");
            } catch (err) {
                console.log("Re-push failed", err);
            }
        }, 200);
    }
}

function postNative(payload) {
    assertNative();
    if (!isNativeConnected) return;
    lastNativePayload = payload;
    try {
        port.postMessage(payload);
    } catch (err) {
        console.log("postNative failed", err);
        isNativeConnected = false;
    }
}

function disconnectNative(reason) {
    console.log("disconnectNative:", reason);
    // Real tab close only. Host clears Discord on message_type 5.
    if (isNativeConnected) {
        try {
            port.postMessage({
                message_type: "5",
                title: "",
                episodes: "",
                subtitle: "",
                current_time: "",
                total_duration: "",
                thumbnail: "",
                work_url: "",
                part_url: "",
                paused: false,
            });
            port.disconnect();
        } catch (_) {}
    }
    isNativeConnected = false;
    lastNativePayload = null;
    playing_uuid = "";
}

function ensureEntry(uuid, tabId) {
    let el = uuid_list.find((e) => e.uuid === uuid);
    if (!el) {
        el = { uuid, playing: true, tabId: tabId != null ? tabId : null };
        uuid_list.unshift(el);
    } else {
        el.playing = true;
        if (tabId != null) el.tabId = tabId;
    }
    playing_uuid = el.uuid;
    return el;
}

function sendPresence(data, tabId) {
    ensureEntry(data.uuid, tabId);
    assertNative();
    if (!isNativeConnected) return;
    if (data.uuid !== playing_uuid) return;
    if (data.is_displayed) return;

    data.data.message_type = "3";
    postNative(data.data);
}

function heartbeat(uuid, tabId) {
    ensureEntry(uuid, tabId);
    assertNative();
}

function removeByUuid(uuid, reason) {
    console.log("removeByUuid", uuid, reason);
    uuid_list = uuid_list.filter((e) => e.uuid !== uuid);
    if (playing_uuid === uuid) playing_uuid = "";
    if (uuid_list.length === 0) {
        disconnectNative("no tabs left after " + reason);
        return;
    }
    const next = uuid_list.find((e) => e.playing) || uuid_list[0];
    if (next) {
        next.playing = true;
        playing_uuid = next.uuid;
        if (lastNativePayload) postNative(lastNativePayload);
    }
}

chrome.tabs.onRemoved.addListener((tabId) => {
    const victims = uuid_list.filter((e) => e.tabId === tabId);
    for (const v of victims) {
        removeByUuid(v.uuid, "tabs.onRemoved:" + tabId);
    }
});

chrome.runtime.onMessage.addListener((data, sender) => {
    const tabId = sender.tab ? sender.tab.id : null;
    console.log("msg", data && data.type, "tab", tabId);

    switch (data.type) {
        case 1:
            ensureEntry(data.uuid, tabId);
            break;
        case 2:
            ensureEntry(data.uuid, tabId);
            assertNative();
            break;
        case 3:
            sendPresence(data, tabId);
            break;
        case 4:
            // Never clear on this legacy signal (old builds used it for pause).
            console.log("ignore legacy clear/stop");
            heartbeat(data.uuid, tabId);
            if (lastNativePayload) {
                postNative({ ...lastNativePayload, paused: true, message_type: "3" });
            }
            break;
        case 5:
            // Ignore unload signals from the page (false positives on pause).
            console.log("ignore page unload signal");
            heartbeat(data.uuid, tabId);
            break;
        case 6:
            heartbeat(data.uuid, tabId);
            break;
        default:
            break;
    }
    return true;
});

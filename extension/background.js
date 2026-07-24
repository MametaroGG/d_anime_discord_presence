let playing_uuid = "";
let uuid_list = new Array(); // {uuid: str, playing: bool}

let isNativeConnected = false;
let port = {};

// connect to native host
function assertNative() {
    if (!isNativeConnected) {
        if (port.disconnect) port.disconnect();
        port = chrome.runtime.connectNative("com.danime.discord.presence.plus");
        isNativeConnected = true;
        port.onDisconnect.addListener(() => {
            if (chrome.runtime.lastError) {
                isNativeConnected = false;
                console.log("Couldn't connect to native app");
                console.log(chrome.runtime.lastError);
            }
            console.log("Disconnect")
        })
    }
}

// update playing_uuid
function update_playing_uuid() {
    if (uuid_list.length === 0) {
        console.log("disconnect");
        port.postMessage({
            message_type: "5",
            title: "",
            episodes: "",
            subtitle: "",
            current_time: "",
            total_duration: "",
            thumbnail: "",
        });
        port.disconnect();
        isNativeConnected = false;
        return;
    }
    playing_element = uuid_list.find((element) => { return element.playing; });
    if (playing_element === undefined) {
        console.log("clear presence");
        port.postMessage({
            message_type: "4",
            title: "",
            episodes: "",
            subtitle: "",
            current_time: "",
            total_duration: "",
            thumbnail: "",
        });
        playing_uuid = "";
        return;
    }
    playing_uuid = playing_element.uuid;
    console.log(playing_uuid);
}

// add uuid to uuid_list
function add(data) {
    uuid_list.unshift({
        "uuid": data.uuid,
        "playing": false,
    });
}

// playing to true
function started(data) {
    uuid_element = uuid_list.find((element) => { return element.uuid === data.uuid; });
    uuid_element.playing = true;
    playing_uuid = uuid_element.uuid;
}

// send to native host
function send(data) {
    if (!isNativeConnected) assertNative();
    if (isNativeConnected && data.uuid === playing_uuid && !data.is_displayed) {
        data.data.message_type = "3";
        port.postMessage(data.data);
    }
}

// playing to false
function stoped(data) {
    uuid_element = uuid_list.find((element) => { return element.uuid === data.uuid; });
    uuid_element.playing = false;
    update_playing_uuid();
}

// remove from uuid_list
function remove(data) {
    uuid_list = uuid_list.filter((element) => { return element.uuid !== data.uuid; });
    update_playing_uuid();
}

// error assertion
function error(data) {
    console.log("Error occured in" + data.uuid);
}

chrome.runtime.onMessage.addListener((data) => {
    console.log("get message");
    console.log(data);
    switch(data.type) {
        case 0:
            error(data);
            break;
        case 1:
            add(data);
            break;
        case 2:
            started(data);
            break;
        case 3:
            send(data);
            break;
        case 4:
            stoped(data);
            break;
        case 5:
            remove(data);
            break;
        default:
            error(data);
            break;
    }
    return true;
})
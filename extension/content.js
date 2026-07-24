const GETINFO_INTERVAL = 500;

const TITLE_CLASS_NAME = "pauseInfoTxt1";
const EPISODES_CLASS_NAME = "pauseInfoTxt2";
const SUBTITLE_CLASS_NAME = "pauseInfoTxt3";
const TIME_CLASS_NAME = "time";
const TIME_ID_NAME = "#time";
const VIDEO_TAG_NAME = "video";

const TYPE_STOPPED = 0;
const TYPE_PLAYING = 1;
let type_now = TYPE_STOPPED;

let is_displayed = false;
let prev_time = null;
let showThumbnail = true;

// generateUUID
const UUID = crypto.randomUUID()

chrome.storage.sync.get({ showThumbnail: true }, (stored) => {
    showThumbnail = Boolean(stored.showThumbnail);
});
chrome.storage.onChanged.addListener((changes, area) => {
    if (area === "sync" && changes.showThumbnail) {
        showThumbnail = Boolean(changes.showThumbnail.newValue);
        is_displayed = false;
    }
});

function stripQuery(url) {
    if (!url) return "";
    const q = url.indexOf("?");
    return q >= 0 ? url.slice(0, q) : url;
}

// Discord Rich Presence large image is square-cropped.
// dアニメ CDN art is 16:9, so letterbox to 512x512 via image proxy.
function toSquareThumbnail(url) {
    if (!url || !url.startsWith("http")) return "";
    const clean = stripQuery(url);
    return `https://wsrv.nl/?url=${encodeURIComponent(clean)}&w=512&h=512&fit=contain&cbg=111111`;
}

function thumbnailFromWorkId(workId) {
    if (!workId || !/^\d+$/.test(workId) || workId.length < 5) {
        return "";
    }
    const id1 = workId.slice(0, 2);
    const id2 = workId.slice(2, 4);
    const id3 = workId.slice(4);
    // _1_1 is the largest anime_kv package art (still 16:9)
    return `https://cs1.animestore.docomo.ne.jp/anime_kv/img/${id1}/${id2}/${id3}/${workId}_1_1.png`;
}

function getThumbnailUrl() {
    if (!showThumbnail) return "";

    let raw = "";

    const og = document.querySelector('meta[property="og:image"]');
    if (og && og.content && og.content.startsWith("http")) {
        raw = stripQuery(og.content);
    }

    if (!raw) {
        const video = document.getElementsByTagName(VIDEO_TAG_NAME)[0];
        if (video && video.poster && video.poster.startsWith("http")) {
            raw = stripQuery(video.poster);
        }
    }

    if (!raw) {
        const params = new URLSearchParams(location.search);
        const workIdParam = params.get("workId");
        if (workIdParam) {
            raw = thumbnailFromWorkId(workIdParam);
        } else {
            const partId = params.get("partId");
            if (partId && partId.length > 3) {
                // partId is typically workId + 3-digit episode suffix
                raw = thumbnailFromWorkId(partId.slice(0, -3));
            }
        }
    }

    return toSquareThumbnail(raw);
}

function getInfo() {
    let data = new Object();
    data.uuid = UUID;
    data.data = new Object();

    // playing?
    const videoElement = document.getElementsByTagName(VIDEO_TAG_NAME)[0];
    if (!videoElement) {
        console.log("Couldn't get playing status");
        data.type = 0;
        return data;
    } else {
        let playing = !Boolean(videoElement.paused);
        if (type_now === TYPE_STOPPED && playing) {
            type_now = TYPE_PLAYING;
            data.type = 2;
            return data;
        } else if (type_now === TYPE_PLAYING && !playing) {
            type_now = TYPE_STOPPED;
            data.type = 4;
            is_displayed = false;
            return data;
        } else if (type_now === TYPE_STOPPED && !playing) {
            return null;
        }
    }
    
    // title, episode, subtitle, time
    data.type = 3;
    const titleElement = document.getElementsByClassName(TITLE_CLASS_NAME)[0];
    const episodeElement = document.getElementsByClassName(EPISODES_CLASS_NAME)[0];
    const subtitleElement = document.getElementsByClassName(SUBTITLE_CLASS_NAME)[0];
    const timeElement = document.getElementsByClassName(TIME_CLASS_NAME)[0];
    if (!titleElement || !episodeElement || !timeElement) {
        console.log("Couldn't get title or eipsodes or time");
    } else {
        const title = titleElement.textContent.trim();
        const episodes = episodeElement.textContent.trim();
        const subtitle = subtitleElement ? subtitleElement.textContent.trim() : "";
        const time = timeElement.querySelector(TIME_ID_NAME).textContent;
        const time_splited = time.split(" / ");
        if (time_splited[0].split(":").length === 2) {
            time_splited[0] = "00:" + time_splited[0];
        }

        data.is_displayed = is_displayed;
        data.data.title = title;
        data.data.episodes = episodes;
        data.data.subtitle = subtitle;
        data.data.current_time = time_splited[0];
        data.data.total_duration = time_splited[1];
        data.data.thumbnail = getThumbnailUrl();

        if (!prev_time) {
            is_displayed = true;
        } else {
            [hours, minutes, seconds] = prev_time.split(":").map(Number);
            prev_sec = hours * 3600 + minutes * 60 + seconds;
            [hours, minutes, seconds] = data.data.current_time.split(":").map(Number);
            now_sec = hours * 3600 + minutes * 60 + seconds;
            if (Math.abs(now_sec - prev_sec) > 3) {
                is_displayed = false;
            } else {
                is_displayed = true;
            }
        }
        prev_time = data.data.current_time;
    }
    
    return data;
}

// send message to background
const sendMessage = () => {
    let data = getInfo();
    if (!data) {
        console.log("here");
        return; 
    }
    chrome.runtime.sendMessage(data, (response) => true);
}

// sendMessage per 1 second
setInterval(sendMessage, GETINFO_INTERVAL);

// register to background.js
window.addEventListener("load", () => {
    chrome.runtime.sendMessage({
        "type": 1,
        "uuid": UUID,
    }, (response) => true);
})

// remove from background.js
window.addEventListener("beforeunload", () => {
    chrome.runtime.sendMessage({
        "type": 5,
        "uuid": UUID,
    }, (response) => true);
});

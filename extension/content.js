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
let prev_work_url = "";
let prev_part_url = "";
let last_force_send_at = 0;
let showThumbnail = true;
/** @type {null | {
 *  title: string, episodes: string, subtitle: string,
 *  current_time: string, total_duration: string, thumbnail: string,
 *  work_url: string, part_url: string
 * }} */
let lastPresence = null;
let videoHooked = null;

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

function extractWorkIdFromThumbnailUrl(url) {
    if (!url) return "";
    // .../anime_kv/img/20/15/1/20151_1_1.png or encoded inside wsrv.nl
    const decoded = (() => {
        try {
            return decodeURIComponent(url);
        } catch {
            return url;
        }
    })();
    const m = decoded.match(/\/(?:anime_kv\/img\/\d+\/\d+\/\d+\/)?(\d{5,})_\d/);
    return m ? m[1] : "";
}

function episodeNumberFromText(episodes) {
    if (!episodes) return "";
    const m = episodes.match(/第\s*(\d+)\s*話/);
    if (m) return m[1];
    const m2 = episodes.match(/(\d+)\s*話/);
    return m2 ? m2[1] : "";
}

function findIdInPage(name) {
    const re = new RegExp(`[?&#"']${name}=(\\d+)`, "i");
    const sources = [
        location.href,
        document.documentElement?.innerHTML?.slice(0, 200000) || "",
    ];
    try {
        for (let i = 0; i < sessionStorage.length; i++) {
            sources.push(String(sessionStorage.getItem(sessionStorage.key(i)) || ""));
        }
    } catch (_) {}
    try {
        for (let i = 0; i < localStorage.length; i++) {
            sources.push(String(localStorage.getItem(localStorage.key(i)) || ""));
        }
    } catch (_) {}
    for (const src of sources) {
        const m = src.match(re);
        if (m) return m[1];
    }
    return "";
}

function getWorkAndPartIds(episodesText) {
    const params = new URLSearchParams(location.search);
    let partId = params.get("partId") || "";
    let workId = params.get("workId") || "";

    if (!partId || !workId) {
        const href = location.href;
        const partMatch = href.match(/[?&#]partId=(\d+)/i);
        const workMatch = href.match(/[?&#]workId=(\d+)/i);
        if (!partId && partMatch) partId = partMatch[1];
        if (!workId && workMatch) workId = workMatch[1];
    }

    if (!partId) partId = findIdInPage("partId");
    if (!workId) workId = findIdInPage("workId");

    if (!workId) {
        const og = document.querySelector('meta[property="og:image"]');
        workId = extractWorkIdFromThumbnailUrl(og?.content || "");
    }
    if (!workId) {
        const video = document.getElementsByTagName(VIDEO_TAG_NAME)[0];
        workId = extractWorkIdFromThumbnailUrl(video?.poster || "");
    }

    if (!workId && partId.length > 3 && /^\d+$/.test(partId)) {
        // partId is typically workId + 3-digit episode suffix (e.g. 20151016 -> 20151)
        workId = partId.slice(0, -3);
    }

    // Last resort: build partId from workId + 「第N話」
    if (workId && !partId) {
        const ep = episodeNumberFromText(episodesText || "");
        if (ep) {
            partId = workId + String(ep).padStart(3, "0");
        }
    }

    return { workId, partId };
}

function normalizeTime(timeStr) {
    if (!timeStr) return "";
    const trimmed = timeStr.trim();
    if (trimmed.split(":").length === 2) {
        return "00:" + trimmed;
    }
    return trimmed;
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
        const { workId } = getWorkAndPartIds("");
        if (workId) {
            raw = thumbnailFromWorkId(workId);
        }
    }

    return toSquareThumbnail(raw);
}

function buildPausedPayload() {
    if (!lastPresence || !lastPresence.title) {
        return null;
    }
    return {
        type: 3,
        uuid: UUID,
        is_displayed: false,
        data: {
            ...lastPresence,
            paused: true,
        },
    };
}

function hookVideoEvents(video) {
    if (!video || video === videoHooked) return;
    videoHooked = video;
    video.addEventListener("pause", () => {
        if (type_now !== TYPE_PLAYING) return;
        type_now = TYPE_STOPPED;
        is_displayed = true;
        const payload = buildPausedPayload();
        if (payload) {
            console.log("[d-anime-presence] pause event → keep presence");
            chrome.runtime.sendMessage(payload, () => true);
        }
    });
    video.addEventListener("play", () => {
        if (type_now === TYPE_STOPPED) {
            type_now = TYPE_PLAYING;
            is_displayed = false;
            chrome.runtime.sendMessage({ type: 2, uuid: UUID }, () => true);
        }
    });
}

function getInfo() {
    let data = new Object();
    data.uuid = UUID;
    data.data = new Object();

    let justPaused = false;

    const videoElement = document.getElementsByTagName(VIDEO_TAG_NAME)[0];
    if (!videoElement) {
        // Do not clear on missing video; tab close handles clear via type 5.
        // Keep heartbeat if we still have a paused session.
        if (type_now === TYPE_STOPPED && lastPresence) {
            return { type: 6, uuid: UUID };
        }
        console.log("Couldn't get playing status");
        return null;
    }

    hookVideoEvents(videoElement);

    const playing = !Boolean(videoElement.paused);
    if (type_now === TYPE_STOPPED && playing) {
        type_now = TYPE_PLAYING;
        is_displayed = false;
        data.type = 2;
        return data;
    } else if (type_now === TYPE_PLAYING && !playing) {
        type_now = TYPE_STOPPED;
        justPaused = true;
    } else if (type_now === TYPE_STOPPED && !playing) {
        // Keep SW + native host alive; otherwise host exits and clears Discord.
        const nowMs = Date.now();
        // Refresh paused presence often so Discord's progress bar stays anchored.
        if (lastPresence && nowMs - last_force_send_at > 8000) {
            last_force_send_at = nowMs;
            return buildPausedPayload() || { type: 6, uuid: UUID };
        }
        return { type: 6, uuid: UUID };
    }

    data.type = 3;
    const titleElement = document.getElementsByClassName(TITLE_CLASS_NAME)[0];
    const episodeElement = document.getElementsByClassName(EPISODES_CLASS_NAME)[0];
    const subtitleElement = document.getElementsByClassName(SUBTITLE_CLASS_NAME)[0];
    const timeElement = document.getElementsByClassName(TIME_CLASS_NAME)[0];

    if (!titleElement || !episodeElement || !timeElement) {
        console.log("Couldn't get title or eipsodes or time");
        if (justPaused) {
            return buildPausedPayload();
        }
        return null;
    }

    const title = titleElement.textContent.trim();
    const episodes = episodeElement.textContent.trim();
    const subtitle = subtitleElement ? subtitleElement.textContent.trim() : "";
    const timeNode = timeElement.querySelector(TIME_ID_NAME);
    if (!timeNode) {
        if (justPaused) return buildPausedPayload();
        return null;
    }
    const time = timeNode.textContent;
    const time_splited = time.split(" / ");
    const currentTime = normalizeTime(time_splited[0]);
    const totalDuration = normalizeTime(time_splited[1] || "");
    const { workId, partId } = getWorkAndPartIds(episodes);

    data.data.title = title;
    data.data.episodes = episodes;
    data.data.subtitle = subtitle;
    data.data.current_time = currentTime;
    data.data.total_duration = totalDuration;
    data.data.thumbnail = getThumbnailUrl();
    data.data.paused = Boolean(videoElement.paused) || justPaused;
    data.data.work_url = workId
        ? `https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${workId}`
        : (lastPresence?.work_url || "");
    data.data.part_url = partId
        ? (workId
            ? `https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${workId}&partId=${partId}`
            : `https://animestore.docomo.ne.jp/animestore/ci_pc?partId=${partId}`)
        : (lastPresence?.part_url || "");

    if (title) {
        lastPresence = {
            title: data.data.title,
            episodes: data.data.episodes,
            subtitle: data.data.subtitle,
            current_time: data.data.current_time,
            total_duration: data.data.total_duration,
            thumbnail: data.data.thumbnail,
            work_url: data.data.work_url,
            part_url: data.data.part_url,
        };
    } else if (justPaused) {
        return buildPausedPayload();
    }

    console.log("[d-anime-presence] ids", {
        href: location.href,
        workId,
        partId,
        paused: data.data.paused,
        work_url: data.data.work_url,
        part_url: data.data.part_url,
    });

    const urlsChanged =
        data.data.work_url !== prev_work_url || data.data.part_url !== prev_part_url;
    const nowMs = Date.now();
    const forcePeriodic = !data.data.paused && nowMs - last_force_send_at > 15000;

    if (justPaused || !prev_time || !is_displayed || urlsChanged || forcePeriodic) {
        data.is_displayed = false;
        is_displayed = true;
        last_force_send_at = nowMs;
    } else {
        const [ph, pm, ps] = prev_time.split(":").map(Number);
        const prev_sec = ph * 3600 + pm * 60 + ps;
        const [nh, nm, ns] = data.data.current_time.split(":").map(Number);
        const now_sec = nh * 3600 + nm * 60 + ns;
        if (Math.abs(now_sec - prev_sec) > 3) {
            data.is_displayed = false;
            is_displayed = true;
            last_force_send_at = nowMs;
        } else {
            data.is_displayed = true;
        }
    }
    prev_time = data.data.current_time;
    prev_work_url = data.data.work_url;
    prev_part_url = data.data.part_url;

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
    chrome.runtime.sendMessage({ type: 1, uuid: UUID }, () => true);
});

// Do NOT clear on beforeunload/pagehide — dアニメ pause UI triggers them.
// Tab close is detected in background via chrome.tabs.onRemoved.

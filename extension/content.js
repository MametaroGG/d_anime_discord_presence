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
let prev_thumbnail = "";
let last_force_send_at = 0;
let seekPending = false;
let showThumbnail = true;
/** @type {Map<string, string>} */
const thumbnailCache = new Map();
/** @type {Set<string>} */
const thumbnailFetchInFlight = new Set();
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

function workIdFromPartId(partId) {
    if (!partId || !/^\d+$/.test(partId) || partId.length <= 3) return "";
    // partId is typically workId + 3-digit episode suffix (e.g. 20151017 -> 20151)
    return partId.slice(0, -3);
}

function idsConsistent(workId, partId) {
    return Boolean(workId && partId && partId.startsWith(workId) && partId.length > workId.length);
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

    // Prefer partId from page; never trust a random workId that conflicts with partId.
    if (!partId) partId = findIdInPage("partId");

    const derivedFromPart = workIdFromPartId(partId);
    if (derivedFromPart) {
        if (!workId || !idsConsistent(workId, partId)) {
            workId = derivedFromPart;
        }
    }

    if (!workId) {
        const og = document.querySelector('meta[property="og:image"]');
        workId = extractWorkIdFromThumbnailUrl(og?.content || "");
    }
    if (!workId) {
        const video = document.getElementsByTagName(VIDEO_TAG_NAME)[0];
        workId = extractWorkIdFromThumbnailUrl(video?.poster || "");
    }
    // Page HTML often contains related-work workIds; use only as last resort.
    if (!workId) workId = findIdInPage("workId");

    // Last resort: build partId from workId + 「第N話」
    if (workId && !partId) {
        const ep = episodeNumberFromText(episodesText || "");
        if (ep) {
            partId = workId + String(ep).padStart(3, "0");
        }
    }

    // Final consistency check: partId wins for the episode being watched.
    if (partId && workId && !idsConsistent(workId, partId)) {
        const fixed = workIdFromPartId(partId);
        if (fixed) workId = fixed;
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

function formatHms(totalSeconds) {
    const s = Math.max(0, Math.floor(Number(totalSeconds) || 0));
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return [
        String(h).padStart(2, "0"),
        String(m).padStart(2, "0"),
        String(sec).padStart(2, "0"),
    ].join(":");
}

function timeFromVideo(video) {
    if (!video || !Number.isFinite(video.currentTime)) return null;
    const current = formatHms(video.currentTime);
    const total =
        Number.isFinite(video.duration) && video.duration > 0
            ? formatHms(video.duration)
            : "";
    return { current, total };
}

function timeToSecs(timeStr) {
    if (!timeStr) return 0;
    const parts = timeStr.split(":").map(Number);
    if (parts.length === 3) return parts[0] * 3600 + parts[1] * 60 + parts[2];
    if (parts.length === 2) return parts[0] * 60 + parts[1];
    return 0;
}

function urlHasAssetId(url, id) {
    if (!url || !id) return false;
    // Match /28060002_... or /28060_1_1.png — not 28060 inside 28060003.
    return new RegExp(`(?:^|[/])${id}(?:_|\\.)`).test(url);
}

function isScenePreviewThumb(url) {
    return /\/thumbnails\//i.test(url) || /_\d{4,}\.(?:jpe?g|png|webp)$/i.test(url);
}

function isEpisodePackageArt(url, partId) {
    if (!url || !partId || isScenePreviewThumb(url)) return false;
    // e.g. 28060002_1_2.png — not 28060002_00209.jpg
    return new RegExp(`(?:^|[/])${partId}_1_\\d\\.(?:png|jpe?g|webp)$`, "i").test(url);
}

function isWorkPackageArt(url, workId) {
    if (!url || !workId || isScenePreviewThumb(url)) return false;
    return (
        urlHasAssetId(url, workId) &&
        (/_1_1\.(?:png|jpe?g|webp)$/i.test(url) || /_1_d\d*\.(?:png|jpe?g|webp)$/i.test(url))
    );
}

function findThumbnailInPage(workId, partId) {
    const urls = [];
    const push = (u) => {
        if (!u || typeof u !== "string") return;
        const clean = stripQuery(u.trim());
        if (!clean.startsWith("http")) return;
        if (!/animestore\.docomo\.ne\.jp|anime_kv|\/anime\//i.test(clean)) return;
        if (isScenePreviewThumb(clean)) return;
        if (!urls.includes(clean)) urls.push(clean);
    };

    const og = document.querySelector('meta[property="og:image"]');
    if (og) push(og.content);

    // Do NOT use video.poster — it often becomes a changing scene preview.
    document.querySelectorAll("img[src]").forEach((img) => push(img.currentSrc || img.src));

    if (partId) {
        const epArt = urls.find((u) => isEpisodePackageArt(u, partId));
        if (epArt) return epArt;
    }

    if (workId) {
        const workArt = urls.find((u) => isWorkPackageArt(u, workId));
        if (workArt) return workArt;
    }

    return "";
}

function thumbnailCacheKey(workId, partId) {
    return partId ? `part:${partId}` : workId ? `work:${workId}` : "";
}

function requestWorkPageThumbnail(workId, partId) {
    const key = thumbnailCacheKey(workId, partId);
    if (!workId || !key || thumbnailCache.has(key) || thumbnailFetchInFlight.has(key)) {
        return;
    }
    thumbnailFetchInFlight.add(key);
    fetch(`https://animestore.docomo.ne.jp/animestore/ci_pc?workId=${encodeURIComponent(workId)}`, {
        credentials: "include",
        cache: "force-cache",
    })
        .then((res) => (res.ok ? res.text() : Promise.reject(res.status)))
        .then((html) => {
            let found = null;
            if (partId) {
                const ep = html.match(
                    new RegExp(
                        `https://cs1\\.animestore\\.docomo\\.ne\\.jp/[^"'\\s<>]*/${partId}_1_\\d\\.(?:png|jpe?g|webp)`,
                        "i",
                    ),
                );
                if (ep && !isScenePreviewThumb(ep[0])) found = ep[0];
            }
            if (!found) {
                const work = html.match(
                    new RegExp(
                        `https://cs1\\.animestore\\.docomo\\.ne\\.jp/[^"'\\s<>]*/${workId}_1_1\\.(?:png|jpe?g|webp)`,
                        "i",
                    ),
                );
                if (work && !isScenePreviewThumb(work[0])) found = work[0];
            }
            if (found) {
                thumbnailCache.set(key, stripQuery(found));
                is_displayed = false;
                console.log("[d-anime-presence] cached package thumbnail", key, stripQuery(found));
            }
        })
        .catch((err) => {
            console.log("[d-anime-presence] work thumbnail fetch failed", key, err);
        })
        .finally(() => {
            thumbnailFetchInFlight.delete(key);
        });
}

function getThumbnailUrl(workId, partId) {
    if (!showThumbnail) return "";

    if (!workId && !partId) {
        ({ workId, partId } = getWorkAndPartIds(""));
    }
    const cacheKey = thumbnailCacheKey(workId, partId);

    // Once we have stable package art for this part/work, keep it for the session.
    if (cacheKey && thumbnailCache.has(cacheKey)) {
        return toSquareThumbnail(thumbnailCache.get(cacheKey));
    }

    const fromPage = findThumbnailInPage(workId, partId);
    if (fromPage) {
        if (cacheKey) thumbnailCache.set(cacheKey, fromPage);
        return toSquareThumbnail(fromPage);
    }

    if (workId) {
        requestWorkPageThumbnail(workId, partId);
        const fromId = thumbnailFromWorkId(workId);
        if (fromId) return toSquareThumbnail(fromId);
    }

    return "";
}

function buildPresencePayload({ paused = false, resumed = false, seeked = false } = {}) {
    if (!lastPresence || !lastPresence.title) {
        return null;
    }
    return {
        type: 3,
        uuid: UUID,
        is_displayed: false,
        data: {
            ...lastPresence,
            paused: Boolean(paused),
            resumed: Boolean(resumed) && !paused,
            seeked: Boolean(seeked),
        },
    };
}

function buildPausedPayload() {
    return buildPresencePayload({ paused: true });
}

function buildResumedPayload() {
    return buildPresencePayload({ resumed: true });
}

function syncLastPresenceTimeFromVideo(video) {
    const times = timeFromVideo(video);
    if (!times || !lastPresence) return;
    lastPresence.current_time = times.current;
    if (times.total) lastPresence.total_duration = times.total;
}

function hookVideoEvents(video) {
    if (!video || video === videoHooked) return;
    videoHooked = video;
    video.addEventListener("pause", () => {
        if (type_now !== TYPE_PLAYING) return;
        type_now = TYPE_STOPPED;
        is_displayed = true;
        syncLastPresenceTimeFromVideo(video);
        const payload = buildPausedPayload();
        if (payload) {
            console.log("[d-anime-presence] pause event → keep presence");
            chrome.runtime.sendMessage(payload, () => true);
        }
    });
    video.addEventListener("play", () => {
        if (type_now !== TYPE_STOPPED) return;
        type_now = TYPE_PLAYING;
        is_displayed = false;
        syncLastPresenceTimeFromVideo(video);
        const payload = buildResumedPayload();
        if (payload) {
            console.log("[d-anime-presence] play event → resume presence");
            chrome.runtime.sendMessage(payload, () => true);
        } else {
            chrome.runtime.sendMessage({ type: 2, uuid: UUID }, () => true);
        }
    });
    video.addEventListener("seeked", () => {
        seekPending = true;
        is_displayed = false;
        syncLastPresenceTimeFromVideo(video);
        const payload = buildPresencePayload({
            paused: Boolean(video.paused),
            seeked: true,
        });
        if (payload) {
            console.log("[d-anime-presence] seeked → refresh timestamps", lastPresence?.current_time);
            chrome.runtime.sendMessage(payload, () => true);
            last_force_send_at = Date.now();
        }
    });
}

function getInfo() {
    let data = new Object();
    data.uuid = UUID;
    data.data = new Object();

    let justPaused = false;
    let justResumed = false;

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
        justResumed = true;
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
    // Prefer the video clock — DOM time can lag behind seeks.
    const fromVideo = timeFromVideo(videoElement);
    const currentTime = fromVideo?.current || normalizeTime(time_splited[0]);
    const totalDuration =
        fromVideo?.total || normalizeTime(time_splited[1] || "");
    const { workId, partId } = getWorkAndPartIds(episodes);

    data.data.title = title;
    data.data.episodes = episodes;
    data.data.subtitle = subtitle;
    data.data.current_time = currentTime;
    data.data.total_duration = totalDuration;
    data.data.thumbnail = getThumbnailUrl(workId, partId);
    data.data.paused = Boolean(videoElement.paused) || justPaused;
    data.data.resumed = justResumed && !data.data.paused;
    data.data.seeked = seekPending && !data.data.paused;
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
        thumbnail: data.data.thumbnail,
    });

    const urlsChanged =
        data.data.work_url !== prev_work_url || data.data.part_url !== prev_part_url;
    const thumbnailChanged = data.data.thumbnail !== prev_thumbnail;
    const justSeeked = seekPending;
    seekPending = false;
    const nowMs = Date.now();
    const forcePeriodic = !data.data.paused && nowMs - last_force_send_at > 15000;
    const prevSec = timeToSecs(prev_time);
    const nowSec = timeToSecs(data.data.current_time);
    // Normal playback advances ~0.5s per poll; jumps mean seek / scrub.
    const seekJump = prev_time && Math.abs(nowSec - prevSec) > 1.5;

    if (
        justPaused ||
        justResumed ||
        justSeeked ||
        seekJump ||
        !prev_time ||
        !is_displayed ||
        urlsChanged ||
        thumbnailChanged ||
        forcePeriodic
    ) {
        data.is_displayed = false;
        is_displayed = true;
        last_force_send_at = nowMs;
    } else {
        data.is_displayed = true;
    }
    prev_time = data.data.current_time;
    prev_work_url = data.data.work_url;
    prev_part_url = data.data.part_url;
    prev_thumbnail = data.data.thumbnail;

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

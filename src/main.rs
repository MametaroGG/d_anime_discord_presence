use std::fs;
use std::io::{self, BufReader, Read};
use std::path::PathBuf;

use chrono::{Duration, Local};
use discord_rich_presence::{
    activity::{Activity, ActivityType, Assets, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use serde::{Deserialize, Serialize};
use tracing_subscriber::fmt::writer::BoxMakeWriter;

/// Fallback only for local testing until config.json is set.
const FALLBACK_APP_ID: i64 = 1267357061495128074;
const UPDATE_MESSAGE: &str = "3";
const CLAER_MESSAGE: &str = "4";
const DISCONNECT_MESSAGE: &str = "5";

#[derive(Deserialize, Debug)]
struct AppConfig {
    app_id: i64,
}

#[derive(Deserialize, Serialize, Debug, Clone)]
struct PresenceData {
    message_type: String,
    title: String,
    episodes: String,
    current_time: String,
    total_duration: String,
    #[serde(default)]
    subtitle: String,
    #[serde(default)]
    thumbnail: String,
    #[serde(default)]
    work_url: String,
    #[serde(default)]
    part_url: String,
    #[serde(default)]
    paused: bool,
}

fn install_dir() -> Option<PathBuf> {
    Some(std::env::current_exe().ok()?.parent()?.to_path_buf())
}

fn config_path() -> Option<PathBuf> {
    Some(install_dir()?.join("config.json"))
}

fn debug_log_path() -> Option<PathBuf> {
    Some(install_dir()?.join("last_activity.json"))
}

fn last_playing_path() -> Option<PathBuf> {
    Some(install_dir()?.join("last_playing.json"))
}

fn save_last_playing(data: &PresenceData) {
    let Some(path) = last_playing_path() else {
        return;
    };
    let mut to_save = data.clone();
    to_save.paused = false;
    to_save.message_type = UPDATE_MESSAGE.to_string();
    if let Ok(text) = serde_json::to_string(&to_save) {
        let _ = fs::write(path, text);
    }
}

fn load_last_playing() -> Option<PresenceData> {
    let path = last_playing_path()?;
    let text = fs::read_to_string(path).ok()?;
    serde_json::from_str(&text).ok()
}

fn write_debug_activity(
    data: &PresenceData,
    activity: &Activity<'_>,
    reply: Option<&serde_json::Value>,
) {
    let Some(path) = debug_log_path() else {
        return;
    };
    let body = serde_json::json!({
        "incoming": {
            "title": data.title,
            "episodes": data.episodes,
            "work_url": data.work_url,
            "part_url": data.part_url,
            "thumbnail": data.thumbnail,
            "paused": data.paused,
        },
        "activity": activity,
        "discord_reply": reply,
    });
    if let Err(err) = fs::write(&path, body.to_string()) {
        tracing::warn!(error = ?err, path = %path.display(), "failed to write last_activity.json");
    }
}

fn load_app_id() -> i64 {
    if let Some(path) = config_path() {
        match fs::read_to_string(&path) {
            Ok(text) => match serde_json::from_str::<AppConfig>(&text) {
                Ok(cfg) => {
                    tracing::info!(app_id = cfg.app_id, path = %path.display(), "loaded Discord app id");
                    return cfg.app_id;
                }
                Err(err) => tracing::error!(error = ?err, path = %path.display(), "invalid config.json"),
            },
            Err(err) => tracing::warn!(
                error = ?err,
                path = %path.display(),
                "config.json not found; using fallback app id"
            ),
        }
    }
    FALLBACK_APP_ID
}

fn extract_work_id_from_thumbnail(thumbnail: &str) -> Option<String> {
    let decoded = urlencoding_loose(thumbnail);
    // .../20151_1_1.png (possibly inside wsrv.nl query)
    let re = regex_lite_work_id(&decoded)?;
    Some(re)
}

fn urlencoding_loose(s: &str) -> String {
    // Only decode %XX sequences we care about; fall back to original.
    let mut out = String::with_capacity(s.len());
    let bytes = s.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            let h = || -> Option<u8> {
                let a = (bytes[i + 1] as char).to_digit(16)? as u8;
                let b = (bytes[i + 2] as char).to_digit(16)? as u8;
                Some((a << 4) | b)
            };
            if let Some(c) = h() {
                out.push(c as char);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i] as char);
        i += 1;
    }
    out
}

fn regex_lite_work_id(s: &str) -> Option<String> {
    // Match /20/15/1/20151_1_1 or just 20151_1_1.png
    let bytes = s.as_bytes();
    let key = b"_1_";
    let mut i = 0;
    while i + 8 < bytes.len() {
        if bytes[i..].starts_with(key) || (i > 0 && bytes.get(i..i + 3) == Some(key)) {
            // walk back for digits
        }
        i += 1;
    }
    // Simpler: find "_1_1." or "_1_1.png" preceded by digits
    if let Some(idx) = s.find("_1_1.") {
        let prefix = &s[..idx];
        let digits: String = prefix
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if digits.len() >= 5 {
            return Some(digits);
        }
    }
    if let Some(idx) = s.find("_1_3.") {
        let prefix = &s[..idx];
        let digits: String = prefix
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if digits.len() >= 5 {
            return Some(digits);
        }
    }
    None
}

fn episode_number_from_text(episodes: &str) -> Option<u32> {
    // 第16話 / 第 16 話
    let bytes = episodes.as_bytes();
    let marker = "第".as_bytes();
    if let Some(pos) = episodes.find('第') {
        let rest = &episodes[pos + marker.len()..];
        let num: String = rest.chars().skip_while(|c| c.is_whitespace()).take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(n) = num.parse::<u32>() {
            return Some(n);
        }
    }
    if let Some(pos) = episodes.find('話') {
        let before = &episodes[..pos];
        let num: String = before
            .chars()
            .rev()
            .take_while(|c| c.is_ascii_digit())
            .collect::<String>()
            .chars()
            .rev()
            .collect();
        if let Ok(n) = num.parse::<u32>() {
            return Some(n);
        }
    }
    let _ = bytes;
    None
}

fn work_id_from_part_id(part_id: &str) -> Option<String> {
    if part_id.len() > 3 && part_id.chars().all(|c| c.is_ascii_digit()) {
        Some(part_id[..part_id.len() - 3].to_string())
    } else {
        None
    }
}

fn extract_query_param(url: &str, name: &str) -> Option<String> {
    let key = format!("{name}=");
    url.split(&key)
        .nth(1)
        .map(|s| s.split('&').next().unwrap_or(s).to_string())
        .filter(|s| !s.is_empty())
}

fn enrich_urls(data: &mut PresenceData) {
    let mut work_id = extract_query_param(&data.work_url, "workId")
        .or_else(|| extract_work_id_from_thumbnail(&data.thumbnail));
    let mut part_id = extract_query_param(&data.part_url, "partId");

    // Prefer partId-derived workId when the two disagree (page HTML often
    // contains unrelated workIds that pollute work_url / thumbnail).
    if let Some(pid) = part_id.clone() {
        if let Some(derived) = work_id_from_part_id(&pid) {
            let inconsistent = work_id
                .as_ref()
                .map(|wid| !pid.starts_with(wid.as_str()))
                .unwrap_or(true);
            if inconsistent {
                tracing::info!(
                    old_work_id = ?work_id,
                    derived_work_id = %derived,
                    part_id = %pid,
                    "fixing mismatched workId from partId"
                );
                work_id = Some(derived);
            }
        }
    }

    if let (Some(wid), None) = (work_id.clone(), part_id.clone()) {
        if let Some(ep) = episode_number_from_text(&data.episodes) {
            part_id = Some(format!("{wid}{ep:03}"));
        }
    }

    if let Some(wid) = work_id.clone() {
        data.work_url =
            format!("https://animestore.docomo.ne.jp/animestore/ci_pc?workId={wid}");
        // Keep thumbnail aligned with the resolved work.
        if data.thumbnail.is_empty()
            || extract_work_id_from_thumbnail(&data.thumbnail).as_deref() != Some(wid.as_str())
        {
            if wid.len() >= 5 {
                let id1 = &wid[..2];
                let id2 = &wid[2..4];
                let id3 = &wid[4..];
                let raw = format!(
                    "https://cs1.animestore.docomo.ne.jp/anime_kv/img/{id1}/{id2}/{id3}/{wid}_1_1.png"
                );
                data.thumbnail = format!(
                    "https://wsrv.nl/?url={}&w=512&h=512&fit=contain&cbg=111111",
                    urlencoding_encode(&raw)
                );
            }
        }
    }

    if let (Some(wid), Some(pid)) = (work_id, part_id) {
        data.part_url = format!(
            "https://animestore.docomo.ne.jp/animestore/ci_pc?workId={wid}&partId={pid}"
        );
    }
}

fn urlencoding_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len() * 3);
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'~' => {
                out.push(b as char);
            }
            _ => out.push_str(&format!("%{b:02X}")),
        }
    }
    out
}

fn presence_image(thumbnail: &str) -> &str {
    if thumbnail.starts_with("https://") || thumbnail.starts_with("http://") {
        thumbnail
    } else {
        "presence_icon"
    }
}

/// Small overlay icons (bottom-right of large image).
fn playback_small_image(paused: bool) -> &'static str {
    if paused {
        "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/23f8.png"
    } else {
        "https://cdn.jsdelivr.net/gh/twitter/twemoji@14.0.2/assets/72x72/25b6.png"
    }
}

fn format_state(episodes: &str, subtitle: &str) -> String {
    if subtitle.is_empty() {
        episodes.to_string()
    } else {
        format!("{episodes}「{subtitle}」")
    }
}

/// Build start/end so the Watching progress bar sits at `current` / `total`.
/// Re-send periodically while paused to keep the bar from drifting.
fn progress_timestamps(current_time: &str, total_duration: &str) -> Timestamps {
    let current = parse_time_string(current_time);
    let total = parse_time_string(total_duration);
    let start_ts = (Local::now() - current).timestamp();
    let mut timestamps = Timestamps::new().start(start_ts);
    if total > Duration::zero() && total >= current {
        timestamps = timestamps.end((Local::now() + (total - current)).timestamp());
    }
    timestamps
}

fn parse_time_string(time_str: &str) -> Duration {
    let parts: Vec<&str> = time_str.split(':').collect();
    let (hours, minutes, seconds) = match parts.len() {
        3 => (
            parts[0].parse::<i64>().unwrap_or(0),
            parts[1].parse::<i64>().unwrap_or(0),
            parts[2].parse::<i64>().unwrap_or(0),
        ),
        2 => (
            0,
            parts[0].parse::<i64>().unwrap_or(0),
            parts[1].parse::<i64>().unwrap_or(0),
        ),
        _ => (0, 0, 0),
    };
    Duration::seconds(hours * 3600 + minutes * 60 + seconds)
}

fn connect_discord(app_id: i64) -> DiscordIpcClient {
    let mut client = DiscordIpcClient::new(app_id.to_string());
    loop {
        match client.connect() {
            Ok(()) => {
                tracing::info!("connected to Discord IPC");
                break;
            }
            Err(err) => {
                tracing::warn!(error = ?err, "Discord IPC connect failed; retrying...");
                std::thread::sleep(std::time::Duration::from_secs(2));
            }
        }
    }
    client
}

fn time_to_secs(time_str: &str) -> i64 {
    parse_time_string(time_str).num_seconds()
}

fn build_activity<'a>(data: &'a PresenceData) -> Activity<'a> {
    let image = presence_image(&data.thumbnail);
    let episode_line = format_state(&data.episodes, &data.subtitle);

    let assets = Assets::new()
        .large_image(image)
        .large_text(if data.paused {
            "一時停止中"
        } else if data.title.is_empty() {
            "Watching anime"
        } else {
            data.title.as_str()
        })
        .small_image(playback_small_image(data.paused))
        .small_text(if data.paused {
            "一時停止中"
        } else {
            "再生中"
        });

    let mut activity = if data.paused {
        // No timestamps while paused: sequence bar stays off.
        // (Discord may still show elapsed-since-update; that is unavoidable.)
        Activity::new()
            .activity_type(ActivityType::Watching)
            .details("【一時停止中】")
            .state(if data.title.is_empty() {
                episode_line
            } else if episode_line.is_empty() {
                data.title.clone()
            } else {
                format!("{} - {}", data.title, episode_line)
            })
            .assets(assets)
    } else {
        Activity::new()
            .activity_type(ActivityType::Watching)
            .details(data.title.as_str())
            .state(episode_line)
            .assets(assets)
            .timestamps(progress_timestamps(
                &data.current_time,
                &data.total_duration,
            ))
    };

    let mut buttons = Vec::new();
    if !data.work_url.is_empty() {
        buttons.push(Button::new("作品ページ", data.work_url.as_str()));
    }
    if !data.part_url.is_empty() {
        buttons.push(Button::new("この話を視聴", data.part_url.as_str()));
    }
    tracing::info!(
        button_count = buttons.len(),
        paused = data.paused,
        work_url = %data.work_url,
        part_url = %data.part_url,
        "activity buttons"
    );
    if !buttons.is_empty() {
        activity = activity.buttons(buttons);
    }

    activity
}

fn apply_presence(
    client: &mut DiscordIpcClient,
    app_id: i64,
    mut data: PresenceData,
) {
    enrich_urls(&mut data);
    if data.title.trim().is_empty() {
        tracing::warn!("skipping SET_ACTIVITY with empty title");
        return;
    }
    tracing::info!(
        title = %data.title,
        paused = data.paused,
        work_url = %data.work_url,
        part_url = %data.part_url,
        "updating activity"
    );
    let activity = build_activity(&data);
    write_debug_activity(&data, &activity, None);
    match client.set_activity(activity) {
        Ok(()) => match client.recv() {
            Ok((_op, reply)) => {
                if reply.get("evt").and_then(|v| v.as_str()) == Some("ERROR") {
                    tracing::error!(reply = %reply, "Discord rejected SET_ACTIVITY");
                }
                let again = build_activity(&data);
                write_debug_activity(&data, &again, Some(&reply));
            }
            Err(err) => tracing::warn!(error = ?err, "failed to read Discord reply"),
        },
        Err(err) => {
            tracing::warn!(error = ?err, "set_activity failed; reconnecting");
            *client = connect_discord(app_id);
            let again = build_activity(&data);
            write_debug_activity(&data, &again, None);
            if let Err(err) = client.set_activity(again) {
                tracing::error!(error = ?err, "set_activity failed after reconnect");
            } else if let Ok((_op, reply)) = client.recv() {
                let again = build_activity(&data);
                write_debug_activity(&data, &again, Some(&reply));
            }
        }
    }
}

fn main() {
    tracing_subscriber::fmt()
        .compact()
        .with_max_level(tracing::Level::INFO)
        .with_writer(BoxMakeWriter::new(std::io::stderr))
        .init();

    let app_id = load_app_id();
    let mut client = connect_discord(app_id);
    let mut clear_on_exit = false;
    let mut last_playing: Option<PresenceData> = load_last_playing();
    let mut force_paused = false;
    let mut paused_at_secs: i64 = 0;
    if last_playing.is_some() {
        tracing::info!("restored last_playing cache from disk");
    }

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());

    loop {
        let mut length_buffer = [0u8; 4];
        if reader.read_exact(&mut length_buffer).is_err() {
            tracing::warn!("stdin closed; exiting without clearing Discord presence");
            if let Some(path) = debug_log_path() {
                let _ = fs::write(
                    path,
                    r#"{"event":"stdin_eof","note":"host exit without clear (pause-safe)"}"#,
                );
            }
            break;
        }
        let data_length = u32::from_le_bytes(length_buffer) as usize;

        let mut json_buffer = vec![0u8; data_length];
        if reader.read_exact(&mut json_buffer).is_err() {
            tracing::warn!("stdin closed mid-message; exiting without clearing");
            break;
        }

        let input = match String::from_utf8(json_buffer) {
            Ok(s) => s,
            Err(err) => {
                tracing::error!(error = ?err, "invalid UTF-8 from extension");
                continue;
            }
        };

        if let Some(dir) = install_dir() {
            let line = format!(
                "{} {}\n",
                Local::now().format("%H:%M:%S"),
                input.chars().take(500).collect::<String>()
            );
            let _ = fs::OpenOptions::new()
                .create(true)
                .append(true)
                .open(dir.join("messages.log"))
                .and_then(|mut f| {
                    use std::io::Write;
                    f.write_all(line.as_bytes())
                });
        }

        let data: PresenceData = match serde_json::from_str(&input) {
            Ok(d) => d,
            Err(err) => {
                tracing::error!(error = ?err, raw = %input, "invalid JSON from extension");
                continue;
            }
        };

        if data.message_type == CLAER_MESSAGE {
            // Legacy extensions send type=4 on pause. Latch paused until resume.
            if let Some(mut paused) = last_playing.clone().or_else(load_last_playing) {
                paused.message_type = UPDATE_MESSAGE.to_string();
                paused.paused = true;
                force_paused = true;
                paused_at_secs = time_to_secs(&paused.current_time);
                tracing::info!(paused_at_secs, "legacy clear → latched pause");
                apply_presence(&mut client, app_id, paused);
            } else {
                tracing::warn!("legacy clear ignored (no cached playing presence)");
                if let Some(path) = debug_log_path() {
                    let _ = fs::write(
                        path,
                        r#"{"event":"ignored_clear","note":"no cached presence to mark paused"}"#,
                    );
                }
            }
            continue;
        } else if data.message_type == DISCONNECT_MESSAGE {
            tracing::info!("disconnect requested; will clear on exit");
            if let Some(path) = debug_log_path() {
                let _ = fs::write(
                    path,
                    r#"{"event":"disconnect","note":"host exiting after tab close"}"#,
                );
            }
            clear_on_exit = true;
            break;
        } else if data.message_type == UPDATE_MESSAGE {
            let mut data = data;
            // Keep previously known URLs if this tick omitted them.
            if let Some(prev) = last_playing.as_ref() {
                if data.work_url.is_empty() {
                    data.work_url = prev.work_url.clone();
                }
                if data.part_url.is_empty() {
                    data.part_url = prev.part_url.clone();
                }
            }

            if data.paused {
                force_paused = true;
                paused_at_secs = time_to_secs(&data.current_time);
                if last_playing.is_none() {
                    let mut base = data.clone();
                    enrich_urls(&mut base);
                    base.paused = false;
                    last_playing = Some(base.clone());
                    save_last_playing(&base);
                }
                apply_presence(&mut client, app_id, data);
                continue;
            }

            // Playing update. If we are latched paused, ignore stale playing
            // payloads until playback time advances (resume).
            if force_paused {
                let now_secs = time_to_secs(&data.current_time);
                let advanced = (now_secs - paused_at_secs).abs();
                if advanced < 2 {
                    tracing::info!(
                        advanced,
                        "ignoring playing update while pause-latched; re-assert pause"
                    );
                    if let Some(mut paused) = last_playing.clone() {
                        paused.paused = true;
                        paused.current_time = data.current_time.clone();
                        apply_presence(&mut client, app_id, paused);
                    }
                    continue;
                }
                tracing::info!(advanced, "pause latch cleared (playback resumed)");
                force_paused = false;
            }

            enrich_urls(&mut data);
            last_playing = Some(data.clone());
            save_last_playing(&data);
            apply_presence(&mut client, app_id, data);
        }
    }

    if clear_on_exit {
        let _ = client.clear_activity();
    }
}

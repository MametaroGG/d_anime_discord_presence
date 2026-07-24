use std::fs;
use std::io::{self, BufReader, Read};
use std::path::PathBuf;

use chrono::{Duration, Local};
use discord_sdk::{self as ds};
use serde::Deserialize;
use serde_json::Result;
use tokio;
use tracing_subscriber::fmt::writer::BoxMakeWriter;

/// Fallback only for local testing until config.json is set.
/// For Chrome Web Store / public release you MUST use your own Discord Application ID.
const FALLBACK_APP_ID: ds::AppId = 1267357061495128074;
const UPDATE_MESSAGE: &str = "3";
const CLAER_MESSAGE: &str = "4";
const DISCONNECT_MESSAGE: &str = "5";

#[derive(Deserialize, Debug)]
struct AppConfig {
    app_id: i64,
}

#[derive(Deserialize, Debug)]
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
}

fn config_path() -> Option<PathBuf> {
    let exe = std::env::current_exe().ok()?;
    Some(exe.parent()?.join("config.json"))
}

fn load_app_id() -> ds::AppId {
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
                "config.json not found; using fallback app id (replace before public release)"
            ),
        }
    }
    FALLBACK_APP_ID
}

fn presence_image(thumbnail: &str) -> &str {
    if thumbnail.starts_with("https://") || thumbnail.starts_with("http://") {
        thumbnail
    } else {
        "presence_icon"
    }
}

fn format_state(episodes: &str, subtitle: &str, total_duration: &str) -> String {
    let episode_line = if subtitle.is_empty() {
        episodes.to_string()
    } else {
        format!("{episodes}「{subtitle}」")
    };
    format!("{episode_line} / {total_duration}")
}

struct Client {
    discord: ds::Discord,
    user: ds::user::User,
    wheel: ds::wheel::Wheel,
}

async fn make_client(app_id: ds::AppId) -> Client {
    tracing_subscriber::fmt()
        .compact()
        .with_max_level(tracing::Level::TRACE)
        .with_writer(BoxMakeWriter::new(std::io::stderr))
        .init();

    let (wheel, handler) = ds::wheel::Wheel::new(Box::new(|err| {
        tracing::error!(error = ?err, "encountered an error");
    }));

    let mut user = wheel.user();

    let discord = ds::Discord::new(
        ds::DiscordApp::PlainId(app_id),
        ds::Subscriptions::ACTIVITY,
        Box::new(handler),
    )
    .expect("unable to create discord client");

    tracing::info!("waiting for handshake...");
    user.0.changed().await.unwrap();

    let user = match &*user.0.borrow() {
        ds::wheel::UserState::Connected(user) => user.clone(),
        ds::wheel::UserState::Disconnected(err) => panic!("failed to connect Discord {}", err),
    };

    tracing::info!("connected to Discord, local user is {:#?}", user);

    Client {
        discord,
        user,
        wheel,
    }
}

fn parse_time_string(time_str: &str) -> Duration {
    let parts: Vec<&str> = time_str.split(':').collect();

    let (hours, minutes, seconds) = match parts.len() {
        3 => (
            parts[0].parse::<i64>().unwrap_or(0),
            parts[1].parse::<i64>().unwrap_or(0),
            parts[2].parse::<i64>().unwrap_or(0),
        ),
        _ => (0, 0, 0),
    };

    Duration::seconds(hours * 3600 + minutes * 60 + seconds)
}

#[tokio::main]
async fn main() -> Result<()> {
    let app_id = load_app_id();
    let client = make_client(app_id).await;

    let mut activity_events = client.wheel.activity();

    tokio::task::spawn(async move {
        while let Ok(ae) = activity_events.0.recv().await {
            tracing::info!(event = ?ae, "received activity event");
        }
    });

    let stdin = io::stdin();
    let mut reader = BufReader::new(stdin.lock());

    loop {
        let mut length_buffer = [0u8; 4];
        if reader.read_exact(&mut length_buffer).is_err() {
            break;
        }
        let data_length = u32::from_le_bytes(length_buffer) as usize;

        let mut json_buffer = vec![0u8; data_length];
        let _ = reader.read_exact(&mut json_buffer);

        let input = String::from_utf8(json_buffer).expect("Invalid UTF-8 data");

        let data: PresenceData = serde_json::from_str(&input).expect("Invalid JSON data");

        if data.message_type == CLAER_MESSAGE {
            tracing::info!(
                "cleared activity: {:?}",
                client.discord.clear_activity().await
            );
            continue;
        } else if data.message_type == DISCONNECT_MESSAGE {
            break;
        } else if data.message_type == UPDATE_MESSAGE {
            let image = presence_image(&data.thumbnail);
            let large_text = if data.title.is_empty() {
                "Watching anime".to_string()
            } else {
                data.title.clone()
            };
            let rp = ds::activity::ActivityBuilder::default()
                .assets(ds::activity::Assets::default().large(image, Some(large_text)))
                .kind(ds::activity::ActivityKind::Watching)
                .details(&data.title)
                .state(format_state(
                    &data.episodes,
                    &data.subtitle,
                    &data.total_duration,
                ))
                .start_timestamp(
                    (Local::now() - parse_time_string(&data.current_time)).timestamp(),
                );

            tracing::info!(
                "updated activity: {:?}",
                client.discord.update_activity(rp).await
            );
        }
    }

    tracing::info!(
        "cleared activity: {:?}",
        client.discord.clear_activity().await
    );

    client.discord.disconnect().await;

    Ok(())
}

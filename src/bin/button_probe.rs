//! Diagnose Discord Rich Presence buttons.
//! Usage:
//!   cargo run --release --bin button_probe -- [app_id] [watching|playing|listening]
use discord_rich_presence::{
    activity::{Activity, ActivityType, Button, Timestamps},
    DiscordIpc, DiscordIpcClient,
};
use std::time::{SystemTime, UNIX_EPOCH};

fn main() {
    let app_id = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "1530188395987599370".to_string());
    let mode = std::env::args()
        .nth(2)
        .unwrap_or_else(|| "watching".to_string());

    let now = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap()
        .as_secs() as i64;

    let work = "https://animestore.docomo.ne.jp/animestore/ci_pc?workId=20151";
    let part =
        "https://animestore.docomo.ne.jp/animestore/ci_pc?workId=20151&partId=20151016";

    let mut activity = Activity::new()
        .details("button probe")
        .state("check from another account")
        .timestamps(Timestamps::new().start(now - 120).end(now + 600))
        .buttons(vec![
            Button::new("Work page", work),
            Button::new("Watch episode", part),
        ]);

    activity = match mode.as_str() {
        "playing" => activity.activity_type(ActivityType::Playing),
        "listening" => activity.activity_type(ActivityType::Listening),
        _ => activity.activity_type(ActivityType::Watching),
    };

    let preview = serde_json::to_string_pretty(&serde_json::json!({
        "cmd": "SET_ACTIVITY",
        "args": { "pid": std::process::id(), "activity": &activity },
    }))
    .unwrap();
    println!("{preview}");

    let log = std::env::temp_dir().join("danime_button_probe.json");
    std::fs::write(&log, &preview).ok();
    println!("wrote {}", log.display());

    let mut client = DiscordIpcClient::new(&app_id);
    client.connect().expect("connect");
    client.set_activity(activity).expect("set_activity");

    // Read Discord's reply (success or error).
    match client.recv() {
        Ok((op, value)) => println!("discord reply op={op} body={value}"),
        Err(err) => println!("discord reply read failed: {err:?}"),
    }

    println!("Presence set ({mode}). Ask another account to view profile for 25s...");
    std::thread::sleep(std::time::Duration::from_secs(25));
    let _ = client.clear_activity();
    let _ = client.close();
    println!("cleared");
}

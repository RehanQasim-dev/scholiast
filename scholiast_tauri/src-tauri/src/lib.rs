use serde::Serialize;
use state::AppState;
use tauri::Manager;

mod capture;
mod commands;
mod drive;
pub mod player_server;
mod reader;
mod secrets;
mod stt;
mod state;
#[allow(clippy::module_inception)]
mod store;
mod sync;
mod transcript;

#[derive(Serialize)]
struct Health {
    ok: bool,
}

#[tauri::command]
async fn app_health(state: tauri::State<'_, AppState>) -> Result<Health, String> {
    let one: i32 = sqlx::query_scalar("SELECT 1")
        .fetch_one(&state.pool)
        .await
        .map_err(|err| err.to_string())?;
    debug_assert_eq!(one, 1);
    Ok(Health { ok: true })
}

#[tauri::command]
fn get_player_server_url(state: tauri::State<'_, AppState>) -> Result<Option<String>, String> {
    Ok(state.player_server_url.clone())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    #[cfg(target_os = "linux")]
    std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");

    tauri::Builder::default()
        .plugin(tauri_plugin_store::Builder::default().build())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        // ACTION_SEND share target (YouTube/Chrome "Share → Scholiast"):
        // the deep-link plugin only sees ACTION_VIEW, so SEND text arrives
        // through this queue instead (consumed in lib/deepLink.ts).
        .plugin(tauri_plugin_mobile_sharetarget::init())
        .setup(|app| {
            let data_dir = app.path().app_data_dir()?;
            #[cfg(target_os = "android")]
            secrets::init_store(&data_dir);
            let app_state = tauri::async_runtime::block_on(AppState::init(data_dir))?;
            app.manage(app_state);
            sync::scheduler::spawn(app.handle().clone());
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            app_health,
            get_player_server_url,
            commands::videos::upsert_video,
            commands::videos::list_recent_videos,
            commands::videos::get_video_items,
            commands::videos::save_video_item,
            commands::videos::delete_video_item,
            commands::videos::set_resume_at,
            commands::videos::add_note,
            commands::videos::upsert_tag,
            commands::videos::list_tags,
            stt::recording::voice_begin,
            stt::recording::voice_append_chunk,
            stt::recording::voice_finish,
            stt::recording::voice_cancel,
            stt::cloud::stt_transcribe,
            stt::cloud::stt_edit_text,
            transcript::client::fetch_transcript,
            #[cfg(feature = "local-stt")]
            stt::local::stt_local_transcribe,
            #[cfg(feature = "local-stt")]
            stt::local::stt_local_cancel,
            stt::local::list_stt_models,
            stt::local::download_stt_model,
            stt::local::import_stt_model_chunk,
            stt::local::delete_stt_model,
            commands::drive::drive_connect,
            commands::drive::drive_disconnect,
            commands::drive::drive_status,
            commands::drive::set_secret,
            commands::drive::get_secret_status,
            commands::drive::delete_secret,
            capture::capture_frame,
            capture::cleanup_capture,
            capture::persist::save_frame_item,
            capture::persist::get_frame_item,
            commands::data::data_stats,
            commands::data::wipe_local_data,
            commands::data::wipe_drive_data,
            commands::settings::get_prompt_defaults,
            commands::settings::stt_test_groq,
            commands::settings::stt_test_gemini,
            sync::commands::sync_now,
            sync::commands::is_page_in_sync,
            commands::reader::add_article,
            commands::reader::list_articles,
            commands::reader::get_page,
            commands::reader::get_authentic_html,
            commands::reader::delete_article,
            commands::reader::save_highlight,
            commands::reader::list_highlights,
            commands::reader::delete_highlight,
            commands::reader::update_highlight_color,
            commands::reader::save_comment,
            commands::reader::list_comments,
            commands::reader::delete_comment,
            commands::reader::save_diagram_item,
            commands::reader::get_diagram_item,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

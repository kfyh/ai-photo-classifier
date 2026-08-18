pub mod commands;
pub mod db;
pub mod exporters;
pub mod image_pipeline;
pub mod ml;
pub mod models;

use std::sync::{Arc, Mutex};

use commands::*;
use db::AppDatabase;
use image_pipeline::ImagePipeline;
use ml::engine::MLEngine;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let db = Arc::new(AppDatabase::new().expect("Failed to initialize SQLite database"));
    let image_pipeline = Arc::new(ImagePipeline::new());
    let ml_engine = Arc::new(Mutex::new(MLEngine::new()));

    let app_state = AppState {
        db,
        image_pipeline,
        ml_engine,
    };

    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_dialog::init())
        .manage(app_state)
        .invoke_handler(tauri::generate_handler![
            select_folder,
            get_folders,
            import_folder,
            get_photos_in_folder,
            update_user_rating,
            get_histogram,
            export_rawtherapee,
            get_active_model,
            set_active_model,
            retrain_ai,
            get_accuracy_logs,
            clear_database,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

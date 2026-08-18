use std::path::Path;
use std::sync::{Arc, Mutex};
use rayon::prelude::*;
use tauri::{AppHandle, Emitter, State};
use tauri_plugin_dialog::DialogExt;
use uuid::Uuid;

use crate::db::AppDatabase;
use crate::exporters::Exporters;
use crate::image_pipeline::ImagePipeline;
use crate::ml::engine::MLEngine;
use crate::models::{
    AccuracyLog, CombinedPhotoData, FolderRecord, HistogramData, ImportProgressPayload,
    MLModelOption, PhotoRecord, UserRating,
};

pub struct AppState {
    pub db: Arc<AppDatabase>,
    pub image_pipeline: Arc<ImagePipeline>,
    pub ml_engine: Arc<Mutex<MLEngine>>,
}

#[derive(serde::Serialize)]
pub struct RetrainResult {
    pub log: AccuracyLog,
    pub snapshot_id: String,
}

#[tauri::command]
pub async fn select_folder(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<Option<FolderRecord>, String> {
    let (tx, rx) = tokio::sync::oneshot::channel();

    app.dialog().file().pick_folder(move |folder_path| {
        let _ = tx.send(folder_path);
    });

    let folder_path_opt = rx.await.map_err(|e| e.to_string())?;

    if let Some(file_path) = folder_path_opt {
        let path_str = file_path.to_string();
        let name = Path::new(&path_str)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Folder")
            .to_string();

        if let Ok(Some(existing)) = state.db.get_folder_by_path(&path_str) {
            return Ok(Some(existing));
        }

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let folder = FolderRecord {
            id: Uuid::new_v4().to_string(),
            path: path_str,
            name,
            created_at: now,
            photo_count: Some(0),
        };

        state.db.insert_folder(&folder).map_err(|e| e.to_string())?;
        Ok(Some(folder))
    } else {
        Ok(None)
    }
}

#[tauri::command]
pub async fn get_folders(state: State<'_, AppState>) -> Result<Vec<FolderRecord>, String> {
    state.db.get_folders().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn import_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_path: String,
) -> Result<FolderRecord, String> {
    let db = state.db.clone();
    let pipeline = state.image_pipeline.clone();
    let ml = state.ml_engine.clone();

    let folder = if let Some(existing) = db.get_folder_by_path(&folder_path).map_err(|e| e.to_string())? {
        existing
    } else {
        let name = Path::new(&folder_path)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Folder")
            .to_string();

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let f = FolderRecord {
            id: Uuid::new_v4().to_string(),
            path: folder_path.clone(),
            name,
            created_at: now,
            photo_count: Some(0),
        };
        db.insert_folder(&f).map_err(|e| e.to_string())?;
        f
    };

    let folder_id = folder.id.clone();
    let scanned_files = pipeline.scan_folder(&folder_path);
    let total = scanned_files.len();

    tokio::task::spawn_blocking(move || {
        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        let first_batch_size = 24.min(total);

        // --- Phase 1: Rapid Thumbnail-Only Generation (<50ms Instant Grid View Fill) ---
        let mut first_combined_list = Vec::new();
        for (idx, file_path_buf) in scanned_files.iter().take(first_batch_size).enumerate() {
            let file_path = file_path_buf.to_string_lossy().to_string();
            let file_name = file_path_buf
                .file_name()
                .and_then(|s| s.to_str())
                .unwrap_or("image")
                .to_string();
            let photo_id = Uuid::new_v4().to_string();

            // FAST PATH: Generate WebP thumbnail ONLY from EXIF embedded bytes (<2ms), zero full image decodes
            let (thumb_path, w, h, file_size) = pipeline.generate_thumbnail_fast_exif_only(&file_path, &photo_id);

            let photo_record = PhotoRecord {
                id: photo_id.clone(),
                folder_id: folder_id.clone(),
                file_path: file_path.clone(),
                file_name,
                file_size,
                width: w,
                height: h,
                date_taken: Some(now),
                created_at: now,
                thumbnail_path: if thumb_path.is_empty() { None } else { Some(thumb_path) },
            };

            let combined = CombinedPhotoData {
                photo: photo_record,
                exif: None,
                user_rating: UserRating {
                    photo_id: photo_id.clone(),
                    pick_status: "unflagged".to_string(),
                    star_rating: 0,
                    is_confirmed: false,
                    updated_at: now,
                },
                quality: None,
                ai_prediction: None,
            };

            first_combined_list.push(combined.clone());

            let payload = ImportProgressPayload {
                folder_id: folder_id.clone(),
                current: idx + 1,
                total,
                photo: Some(combined),
            };
            let _ = app.emit("import-progress", payload);
        }

        let _ = db.insert_combined_photos_batch(&first_combined_list);

        // --- Phase 2: Parallel Background Processing (Remaining Thumbnails + Deep Metadata & AI for ALL Photos) ---
        let chunk_size = 20;

        for (chunk_idx, chunk) in scanned_files.chunks(chunk_size).enumerate() {
            let processed_chunk: Vec<CombinedPhotoData> = chunk
                .par_iter()
                .map(|file_path_buf| {
                    let file_path = file_path_buf.to_string_lossy().to_string();
                    let file_name = file_path_buf
                        .file_name()
                        .and_then(|s| s.to_str())
                        .unwrap_or("image")
                        .to_string();

                    let photo_id = Uuid::new_v4().to_string();
                    let res = pipeline.process_photo_single_pass(&file_path, &photo_id);

                    let photo_record = PhotoRecord {
                        id: photo_id.clone(),
                        folder_id: folder_id.clone(),
                        file_path: file_path.clone(),
                        file_name,
                        file_size: res.file_size,
                        width: res.width,
                        height: res.height,
                        date_taken: Some(now),
                        created_at: now,
                        thumbnail_path: if res.thumb_path.is_empty() { None } else { Some(res.thumb_path) },
                    };

                    let ml_guard = ml.lock().unwrap();
                    let pred = ml_guard.predict(&db, &photo_id, &file_path, Some(&res.quality));
                    drop(ml_guard);

                    CombinedPhotoData {
                        photo: photo_record,
                        exif: Some(res.exif),
                        user_rating: UserRating {
                            photo_id: photo_id.clone(),
                            pick_status: "unflagged".to_string(),
                            star_rating: 0,
                            is_confirmed: false,
                            updated_at: now,
                        },
                        quality: Some(res.quality),
                        ai_prediction: Some(pred),
                    }
                })
                .collect();

            let _ = db.insert_combined_photos_batch(&processed_chunk);

            for (idx_in_chunk, combined) in processed_chunk.into_iter().enumerate() {
                let global_idx = chunk_idx * chunk_size + idx_in_chunk + 1;
                let payload = ImportProgressPayload {
                    folder_id: folder_id.clone(),
                    current: global_idx,
                    total,
                    photo: Some(combined),
                };
                let _ = app.emit("import-progress", payload);
            }
        }

        let _ = app.emit("import-complete", serde_json::json!({ "folderId": folder_id, "total": total }));
    });

    Ok(folder)
}

#[tauri::command]
pub async fn get_photos_in_folder(
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<Vec<CombinedPhotoData>, String> {
    state.db.get_photos_in_folder(&folder_id).map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn update_user_rating(
    _app: AppHandle,
    state: State<'_, AppState>,
    photo_id: String,
    pick_status: String,
    star_rating: i32,
) -> Result<UserRating, String> {
    let rating = state
        .db
        .update_user_rating(&photo_id, &pick_status, star_rating)
        .map_err(|e| e.to_string())?;

    // Auto-retrain trigger on every 10 confirmed ratings
    if let Ok(confirmed_count) = state.db.get_confirmed_ratings_count() {
        if confirmed_count > 0 && confirmed_count % 10 == 0 {
            let db = state.db.clone();
            let ml = state.ml_engine.clone();
            tokio::task::spawn_blocking(move || {
                if let Ok(mut guard) = ml.lock() {
                    let _ = guard.retrain(&db);
                }
            });
        }
    }

    Ok(rating)
}

#[tauri::command]
pub async fn get_histogram(
    state: State<'_, AppState>,
    image_path: String,
    photo_id: Option<String>,
) -> Result<HistogramData, String> {
    Ok(state.image_pipeline.calculate_histogram(&image_path, photo_id.as_deref()))
}

#[tauri::command]
pub async fn export_rawtherapee(
    photo_path: String,
    rating: i32,
    pick_status: String,
) -> Result<String, String> {
    let pp3_path = Exporters::export_pp3(&photo_path, rating, &pick_status)?;
    let _ = Exporters::export_xmp(&photo_path, rating, &pick_status)?;
    Ok(pp3_path)
}

#[tauri::command]
pub async fn get_active_model(state: State<'_, AppState>) -> Result<MLModelOption, String> {
    let guard = state.ml_engine.lock().unwrap();
    Ok(guard.get_active_model())
}

#[tauri::command]
pub async fn set_active_model(
    state: State<'_, AppState>,
    model_id: String,
) -> Result<MLModelOption, String> {
    let mut guard = state.ml_engine.lock().unwrap();
    Ok(guard.set_active_model(&model_id))
}

#[tauri::command]
pub async fn retrain_ai(state: State<'_, AppState>) -> Result<RetrainResult, String> {
    let mut guard = state.ml_engine.lock().unwrap();
    let (log, snapshot_id) = guard.retrain(&state.db)?;
    Ok(RetrainResult { log, snapshot_id })
}

#[tauri::command]
pub async fn get_accuracy_logs(state: State<'_, AppState>) -> Result<Vec<AccuracyLog>, String> {
    state.db.get_accuracy_logs().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_database(state: State<'_, AppState>) -> Result<bool, String> {
    state.db.clear_database().map_err(|e| e.to_string())?;
    state.image_pipeline.get_cache_dir();
    Ok(true)
}

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

/// Stage 2 Worker: Deep Metadata (EXIF, Quality, Histogram) and AI Neural Predictions
fn spawn_pending_processing_worker(
    app: AppHandle,
    db: Arc<AppDatabase>,
    pipeline: Arc<ImagePipeline>,
    ml: Arc<Mutex<MLEngine>>,
    folder_id: String,
) {
    tokio::task::spawn_blocking(move || {
        let pending = match db.get_pending_photos_in_folder(&folder_id) {
            Ok(list) => list,
            Err(_) => return,
        };

        if pending.is_empty() {
            let _ = app.emit("import-complete", serde_json::json!({ "folderId": folder_id, "total": 0 }));
            return;
        }

        let total = pending.len();
        let chunk_size = 12;

        println!(
            "[Stage 2] Commencing deep metadata & AI processing for {} photos in folder {}",
            total, folder_id
        );

        for (chunk_idx, chunk) in pending.chunks(chunk_size).enumerate() {
            let processed_chunk: Vec<(CombinedPhotoData, Option<HistogramData>)> = chunk
                .par_iter()
                .map(|photo| {
                    let photo_id = &photo.id;
                    let file_path = &photo.file_path;
                    let res = pipeline.process_photo_single_pass(file_path, photo_id);

                    let final_thumb = if !res.thumb_path.is_empty() {
                        Some(res.thumb_path)
                    } else if photo.thumbnail_path.as_ref().map(|p| !p.is_empty()).unwrap_or(false) {
                        photo.thumbnail_path.clone()
                    } else {
                        let cache_thumb = pipeline.get_cache_dir().join(format!("{}_thumb.webp", photo_id));
                        if cache_thumb.exists() {
                            Some(cache_thumb.to_string_lossy().to_string())
                        } else {
                            photo.thumbnail_path.clone()
                        }
                    };

                    let updated_photo = PhotoRecord {
                        id: photo_id.clone(),
                        folder_id: folder_id.clone(),
                        file_path: file_path.clone(),
                        file_name: photo.file_name.clone(),
                        file_size: if res.file_size > 0 { res.file_size } else { photo.file_size },
                        width: if res.width > 0 { res.width } else if photo.width > 0 { photo.width } else { 400 },
                        height: if res.height > 0 { res.height } else if photo.height > 0 { photo.height } else { 400 },
                        date_taken: photo.date_taken,
                        created_at: photo.created_at,
                        thumbnail_path: final_thumb,
                        processing_status: "completed".to_string(),
                        histogram_json: serde_json::to_string(&res.histogram).ok(),
                    };

                    let ml_guard = ml.lock().unwrap();
                    let pred = ml_guard.predict(&db, photo_id, file_path, Some(&res.quality));
                    drop(ml_guard);

                    let current_rating = db.get_user_rating(photo_id).ok().flatten().unwrap_or(UserRating {
                        photo_id: photo_id.clone(),
                        pick_status: "unflagged".to_string(),
                        star_rating: 0,
                        is_confirmed: false,
                        updated_at: photo.created_at,
                    });

                    let combined = CombinedPhotoData {
                        photo: updated_photo,
                        exif: Some(res.exif),
                        user_rating: current_rating,
                        quality: Some(res.quality),
                        ai_prediction: Some(pred),
                    };

                    (combined, Some(res.histogram))
                })
                .collect();

            // 1. Single atomic batch update to database
            let _ = db.update_photos_processed_batch(&processed_chunk);

            // 2. Emit 1 batched event to prevent webview event flooding
            let photos_batch: Vec<CombinedPhotoData> = processed_chunk.into_iter().map(|(c, _)| c).collect();
            let global_idx = ((chunk_idx + 1) * chunk_size).min(total);
            let payload = ImportProgressPayload {
                folder_id: folder_id.clone(),
                current: global_idx,
                total,
                photo: photos_batch.last().cloned(),
                photos: Some(photos_batch),
            };
            let _ = app.emit("import-progress", payload);
        }

        let _ = app.emit("import-complete", serde_json::json!({ "folderId": folder_id, "total": total }));
    });
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
    let total_scanned = scanned_files.len();

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0);

    // Pre-insert scanned files in 500-item atomic batch transactions (<15ms for 3,000 files)
    let mut initial_records = Vec::with_capacity(total_scanned);
    for file_path_buf in &scanned_files {
        let file_path = file_path_buf.to_string_lossy().to_string();
        let file_name = file_path_buf
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("image")
            .to_string();
        let new_id = Uuid::new_v4().to_string();
        initial_records.push(PhotoRecord {
            id: new_id,
            folder_id: folder_id.clone(),
            file_path,
            file_name,
            file_size: 0,
            width: 400,
            height: 400,
            date_taken: Some(now),
            created_at: now,
            thumbnail_path: None,
            processing_status: "pending".to_string(),
            histogram_json: None,
        });
    }

    for chunk in initial_records.chunks(500) {
        let _ = db.insert_photos_batch(chunk);
    }

    tokio::task::spawn_blocking({
        let db = db.clone();
        let pipeline = pipeline.clone();
        let app = app.clone();
        let folder_id = folder_id.clone();

        move || {
            // =========================================================================
            // Stage 1: Rapid Thumbnail Generation & Registration Pass for ALL Images
            // =========================================================================
            println!(
                "[Stage 1] Preparing rapid thumbnails for all {} images in folder {}",
                total_scanned, folder_id
            );

            let chunk_size = 12;
            for (chunk_idx, chunk_paths) in scanned_files.chunks(chunk_size).enumerate() {
                let batch: Vec<CombinedPhotoData> = chunk_paths
                    .par_iter()
                    .map(|file_path_buf| {
                        let file_path = file_path_buf.to_string_lossy().to_string();

                        let (photo_id, mut photo_record) = if let Ok(Some(existing)) = db.get_photo_by_path(&file_path) {
                            (existing.id.clone(), existing)
                        } else {
                            let file_name = file_path_buf
                                .file_name()
                                .and_then(|s| s.to_str())
                                .unwrap_or("image")
                                .to_string();
                            let new_id = Uuid::new_v4().to_string();

                            let record = PhotoRecord {
                                id: new_id.clone(),
                                folder_id: folder_id.clone(),
                                file_path: file_path.clone(),
                                file_name,
                                file_size: 0,
                                width: 400,
                                height: 400,
                                date_taken: Some(now),
                                created_at: now,
                                thumbnail_path: None,
                                processing_status: "pending".to_string(),
                                histogram_json: None,
                            };
                            (new_id, record)
                        };

                        let needs_thumb = photo_record.thumbnail_path.as_ref()
                            .map(|p| !Path::new(p).exists())
                            .unwrap_or(true);

                        if needs_thumb {
                            let (thumb_path, w, h, file_size) = pipeline.generate_thumbnail_fast_exif_only(&file_path, &photo_id);
                            if !thumb_path.is_empty() {
                                photo_record.thumbnail_path = Some(thumb_path);
                            }
                            if w > 0 { photo_record.width = w; }
                            if h > 0 { photo_record.height = h; }
                            if file_size > 0 { photo_record.file_size = file_size; }
                        }

                        let current_rating = db.get_user_rating(&photo_id).ok().flatten().unwrap_or(UserRating {
                            photo_id: photo_id.clone(),
                            pick_status: "unflagged".to_string(),
                            star_rating: 0,
                            is_confirmed: false,
                            updated_at: now,
                        });

                        CombinedPhotoData {
                            photo: photo_record,
                            exif: None,
                            user_rating: current_rating,
                            quality: None,
                            ai_prediction: None,
                        }
                    })
                    .collect();

                let records_to_save: Vec<PhotoRecord> = batch.iter().map(|c| c.photo.clone()).collect();
                let _ = db.insert_photos_batch(&records_to_save);

                let global_idx = ((chunk_idx + 1) * chunk_size).min(total_scanned);
                let payload = ImportProgressPayload {
                    folder_id: folder_id.clone(),
                    current: global_idx,
                    total: total_scanned,
                    photo: batch.last().cloned(),
                    photos: Some(batch),
                };
                let _ = app.emit("import-progress", payload);
            }

            // =========================================================================
            // Stage 2: Deep Metadata, EXIF, Quality & AI Neural Predictions
            // =========================================================================
            spawn_pending_processing_worker(app, db, pipeline, ml, folder_id);
        }
    });

    Ok(folder)
}

#[tauri::command]
pub async fn get_photos_in_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<Vec<CombinedPhotoData>, String> {
    let photos = state.db.get_photos_in_folder(&folder_id).map_err(|e| e.to_string())?;

    // Check if any photos in this folder are missing metadata processing
    if let Ok(pending) = state.db.get_pending_photos_in_folder(&folder_id) {
        if !pending.is_empty() {
            println!(
                "[Processing Queue] Resuming background processing for {} pending photos in folder {}",
                pending.len(),
                folder_id
            );
            spawn_pending_processing_worker(
                app,
                state.db.clone(),
                state.image_pipeline.clone(),
                state.ml_engine.clone(),
                folder_id,
            );
        }
    }

    Ok(photos)
}

#[tauri::command]
pub async fn update_user_rating(
    state: State<'_, AppState>,
    photo_id: String,
    pick_status: String,
    star_rating: i32,
) -> Result<UserRating, String> {
    let rating = state
        .db
        .update_user_rating(&photo_id, &pick_status, star_rating)
        .map_err(|e| e.to_string())?;

    // Auto-retrain if we have enough samples and confirmed updates
    if let Ok(confirmed) = state.db.get_confirmed_training_data("local_onnx", "mobilenet_v3") {
        if confirmed.len() >= 10 {
            tokio::task::spawn_blocking({
                let db = state.db.clone();
                let ml = state.ml_engine.clone();
                move || {
                    let mut guard = ml.lock().unwrap();
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
    // 1. Fast path: Check SQLite cache first for instant response
    if let Some(ref pid) = photo_id {
        if let Ok(Some(cached)) = state.db.get_cached_histogram(pid) {
            return Ok(cached);
        }
    }
    if let Ok(Some(cached)) = state.db.get_cached_histogram_by_path(&image_path) {
        return Ok(cached);
    }

    // 2. Slow path: Calculate from image & store in DB
    let hist = state.image_pipeline.calculate_histogram(&image_path, photo_id.as_deref());
    if let Some(ref pid) = photo_id {
        let _ = state.db.save_histogram(pid, &hist);
    }
    Ok(hist)
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
    let db = state.db.clone();
    let ml = state.ml_engine.clone();

    tokio::task::spawn_blocking(move || {
        let mut guard = ml.lock().unwrap();
        let (log, snapshot_id) = guard.retrain(&db)?;
        Ok(RetrainResult { log, snapshot_id })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_accuracy_logs(state: State<'_, AppState>) -> Result<Vec<AccuracyLog>, String> {
    state.db.get_accuracy_logs().map_err(|e| e.to_string())
}

#[tauri::command]
pub async fn clear_database(state: State<'_, AppState>) -> Result<(), String> {
    state.db.clear_database().map_err(|e| e.to_string())
}

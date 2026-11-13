use std::collections::{HashSet, VecDeque};
use std::path::Path;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use std::time::Duration;

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

pub struct WorkerControlState {
    pub priority_photo_ids: Mutex<VecDeque<String>>,
    pub attempted_priority_ids: Mutex<HashSet<String>>,
    pub active_folder_id: Mutex<Option<String>>,
    pub worker_running: AtomicBool,
}

impl WorkerControlState {
    pub fn new() -> Self {
        WorkerControlState {
            priority_photo_ids: Mutex::new(VecDeque::new()),
            attempted_priority_ids: Mutex::new(HashSet::new()),
            active_folder_id: Mutex::new(None),
            worker_running: AtomicBool::new(false),
        }
    }

    /// Pushes high-priority visible viewport photo IDs to the front of the queue.
    pub fn prioritize(&self, photo_ids: Vec<String>) {
        if photo_ids.is_empty() {
            return;
        }
        let attempted = self.attempted_priority_ids.lock().unwrap();
        let filtered_ids: Vec<String> = photo_ids
            .into_iter()
            .filter(|id| !attempted.contains(id))
            .collect();
        drop(attempted);

        if filtered_ids.is_empty() {
            return;
        }

        let mut queue = self.priority_photo_ids.lock().unwrap();
        let incoming_set: HashSet<&String> = filtered_ids.iter().collect();
        queue.retain(|existing| !incoming_set.contains(existing));
        for id in filtered_ids.into_iter().rev() {
            queue.push_front(id);
        }
        while queue.len() > 240 {
            queue.pop_back();
        }
    }

    /// Drains up to `max_count` photo IDs from the front of the priority queue.
    pub fn drain_priority_batch(&self, max_count: usize) -> Vec<String> {
        let mut queue = self.priority_photo_ids.lock().unwrap();
        let mut attempted = self.attempted_priority_ids.lock().unwrap();
        let count = queue.len().min(max_count);
        let mut batch = Vec::with_capacity(count);
        for _ in 0..count {
            if let Some(id) = queue.pop_front() {
                attempted.insert(id.clone());
                batch.push(id);
            }
        }
        batch
    }

    pub fn has_priority_items(&self) -> bool {
        let queue = self.priority_photo_ids.lock().unwrap();
        !queue.is_empty()
    }

    pub fn set_active_folder(&self, folder_id: String) {
        let mut active = self.active_folder_id.lock().unwrap();
        if active.as_deref() != Some(folder_id.as_str()) {
            self.priority_photo_ids.lock().unwrap().clear();
            self.attempted_priority_ids.lock().unwrap().clear();
        }
        *active = Some(folder_id);
    }

    pub fn get_active_folder(&self) -> Option<String> {
        self.active_folder_id.lock().unwrap().clone()
    }

    pub fn reset(&self) {
        self.priority_photo_ids.lock().unwrap().clear();
        self.attempted_priority_ids.lock().unwrap().clear();
        *self.active_folder_id.lock().unwrap() = None;
    }
}

pub struct AppState {
    pub db: Arc<AppDatabase>,
    pub image_pipeline: Arc<ImagePipeline>,
    pub ml_engine: Arc<Mutex<MLEngine>>,
    pub worker_control: Arc<WorkerControlState>,
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
        let path_str = file_path
            .clone()
            .into_path()
            .map(|p| p.to_string_lossy().to_string())
            .unwrap_or_else(|_| file_path.to_string());
        let name = Path::new(&path_str)
            .file_name()
            .and_then(|s| s.to_str())
            .unwrap_or("Folder")
            .to_string();

        println!("[Folder] Selected directory: {} ({})", name, path_str);

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
    let db = state.db.clone();
    tokio::task::spawn_blocking(move || db.get_folders().map_err(|e| e.to_string()))
        .await
        .map_err(|e| e.to_string())?
}

/// Processes any queued high-priority viewport thumbnail requests immediately ahead of background work.
fn drain_and_process_priority_thumbnails(
    app: &AppHandle,
    db: &Arc<AppDatabase>,
    pipeline: &Arc<ImagePipeline>,
    worker_control: &Arc<WorkerControlState>,
) {
    while worker_control.has_priority_items() {
        let priority_ids = worker_control.drain_priority_batch(12);
        if priority_ids.is_empty() {
            break;
        }

        let records = match db.get_photos_by_ids(&priority_ids) {
            Ok(list) => list,
            Err(_) => continue,
        };

        let needs_work: Vec<PhotoRecord> = records
            .into_iter()
            .filter(|r| {
                r.thumbnail_path
                    .as_ref()
                    .map(|p| p.is_empty() || !pipeline.is_valid_cached_thumb(Path::new(p)))
                    .unwrap_or(true)
            })
            .collect();

        if needs_work.is_empty() {
            continue;
        }

        let folder_id = needs_work[0].folder_id.clone();
        println!(
            "[Priority Queue] Generating {} visible viewport thumbnails for folder {}",
            needs_work.len(),
            folder_id
        );

        let batch: Vec<CombinedPhotoData> = needs_work
            .into_par_iter()
            .map(|mut photo_record| {
                let (thumb_path, w, h, file_size) =
                    pipeline.generate_thumbnail_fast_exif_only(&photo_record.file_path, &photo_record.id);
                if !thumb_path.is_empty() {
                    photo_record.thumbnail_path = Some(thumb_path);
                }
                if w > 0 {
                    photo_record.width = w;
                }
                if h > 0 {
                    photo_record.height = h;
                }
                if file_size > 0 {
                    photo_record.file_size = file_size;
                }

                let current_rating = db
                    .get_user_rating(&photo_record.id)
                    .ok()
                    .flatten()
                    .unwrap_or(UserRating {
                        photo_id: photo_record.id.clone(),
                        pick_status: "unflagged".to_string(),
                        star_rating: 0,
                        is_confirmed: false,
                        updated_at: photo_record.created_at,
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

        let updated_records: Vec<PhotoRecord> = batch.iter().map(|c| c.photo.clone()).collect();
        if let Err(e) = db.update_photos_thumbnails_batch(&updated_records) {
            eprintln!("[Database Error] Failed to update priority thumbnails batch: {}", e);
        }

        let payload = ImportProgressPayload {
            folder_id,
            current: 0,
            total: 0,
            photo: batch.last().cloned(),
            photos: Some(batch),
        };
        let _ = app.emit("import-progress", payload);

        // Yield briefly so UI commands never contend on SQLite or CPU
        std::thread::sleep(Duration::from_millis(12));
    }
}

/// Ensures at most one background worker is active across the application.
/// Prioritizes:
/// 1. Visible viewport thumbnails (`priority_photo_ids`)
/// 2. Remaining missing 400px `.webp` thumbnails in the active folder
/// 3. Low-priority background EXIF, Histogram, and ML prediction processing
fn ensure_background_worker(
    app: AppHandle,
    db: Arc<AppDatabase>,
    pipeline: Arc<ImagePipeline>,
    ml: Arc<Mutex<MLEngine>>,
    worker_control: Arc<WorkerControlState>,
    folder_id: String,
) {
    worker_control.set_active_folder(folder_id);

    // Guarantee single worker instance
    if worker_control
        .worker_running
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return;
    }

    tokio::task::spawn_blocking(move || {
        let mut tracked_folder_id = String::new();
        let mut attempted_thumbs: HashSet<String> = HashSet::new();
        let mut attempted_deep: HashSet<String> = HashSet::new();

        loop {
            // 1. Always process any high-priority visible viewport thumbnails first
            drain_and_process_priority_thumbnails(&app, &db, &pipeline, &worker_control);

            let current_folder_id = match worker_control.get_active_folder() {
                Some(fid) => fid,
                None => break,
            };

            if tracked_folder_id != current_folder_id {
                tracked_folder_id = current_folder_id.clone();
                attempted_thumbs.clear();
                attempted_deep.clear();
            }

            // 2. Stage 2: Generate remaining missing 400px WebP thumbnails in small chunks
            let missing_thumbs: Vec<PhotoRecord> = db
                .get_photos_missing_thumbnails_in_folder(&current_folder_id)
                .unwrap_or_default()
                .into_iter()
                .filter(|p| !attempted_thumbs.contains(&p.id))
                .collect();

            if !missing_thumbs.is_empty() {
                let total_missing = missing_thumbs.len();
                let thumb_chunk_size = 12;

                println!(
                    "[Stage 2] Generating 400px WebP thumbnails for {} photos in folder {}",
                    total_missing, current_folder_id
                );

                for (chunk_idx, chunk) in missing_thumbs.chunks(thumb_chunk_size).enumerate() {
                    // Preempt with any newly arrived visible-page priority requests
                    drain_and_process_priority_thumbnails(&app, &db, &pipeline, &worker_control);

                    // If user switched folders, immediately pivot to the new active folder
                    if worker_control.get_active_folder().as_deref() != Some(current_folder_id.as_str()) {
                        break;
                    }

                    for p in chunk {
                        attempted_thumbs.insert(p.id.clone());
                    }

                    let batch: Vec<CombinedPhotoData> = chunk
                        .par_iter()
                        .map(|photo| {
                            let mut photo_record = photo.clone();
                            let needs_thumb = photo_record
                                .thumbnail_path
                                .as_ref()
                                .map(|p| p.is_empty() || !Path::new(p).exists())
                                .unwrap_or(true);

                            if needs_thumb {
                                let (thumb_path, w, h, file_size) = pipeline
                                    .generate_thumbnail_fast_exif_only(
                                        &photo_record.file_path,
                                        &photo_record.id,
                                    );
                                if !thumb_path.is_empty() {
                                    photo_record.thumbnail_path = Some(thumb_path);
                                }
                                if w > 0 {
                                    photo_record.width = w;
                                }
                                if h > 0 {
                                    photo_record.height = h;
                                }
                                if file_size > 0 {
                                    photo_record.file_size = file_size;
                                }
                            }

                            let current_rating = db
                                .get_user_rating(&photo_record.id)
                                .ok()
                                .flatten()
                                .unwrap_or(UserRating {
                                    photo_id: photo_record.id.clone(),
                                    pick_status: "unflagged".to_string(),
                                    star_rating: 0,
                                    is_confirmed: false,
                                    updated_at: photo_record.created_at,
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

                    let records_to_update: Vec<PhotoRecord> =
                        batch.iter().map(|c| c.photo.clone()).collect();
                    if let Err(e) = db.update_photos_thumbnails_batch(&records_to_update) {
                        eprintln!("[Database Error] Failed to update Stage 2 thumbnails batch: {}", e);
                    }

                    let current_done = ((chunk_idx + 1) * thumb_chunk_size).min(total_missing);
                    println!(
                        "[Stage 2] Thumbnails ready: {}/{} in folder {}",
                        current_done, total_missing, current_folder_id
                    );
                    let payload = ImportProgressPayload {
                        folder_id: current_folder_id.clone(),
                        current: current_done,
                        total: total_missing,
                        photo: batch.last().cloned(),
                        photos: Some(batch),
                    };
                    let _ = app.emit("import-progress", payload);

                    // Yield between thumbnail chunks so UI interactions remain instantaneous
                    std::thread::sleep(Duration::from_millis(20));
                }

                // Loop back to re-verify priority queue and folder state before Stage 3
                if worker_control.get_active_folder().as_deref() != Some(current_folder_id.as_str()) {
                    continue;
                }

                // Mark thumbnail import progress bar complete as soon as Stage 2 finishes
                let _ = app.emit(
                    "import-complete",
                    serde_json::json!({ "folderId": current_folder_id, "total": total_missing }),
                );
            }

            // 3. Stage 3: Throttled Low-Priority Deep Processing (EXIF, Histogram, ML Predictions)
            let pending: Vec<PhotoRecord> = db
                .get_pending_photos_in_folder(&current_folder_id)
                .unwrap_or_default()
                .into_iter()
                .filter(|p| !attempted_deep.contains(&p.id))
                .collect();

            if pending.is_empty() {
                println!(
                    "[Worker] All thumbnails and metadata completed for folder {}",
                    current_folder_id
                );
                let _ = app.emit(
                    "import-complete",
                    serde_json::json!({ "folderId": current_folder_id, "total": 0 }),
                );
                break;
            }

            let total_pending = pending.len();
            let deep_chunk_size = 8;

            println!(
                "[Stage 3] Running low-priority EXIF, Histogram & ML processing for {} photos in folder {}",
                total_pending, current_folder_id
            );

            let mut folder_switched = false;
            for (chunk_idx, chunk) in pending.chunks(deep_chunk_size).enumerate() {
                // Preempt immediately if user scrolled and requested visible thumbnails
                drain_and_process_priority_thumbnails(&app, &db, &pipeline, &worker_control);

                if worker_control.get_active_folder().as_deref() != Some(current_folder_id.as_str()) {
                    folder_switched = true;
                    break;
                }

                for p in chunk {
                    attempted_deep.insert(p.id.clone());
                }

                let processed_chunk: Vec<(CombinedPhotoData, Option<HistogramData>)> = chunk
                    .par_iter()
                    .map(|photo| {
                        let photo_id = &photo.id;
                        let file_path = &photo.file_path;
                        let res = pipeline.process_photo_single_pass(file_path, photo_id);

                        let final_thumb = if !res.thumb_path.is_empty() {
                            Some(res.thumb_path)
                        } else if photo
                            .thumbnail_path
                            .as_ref()
                            .map(|p| !p.is_empty() && pipeline.is_valid_cached_thumb(Path::new(p)))
                            .unwrap_or(false)
                        {
                            photo.thumbnail_path.clone()
                        } else {
                            let cache_jpg =
                                pipeline.get_cache_dir().join(format!("{}_thumb.jpg", photo_id));
                            if pipeline.is_valid_cached_thumb(&cache_jpg) {
                                Some(cache_jpg.to_string_lossy().to_string())
                            } else {
                                let (gen_path, _, _, _) =
                                    pipeline.generate_thumbnail_fast_exif_only(file_path, photo_id);
                                if !gen_path.is_empty() {
                                    Some(gen_path)
                                } else {
                                    None
                                }
                            }
                        };

                        let updated_photo = PhotoRecord {
                            id: photo_id.clone(),
                            folder_id: current_folder_id.clone(),
                            file_path: file_path.clone(),
                            file_name: photo.file_name.clone(),
                            file_size: if res.file_size > 0 {
                                res.file_size
                            } else {
                                photo.file_size
                            },
                            width: if res.width > 0 {
                                res.width
                            } else if photo.width > 0 {
                                photo.width
                            } else {
                                400
                            },
                            height: if res.height > 0 {
                                res.height
                            } else if photo.height > 0 {
                                photo.height
                            } else {
                                400
                            },
                            date_taken: photo.date_taken,
                            created_at: photo.created_at,
                            thumbnail_path: final_thumb,
                            processing_status: "completed".to_string(),
                            histogram_json: serde_json::to_string(&res.histogram).ok(),
                        };

                        let pred = {
                            let ml_guard = ml.lock().unwrap();
                            ml_guard.predict(&db, photo_id, file_path)
                        };

                        let current_rating = db
                            .get_user_rating(photo_id)
                            .ok()
                            .flatten()
                            .unwrap_or(UserRating {
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
                            quality: None,
                            ai_prediction: Some(pred),
                        };

                        (combined, Some(res.histogram))
                    })
                    .collect();

                // 1. Atomic batch flush to SQLite disk
                if let Err(e) = db.update_photos_processed_batch(&processed_chunk) {
                    eprintln!("[Database Error] Failed to update Stage 3 processed batch: {}", e);
                }

                // 2. Emit 1 batched IPC event (current: 0, total: 0 so top-bar import progress doesn't loop)
                let photos_batch: Vec<CombinedPhotoData> =
                    processed_chunk.into_iter().map(|(c, _)| c).collect();
                let global_idx = ((chunk_idx + 1) * deep_chunk_size).min(total_pending);
                println!(
                    "[Stage 3] Deep processed {}/{} photos in folder {}",
                    global_idx, total_pending, current_folder_id
                );
                let payload = ImportProgressPayload {
                    folder_id: current_folder_id.clone(),
                    current: 0,
                    total: 0,
                    photo: photos_batch.last().cloned(),
                    photos: Some(photos_batch),
                };
                let _ = app.emit("import-progress", payload);

                // 3. Yield between chunks so UI ratings, histograms, and priority requests have zero latency
                std::thread::sleep(Duration::from_millis(35));
            }

            if !folder_switched {
                println!(
                    "[Worker] Finished all background processing for folder {}",
                    current_folder_id
                );
                let _ = app.emit(
                    "import-complete",
                    serde_json::json!({ "folderId": current_folder_id, "total": 0 }),
                );
                break;
            }
        }

        worker_control.worker_running.store(false, Ordering::SeqCst);

        // If new priority items arrived right as the worker was exiting, process them
        if worker_control.has_priority_items() {
            if worker_control
                .worker_running
                .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
                .is_ok()
            {
                drain_and_process_priority_thumbnails(&app, &db, &pipeline, &worker_control);
                worker_control.worker_running.store(false, Ordering::SeqCst);
            }
        }
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
    let worker_control = state.worker_control.clone();

    tokio::task::spawn_blocking(move || {
        let mut folder = if let Some(existing) =
            db.get_folder_by_path(&folder_path).map_err(|e| e.to_string())?
        {
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
        folder.photo_count = Some(total_scanned as i64);

        println!(
            "[Stage 1] Scanning & registering {} photos in folder '{}' ({})",
            total_scanned, folder.name, folder_id
        );

        let now = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_millis() as i64)
            .unwrap_or(0);

        // Stage 1: Instant filesystem metadata discovery (<0.02ms/file) & 500-item atomic SQLite pre-registration.
        // Avoids opening image files synchronously so the folder and catalog load immediately.
        let initial_records: Vec<PhotoRecord> = scanned_files
            .par_iter()
            .map(|file_path_buf| {
                let file_path = file_path_buf.to_string_lossy().to_string();
                let file_name = file_path_buf
                    .file_name()
                    .and_then(|s| s.to_str())
                    .unwrap_or("image")
                    .to_string();
                let file_size = pipeline.inspect_file_metadata_fast(&file_path);
                let new_id = Uuid::new_v4().to_string();

                PhotoRecord {
                    id: new_id,
                    folder_id: folder_id.clone(),
                    file_path,
                    file_name,
                    file_size,
                    width: 400,
                    height: 400,
                    date_taken: Some(now),
                    created_at: now,
                    thumbnail_path: None,
                    processing_status: "pending".to_string(),
                    histogram_json: None,
                }
            })
            .collect();

        for chunk in initial_records.chunks(500) {
            if let Err(e) = db.insert_photos_batch(chunk) {
                eprintln!("[Database Error] Failed to insert photos batch: {}", e);
            }
        }

        // Seed the first page of actual persisted DB photo IDs into the priority queue
        if let Ok(missing) = db.get_photos_missing_thumbnails_in_folder(&folder_id) {
            let first_page_ids: Vec<String> = missing.into_iter().take(36).map(|r| r.id).collect();
            worker_control.prioritize(first_page_ids);
        }

        ensure_background_worker(app, db, pipeline, ml, worker_control, folder_id);

        Ok(folder)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_photos_in_folder(
    app: AppHandle,
    state: State<'_, AppState>,
    folder_id: String,
) -> Result<Vec<CombinedPhotoData>, String> {
    let db = state.db.clone();
    let pipeline = state.image_pipeline.clone();
    let worker_control = state.worker_control.clone();
    let ml = state.ml_engine.clone();
    let folder_id_clone = folder_id.clone();

    let (photos, has_missing_thumbs, has_pending) = tokio::task::spawn_blocking(move || {
        let mut photos = db
            .get_photos_in_folder(&folder_id_clone)
            .map_err(|e| e.to_string())?;

        println!(
            "[Catalog] Loaded {} photos for folder {}",
            photos.len(),
            folder_id_clone
        );

        // Verify thumbnail files exist on disk as valid cached JPEGs (or recover/migrate from cache dir)
        let mut stale_ids = Vec::new();
        let cache_dir = pipeline.get_cache_dir();
        for item in &mut photos {
            let valid_existing = item
                .photo
                .thumbnail_path
                .as_ref()
                .map(|p| !p.is_empty() && pipeline.is_valid_cached_thumb(Path::new(p)))
                .unwrap_or(false);

            if !valid_existing {
                let cache_jpg = cache_dir.join(format!("{}_thumb.jpg", item.photo.id));
                if pipeline.is_valid_cached_thumb(&cache_jpg) {
                    item.photo.thumbnail_path = Some(cache_jpg.to_string_lossy().to_string());
                } else {
                    if item.photo.thumbnail_path.is_some() {
                        stale_ids.push(item.photo.id.clone());
                    }
                    item.photo.thumbnail_path = None;
                }
            }
        }

        if !stale_ids.is_empty() {
            let _ = db.clear_missing_thumbnails(&stale_ids);
        }

        // Prioritize first visible page of photos that are still missing thumbnails
        let first_missing_thumb_ids: Vec<String> = photos
            .iter()
            .filter(|item| item.photo.thumbnail_path.is_none())
            .take(36)
            .map(|item| item.photo.id.clone())
            .collect();

        let has_missing_thumbs = photos.iter().any(|item| item.photo.thumbnail_path.is_none());

        if !first_missing_thumb_ids.is_empty() {
            worker_control.prioritize(first_missing_thumb_ids);
        }

        let has_pending = db
            .get_pending_photos_in_folder(&folder_id_clone)
            .map(|p| !p.is_empty())
            .unwrap_or(false);

        Ok::<_, String>((photos, has_missing_thumbs, has_pending))
    })
    .await
    .map_err(|e| e.to_string())??;

    if has_missing_thumbs || has_pending {
        ensure_background_worker(
            app,
            state.db.clone(),
            state.image_pipeline.clone(),
            ml,
            state.worker_control.clone(),
            folder_id,
        );
    }

    Ok(photos)
}

#[derive(serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ThumbnailBatchItem {
    pub id: String,
    pub file_path: String,
}

#[tauri::command]
pub async fn get_thumbnails_batch(
    state: State<'_, AppState>,
    items: Vec<ThumbnailBatchItem>,
) -> Result<std::collections::HashMap<String, String>, String> {
    if items.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let pipeline = state.image_pipeline.clone();
    tokio::task::spawn_blocking(move || {
        let pairs: Vec<(String, String)> = items
            .into_par_iter()
            .filter_map(|item| {
                pipeline
                    .get_thumbnail_base64(&item.file_path, &item.id)
                    .map(|data_url| (item.id, data_url))
            })
            .collect();
        Ok(pairs.into_iter().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_sized_thumbnails_batch(
    state: State<'_, AppState>,
    items: Vec<ThumbnailBatchItem>,
    slot_px: u32,
) -> Result<std::collections::HashMap<String, String>, String> {
    if items.is_empty() {
        return Ok(std::collections::HashMap::new());
    }
    let pipeline = state.image_pipeline.clone();
    tokio::task::spawn_blocking(move || {
        let pairs: Vec<(String, String)> = items
            .into_par_iter()
            .filter_map(|item| {
                pipeline
                    .get_sized_thumbnail_base64(&item.file_path, &item.id, slot_px)
                    .map(|data_url| (item.id, data_url))
            })
            .collect();
        Ok(pairs.into_iter().collect())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn prioritize_thumbnails(
    app: AppHandle,
    state: State<'_, AppState>,
    photo_ids: Vec<String>,
) -> Result<(), String> {
    if photo_ids.is_empty() {
        return Ok(());
    }

    state.worker_control.prioritize(photo_ids);

    if let Some(active_folder_id) = state.worker_control.get_active_folder() {
        ensure_background_worker(
            app,
            state.db.clone(),
            state.image_pipeline.clone(),
            state.ml_engine.clone(),
            state.worker_control.clone(),
            active_folder_id,
        );
    } else {
        // Process priority thumbnails even if no active folder was previously set
        let app_clone = app.clone();
        let db = state.db.clone();
        let pipeline = state.image_pipeline.clone();
        let wc = state.worker_control.clone();
        if wc
            .worker_running
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
        {
            tokio::task::spawn_blocking(move || {
                drain_and_process_priority_thumbnails(&app_clone, &db, &pipeline, &wc);
                wc.worker_running.store(false, Ordering::SeqCst);
            });
        }
    }

    Ok(())
}

#[tauri::command]
pub async fn update_user_rating(
    state: State<'_, AppState>,
    photo_id: String,
    pick_status: String,
    star_rating: i32,
) -> Result<UserRating, String> {
    let db = state.db.clone();
    let ml = state.ml_engine.clone();
    tokio::task::spawn_blocking(move || {
        let rating = db
            .update_user_rating(&photo_id, &pick_status, star_rating)
            .map_err(|e| e.to_string())?;

        // Auto-retrain if we have enough samples and confirmed updates
        if let Ok(confirmed) = db.get_confirmed_training_data("local_onnx", "mobilenet_v3") {
            if confirmed.len() >= 10 {
                tokio::task::spawn_blocking(move || {
                    let mut guard = ml.lock().unwrap();
                    let _ = guard.retrain(&db);
                });
            }
        }

        Ok(rating)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
pub async fn get_histogram(
    state: State<'_, AppState>,
    image_path: String,
    photo_id: Option<String>,
) -> Result<HistogramData, String> {
    let db = state.db.clone();
    let pipeline = state.image_pipeline.clone();
    tokio::task::spawn_blocking(move || {
        // 1. Fast path: Check SQLite cache first for instant response
        if let Some(ref pid) = photo_id {
            if let Ok(Some(cached)) = db.get_cached_histogram(pid) {
                return Ok(cached);
            }
        }
        if let Ok(Some(cached)) = db.get_cached_histogram_by_path(&image_path) {
            return Ok(cached);
        }

        // 2. Slow path: Calculate from cached thumbnail or bounded preview & store in DB
        let hist = pipeline.calculate_histogram(&image_path, photo_id.as_deref());
        if let Some(ref pid) = photo_id {
            let _ = db.save_histogram(pid, &hist);
        }
        Ok(hist)
    })
    .await
    .map_err(|e| e.to_string())?
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
    state.worker_control.reset();
    state.db.clear_database().map_err(|e| e.to_string())
}

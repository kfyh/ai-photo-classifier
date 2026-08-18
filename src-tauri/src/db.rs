use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};

use rusqlite::{params, Connection, Result};

use crate::models::{
    AccuracyLog, AIPrediction, CombinedPhotoData, FolderRecord, PhotoExif, PhotoRecord, QualityMetrics, UserRating,
};

pub struct AppDatabase {
    conn: Arc<Mutex<Connection>>,
    db_path: PathBuf,
}

impl AppDatabase {
    pub fn new() -> Result<Self> {
        let app_dir = dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ai-photo-classifier");

        if !app_dir.exists() {
            let _ = fs::create_dir_all(&app_dir);
        }

        let db_path = app_dir.join("app.db");
        println!("[Database] Initializing SQLite database at: {:?}", db_path);

        let conn = Connection::open(&db_path)?;

        // Enable Write-Ahead Logging (WAL) and foreign keys
        conn.pragma_update(None, "journal_mode", "WAL")?;
        conn.pragma_update(None, "foreign_keys", "ON")?;

        let db = AppDatabase {
            conn: Arc::new(Mutex::new(conn)),
            db_path,
        };

        db.init_tables()?;
        Ok(db)
    }

    pub fn get_app_dir() -> PathBuf {
        dirs::config_dir()
            .unwrap_or_else(|| PathBuf::from("."))
            .join("ai-photo-classifier")
    }

    fn init_tables(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            CREATE TABLE IF NOT EXISTS folders (
                id TEXT PRIMARY KEY,
                path TEXT UNIQUE NOT NULL,
                name TEXT NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS photos (
                id TEXT PRIMARY KEY,
                folder_id TEXT NOT NULL,
                file_path TEXT UNIQUE NOT NULL,
                file_name TEXT NOT NULL,
                file_size INTEGER NOT NULL,
                width INTEGER NOT NULL,
                height INTEGER NOT NULL,
                date_taken INTEGER,
                created_at INTEGER NOT NULL,
                thumbnail_path TEXT,
                FOREIGN KEY(folder_id) REFERENCES folders(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS photo_exif (
                photo_id TEXT PRIMARY KEY,
                camera_make TEXT,
                camera_model TEXT,
                lens_model TEXT,
                iso INTEGER,
                aperture REAL,
                shutter_speed TEXT,
                focal_length REAL,
                exposure_bias REAL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS user_ratings (
                photo_id TEXT PRIMARY KEY,
                pick_status TEXT CHECK(pick_status IN ('pick', 'reject', 'unflagged')) DEFAULT 'unflagged',
                star_rating INTEGER CHECK(star_rating BETWEEN 0 AND 5) DEFAULT 0,
                is_confirmed BOOLEAN DEFAULT 0,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS quality_metrics (
                photo_id TEXT PRIMARY KEY,
                blur_score REAL,
                is_black_frame BOOLEAN,
                is_overexposed BOOLEAN,
                mean_luminance REAL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS photo_embeddings (
                photo_id TEXT NOT NULL,
                provider_type TEXT NOT NULL DEFAULT 'local_onnx',
                model_name TEXT NOT NULL DEFAULT 'mobilenet_v3',
                model_version TEXT NOT NULL,
                embedding BLOB NOT NULL,
                created_at INTEGER NOT NULL,
                PRIMARY KEY(photo_id, provider_type, model_name),
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS ai_predictions (
                photo_id TEXT PRIMARY KEY,
                provider_type TEXT NOT NULL DEFAULT 'local_onnx',
                model_name TEXT NOT NULL DEFAULT 'mobilenet_v3',
                predicted_pick TEXT CHECK(predicted_pick IN ('pick', 'reject', 'unflagged')),
                predicted_rating INTEGER CHECK(predicted_rating BETWEEN 0 AND 5),
                pick_confidence REAL,
                rating_confidence REAL,
                model_snapshot_id TEXT,
                updated_at INTEGER NOT NULL,
                FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
            );

            CREATE TABLE IF NOT EXISTS model_snapshots (
                id TEXT PRIMARY KEY,
                provider_type TEXT NOT NULL DEFAULT 'local_onnx',
                model_name TEXT NOT NULL DEFAULT 'mobilenet_v3',
                version INTEGER NOT NULL,
                trained_samples_count INTEGER NOT NULL,
                pick_weights_blob BLOB NOT NULL,
                rating_weights_blob BLOB NOT NULL,
                created_at INTEGER NOT NULL
            );

            CREATE TABLE IF NOT EXISTS accuracy_logs (
                id TEXT PRIMARY KEY,
                snapshot_id TEXT NOT NULL,
                timestamp INTEGER NOT NULL,
                total_confirmed_photos INTEGER NOT NULL,
                pick_accuracy REAL NOT NULL,
                pick_precision REAL NOT NULL,
                pick_recall REAL NOT NULL,
                rating_accuracy REAL NOT NULL,
                rating_mae REAL NOT NULL,
                confusion_matrix_json TEXT NOT NULL,
                FOREIGN KEY(snapshot_id) REFERENCES model_snapshots(id)
            );
            ",
        )?;
        Ok(())
    }

    // --- Folder Queries ---
    pub fn get_folders(&self) -> Result<Vec<FolderRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.path, f.name, f.created_at, COUNT(p.id) as photo_count
             FROM folders f
             LEFT JOIN photos p ON p.folder_id = f.id
             GROUP BY f.id
             ORDER BY f.created_at DESC",
        )?;

        let folder_iter = stmt.query_map([], |row| {
            Ok(FolderRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                photo_count: Some(row.get(4)?),
            })
        })?;

        let mut folders = Vec::new();
        for folder in folder_iter {
            folders.push(folder?);
        }
        Ok(folders)
    }

    pub fn insert_folder(&self, folder: &FolderRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR IGNORE INTO folders (id, path, name, created_at) VALUES (?1, ?2, ?3, ?4)",
            params![folder.id, folder.path, folder.name, folder.created_at],
        )?;
        Ok(())
    }

    pub fn get_folder_by_path(&self, folder_path: &str) -> Result<Option<FolderRecord>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT f.id, f.path, f.name, f.created_at, COUNT(p.id) as photo_count
             FROM folders f
             LEFT JOIN photos p ON p.folder_id = f.id
             WHERE f.path = ?1
             GROUP BY f.id",
        )?;

        let mut folder_iter = stmt.query_map(params![folder_path], |row| {
            Ok(FolderRecord {
                id: row.get(0)?,
                path: row.get(1)?,
                name: row.get(2)?,
                created_at: row.get(3)?,
                photo_count: Some(row.get(4)?),
            })
        })?;

        if let Some(folder) = folder_iter.next() {
            Ok(Some(folder?))
        } else {
            Ok(None)
        }
    }

    // --- Photo Queries ---
    pub fn insert_photo(&self, photo: &PhotoRecord) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO photos (id, folder_id, file_path, file_name, file_size, width, height, date_taken, created_at, thumbnail_path)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                photo.id,
                photo.folder_id,
                photo.file_path,
                photo.file_name,
                photo.file_size,
                photo.width,
                photo.height,
                photo.date_taken,
                photo.created_at,
                photo.thumbnail_path,
            ],
        )?;

        let now = chrono_now_ms();
        conn.execute(
            "INSERT OR IGNORE INTO user_ratings (photo_id, pick_status, star_rating, is_confirmed, updated_at)
             VALUES (?1, 'unflagged', 0, 0, ?2)",
            params![photo.id, now],
        )?;
        Ok(())
    }

    pub fn update_photo_thumbnail(&self, photo_id: &str, thumbnail_path: &str) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "UPDATE photos SET thumbnail_path = ?1 WHERE id = ?2",
            params![thumbnail_path, photo_id],
        )?;
        Ok(())
    }

    pub fn insert_photo_exif(&self, exif: &PhotoExif) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO photo_exif (photo_id, camera_make, camera_model, lens_model, iso, aperture, shutter_speed, focal_length, exposure_bias)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                exif.photo_id,
                exif.camera_make,
                exif.camera_model,
                exif.lens_model,
                exif.iso,
                exif.aperture,
                exif.shutter_speed,
                exif.focal_length,
                exif.exposure_bias,
            ],
        )?;
        Ok(())
    }

    pub fn insert_quality_metrics(&self, quality: &QualityMetrics) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO quality_metrics (photo_id, blur_score, is_black_frame, is_overexposed, mean_luminance)
             VALUES (?1, ?2, ?3, ?4, ?5)",
            params![
                quality.photo_id,
                quality.blur_score,
                quality.is_black_frame as i32,
                quality.is_overexposed as i32,
                quality.mean_luminance,
            ],
        )?;
        Ok(())
    }

    pub fn insert_combined_photos_batch(&self, items: &[CombinedPhotoData]) -> Result<()> {
        let mut conn = self.conn.lock().unwrap();
        let tx = conn.transaction()?;
        let now = chrono_now_ms();

        {
            let mut stmt_photo = tx.prepare(
                "INSERT OR REPLACE INTO photos (id, folder_id, file_path, file_name, file_size, width, height, date_taken, created_at, thumbnail_path)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            )?;
            let mut stmt_rating = tx.prepare(
                "INSERT OR IGNORE INTO user_ratings (photo_id, pick_status, star_rating, is_confirmed, updated_at)
                 VALUES (?1, 'unflagged', 0, 0, ?2)",
            )?;
            let mut stmt_exif = tx.prepare(
                "INSERT OR REPLACE INTO photo_exif (photo_id, camera_make, camera_model, lens_model, iso, aperture, shutter_speed, focal_length, exposure_bias)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;
            let mut stmt_quality = tx.prepare(
                "INSERT OR REPLACE INTO quality_metrics (photo_id, blur_score, is_black_frame, is_overexposed, mean_luminance)
                 VALUES (?1, ?2, ?3, ?4, ?5)",
            )?;
            let mut stmt_ai = tx.prepare(
                "INSERT OR REPLACE INTO ai_predictions (photo_id, provider_type, model_name, predicted_pick, predicted_rating, pick_confidence, rating_confidence, model_snapshot_id, updated_at)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            )?;

            for item in items {
                let photo = &item.photo;
                stmt_photo.execute(params![
                    photo.id, photo.folder_id, photo.file_path, photo.file_name, photo.file_size,
                    photo.width, photo.height, photo.date_taken, photo.created_at, photo.thumbnail_path,
                ])?;
                stmt_rating.execute(params![photo.id, now])?;

                if let Some(ref exif) = item.exif {
                    stmt_exif.execute(params![
                        exif.photo_id, exif.camera_make, exif.camera_model, exif.lens_model,
                        exif.iso, exif.aperture, exif.shutter_speed, exif.focal_length, exif.exposure_bias,
                    ])?;
                }
                if let Some(ref quality) = item.quality {
                    stmt_quality.execute(params![
                        quality.photo_id, quality.blur_score, quality.is_black_frame as i32,
                        quality.is_overexposed as i32, quality.mean_luminance,
                    ])?;
                }
                if let Some(ref ai) = item.ai_prediction {
                    stmt_ai.execute(params![
                        ai.photo_id, ai.provider_type, ai.model_name, ai.predicted_pick,
                        ai.predicted_rating, ai.pick_confidence, ai.rating_confidence,
                        ai.model_snapshot_id, ai.updated_at,
                    ])?;
                }
            }
        }

        tx.commit()?;
        Ok(())
    }

    pub fn get_photos_in_folder(&self, folder_id: &str) -> Result<Vec<CombinedPhotoData>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT 
                p.id, p.folder_id, p.file_path, p.file_name, p.file_size, p.width, p.height, p.date_taken, p.created_at, p.thumbnail_path,
                e.camera_make, e.camera_model, e.lens_model, e.iso, e.aperture, e.shutter_speed, e.focal_length, e.exposure_bias,
                r.pick_status, r.star_rating, r.is_confirmed, r.updated_at,
                q.blur_score, q.is_black_frame, q.is_overexposed, q.mean_luminance,
                a.provider_type, a.model_name, a.predicted_pick, a.predicted_rating, a.pick_confidence, a.rating_confidence, a.model_snapshot_id, a.updated_at
             FROM photos p
             LEFT JOIN photo_exif e ON e.photo_id = p.id
             LEFT JOIN user_ratings r ON r.photo_id = p.id
             LEFT JOIN quality_metrics q ON q.photo_id = p.id
             LEFT JOIN ai_predictions a ON a.photo_id = p.id
             WHERE p.folder_id = ?1
             ORDER BY p.date_taken DESC, p.file_name ASC",
        )?;

        let photo_iter = stmt.query_map(params![folder_id], |row| {
            let photo_id: String = row.get(0)?;
            let photo = PhotoRecord {
                id: photo_id.clone(),
                folder_id: row.get(1)?,
                file_path: row.get(2)?,
                file_name: row.get(3)?,
                file_size: row.get(4)?,
                width: row.get(5)?,
                height: row.get(6)?,
                date_taken: row.get(7)?,
                created_at: row.get(8)?,
                thumbnail_path: row.get(9)?,
            };

            let camera_make: Option<String> = row.get(10)?;
            let exif = if camera_make.is_some() || row.get::<_, Option<String>>(11)?.is_some() {
                Some(PhotoExif {
                    photo_id: photo_id.clone(),
                    camera_make,
                    camera_model: row.get(11)?,
                    lens_model: row.get(12)?,
                    iso: row.get(13)?,
                    aperture: row.get(14)?,
                    shutter_speed: row.get(15)?,
                    focal_length: row.get(16)?,
                    exposure_bias: row.get(17)?,
                })
            } else {
                None
            };

            let pick_status: Option<String> = row.get(18)?;
            let star_rating: Option<i32> = row.get(19)?;
            let is_confirmed: Option<i32> = row.get(20)?;
            let r_updated_at: Option<i64> = row.get(21)?;

            let user_rating = UserRating {
                photo_id: photo_id.clone(),
                pick_status: pick_status.unwrap_or_else(|| "unflagged".to_string()),
                star_rating: star_rating.unwrap_or(0),
                is_confirmed: is_confirmed.map(|v| v != 0).unwrap_or(false),
                updated_at: r_updated_at.unwrap_or_else(chrono_now_ms),
            };

            let blur_score: Option<f64> = row.get(22)?;
            let quality = if let Some(score) = blur_score {
                let is_black: i32 = row.get(23)?;
                let is_over: i32 = row.get(24)?;
                let mean_lum: f64 = row.get(25)?;
                Some(QualityMetrics {
                    photo_id: photo_id.clone(),
                    blur_score: score,
                    is_black_frame: is_black != 0,
                    is_overexposed: is_over != 0,
                    mean_luminance: mean_lum,
                })
            } else {
                None
            };

            let ai_provider: Option<String> = row.get(26)?;
            let ai_prediction = if let Some(provider) = ai_provider {
                Some(AIPrediction {
                    photo_id,
                    provider_type: provider,
                    model_name: row.get(27)?,
                    predicted_pick: row.get(28)?,
                    predicted_rating: row.get(29)?,
                    pick_confidence: row.get(30)?,
                    rating_confidence: row.get(31)?,
                    model_snapshot_id: row.get(32)?,
                    updated_at: row.get(33)?,
                })
            } else {
                None
            };

            Ok(CombinedPhotoData {
                photo,
                exif,
                user_rating,
                quality,
                ai_prediction,
            })
        })?;

        let mut photos = Vec::new();
        for photo in photo_iter {
            photos.push(photo?);
        }
        Ok(photos)
    }

    // --- Ratings Queries ---
    pub fn update_user_rating(
        &self,
        photo_id: &str,
        pick_status: &str,
        star_rating: i32,
    ) -> Result<UserRating> {
        let conn = self.conn.lock().unwrap();
        let now = chrono_now_ms();
        conn.execute(
            "INSERT OR REPLACE INTO user_ratings (photo_id, pick_status, star_rating, is_confirmed, updated_at)
             VALUES (?1, ?2, ?3, 1, ?4)",
            params![photo_id, pick_status, star_rating, now],
        )?;

        Ok(UserRating {
            photo_id: photo_id.to_string(),
            pick_status: pick_status.to_string(),
            star_rating,
            is_confirmed: true,
            updated_at: now,
        })
    }

    pub fn get_confirmed_ratings_count(&self) -> Result<i64> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT COUNT(*) FROM user_ratings WHERE is_confirmed = 1")?;
        let count: i64 = stmt.query_row([], |row| row.get(0))?;
        Ok(count)
    }

    pub fn get_confirmed_training_data(&self) -> Result<Vec<(String, String, i32)>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT photo_id, pick_status, star_rating FROM user_ratings WHERE is_confirmed = 1")?;
        let rows = stmt.query_map([], |row| {
            Ok((row.get(0)?, row.get(1)?, row.get(2)?))
        })?;

        let mut result = Vec::new();
        for r in rows {
            result.push(r?);
        }
        Ok(result)
    }

    // --- Predictions & Embeddings Queries ---
    pub fn save_prediction(&self, pred: &AIPrediction) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute(
            "INSERT OR REPLACE INTO ai_predictions 
             (photo_id, provider_type, model_name, predicted_pick, predicted_rating, pick_confidence, rating_confidence, model_snapshot_id, updated_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
            params![
                pred.photo_id,
                pred.provider_type,
                pred.model_name,
                pred.predicted_pick,
                pred.predicted_rating,
                pred.pick_confidence,
                pred.rating_confidence,
                pred.model_snapshot_id,
                pred.updated_at,
            ],
        )?;
        Ok(())
    }

    pub fn save_embedding(
        &self,
        photo_id: &str,
        provider_type: &str,
        model_name: &str,
        model_version: &str,
        embedding: &[f32],
    ) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let bytes: Vec<u8> = embedding.iter().flat_map(|f| f.to_ne_bytes()).collect();
        let now = chrono_now_ms();
        conn.execute(
            "INSERT OR REPLACE INTO photo_embeddings (photo_id, provider_type, model_name, model_version, embedding, created_at)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6)",
            params![photo_id, provider_type, model_name, model_version, bytes, now],
        )?;
        Ok(())
    }

    pub fn get_embedding(
        &self,
        photo_id: &str,
        provider_type: &str,
        model_name: &str,
    ) -> Result<Option<Vec<f32>>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare(
            "SELECT embedding FROM photo_embeddings 
             WHERE photo_id = ?1 AND provider_type = ?2 AND model_name = ?3",
        )?;

        let mut rows = stmt.query_map(params![photo_id, provider_type, model_name], |row| {
            let bytes: Vec<u8> = row.get(0)?;
            let floats: Vec<f32> = bytes
                .chunks_exact(4)
                .map(|b| f32::from_ne_bytes(b.try_into().unwrap()))
                .collect();
            Ok(floats)
        })?;

        if let Some(r) = rows.next() {
            Ok(Some(r?))
        } else {
            Ok(None)
        }
    }

    // --- Accuracy & Snapshots Queries ---
    pub fn save_accuracy_log(&self, log: &AccuracyLog) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        let json_matrix = serde_json::to_string(&log.confusion_matrix).unwrap_or_else(|_| "[]".to_string());
        conn.execute(
            "INSERT INTO accuracy_logs 
             (id, snapshot_id, timestamp, total_confirmed_photos, pick_accuracy, pick_precision, pick_recall, rating_accuracy, rating_mae, confusion_matrix_json)
             VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)",
            params![
                log.id,
                log.snapshot_id,
                log.timestamp,
                log.total_confirmed_photos,
                log.pick_accuracy,
                log.pick_precision,
                log.pick_recall,
                log.rating_accuracy,
                log.rating_mae,
                json_matrix,
            ],
        )?;
        Ok(())
    }

    pub fn get_accuracy_logs(&self) -> Result<Vec<AccuracyLog>> {
        let conn = self.conn.lock().unwrap();
        let mut stmt = conn.prepare("SELECT id, snapshot_id, timestamp, total_confirmed_photos, pick_accuracy, pick_precision, pick_recall, rating_accuracy, rating_mae, confusion_matrix_json FROM accuracy_logs ORDER BY timestamp ASC")?;
        let log_iter = stmt.query_map([], |row| {
            let json_str: String = row.get(9)?;
            let confusion_matrix: Vec<Vec<usize>> = serde_json::from_str(&json_str).unwrap_or_default();
            Ok(AccuracyLog {
                id: row.get(0)?,
                snapshot_id: row.get(1)?,
                timestamp: row.get(2)?,
                total_confirmed_photos: row.get(3)?,
                pick_accuracy: row.get(4)?,
                pick_precision: row.get(5)?,
                pick_recall: row.get(6)?,
                rating_accuracy: row.get(7)?,
                rating_mae: row.get(8)?,
                confusion_matrix,
            })
        })?;

        let mut logs = Vec::new();
        for log in log_iter {
            logs.push(log?);
        }
        Ok(logs)
    }

    pub fn clear_database(&self) -> Result<()> {
        let conn = self.conn.lock().unwrap();
        conn.execute_batch(
            "
            PRAGMA foreign_keys = OFF;
            DELETE FROM accuracy_logs;
            DELETE FROM model_snapshots;
            DELETE FROM ai_predictions;
            DELETE FROM photo_embeddings;
            DELETE FROM quality_metrics;
            DELETE FROM user_ratings;
            DELETE FROM photo_exif;
            DELETE FROM photos;
            DELETE FROM folders;
            PRAGMA foreign_keys = ON;
            ",
        )?;
        let _ = conn.pragma_update(None, "wal_checkpoint", "TRUNCATE");
        println!("[Database] Cleared all database tables successfully.");
        Ok(())
    }
}

fn chrono_now_ms() -> i64 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis() as i64)
        .unwrap_or(0)
}

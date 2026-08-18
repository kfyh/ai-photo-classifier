# Technical Implementation Specification: AI Photo Classifier (Tauri + Rust Version)

> **Document Version:** 2.0.0  
> **Status:** Approved for Implementation (Migrated from Electron to Tauri + Rust)  
> **Target Platforms:** Windows, macOS, Linux (Cross-Platform Desktop)  
> **Execution Mode:** Hybrid / Pluggable (100% Fully Offline Default with Optional Cloud ML Adapter Layer)  
> **Primary Technology Stack:** Rust, Tauri, React, Vite, TypeScript, SQLite, ONNX (via Rust ORT)

---

## 1. Executive Summary & Goals

### 1.1 Overview
The **AI Photo Classifier** is a high-performance, cross-platform desktop application modeled after professional digital asset management (DAM) tools such as Adobe Lightroom and Darktable. Its core purpose is to accelerate photographer culling workflows through personalized Machine Learning (ML) Transfer Learning, flexible model experimentation, and ergonomic multi-photo elimination comparison workflows.

### 1.2 Migration to Tauri
To resolve stability, threading, and compilation issues encountered with Node.js native addons (`sharp`, `better-sqlite3`, `lightdrift-libraw`) on Linux/GNOME, the desktop application shell is migrated from **Electron to Tauri v2**. 
* **Frontend:** Retains React + TypeScript + Vite.
* **Backend:** Rewritten in **Rust**, which handles database operations, multi-threaded image culling, EXIF parsing, and machine learning inference natively.
* **Resource Optimization:** Shrinks application memory footprint to ~30-50MB, download size to ~10-15MB, and replaces fragile multi-process child processes (`utilityProcess`) with standard Rust thread pools.

---

## 2. System Architecture

```
+-----------------------------------------------------------------------------------+
|                                 TAURI DESKTOP APP                                 |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |               RENDERER VIEWPORT (React + TS + Vite WebView)                 |  |
|  |                                                                             |  |
|  |  +----------------+  +------------------+  +------------------------------+ |  |
|  |  |   Grid View    |  |    Loupe View    |  | Multi-Compare Elimination    | |  |
|  |  +----------------+  +------------------+  +------------------------------+ |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  |                 AI Analytics & Stats Dashboard                        |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  | Keyboard Shortcut Engine (Lightroom Keybindings: P, X, U, 0-5, \, G,E,C) |  |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  +---------------------------------------|-------------------------------------+  |
|                                          | Tauri IPC Commands & Events            |
|  +---------------------------------------v-------------------------------------+  |
|  |                       TAURI CORE BACKEND (Rust App Shell)                    |  |
|  |                                                                             |  |
|  |  +-------------------+  +---------------------+  +------------------------+ |  |
|  |  | Local SQLite DB   |  | Rust Image Pipeline |  |  Pluggable ML Engine   | |  |
|  |  |    (rusqlite)     |  |   (image + exif)    |  |     Adapter Layer      | |  |
|  |  | - Photos & EXIF   |  | - WebP Thumbnails   |  |  +------------------+  | |  |
|  |  | - User Ratings    |  | - RGB Histograms    |  |  | Local ONNX (ort) |  | |  |
|  |  | - Embeddings Cache|  | - Quality Checkers  |  |  +------------------+  | |  |
|  |  | - Model Snapshots |  | - RawTherapee Sync  |  |  | Cloud ML (reqwest)|  | |  |
|  |  +-------------------+  +---------------------+  +------------------------+ |  |
|  +-----------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------+
```

### 2.1 Technology Stack & Rationale
* **Application Shell:** Tauri v2 (Rust Core). Tauri leverages the system's native WebView (WebKitGTK on Linux, WebView2 on Windows, WebKit on macOS), eliminating Chromium bloat.
* **Frontend UI Framework:** React (v18+) with TypeScript, bundled using Vite.
* **Styling & Design Tokens:** CSS Variables (Dark Theme design system) with Tailwind CSS and Lucide React icons.
* **State Management:** Zustand / Redux Toolkit for UI-level filters, grid states, and active comparison queues.
* **Local Database:** `rusqlite` (SQLite Rust bindings) running inside the Rust Core. Employs Write-Ahead Logging (WAL) and handles relational photo metadata, embeddings, and snapshots natively.
* **Image Processing Engine:** 
  * Rust [`image` crate](https://crates.io/crates/image) for cross-platform WebP thumbnail generation.
  * Rust [`kamadak-exif` crate](https://crates.io/crates/exif) for pure-Rust, high-performance EXIF extraction.
* **Pluggable ML Engine:** 
  * Rust [`ort` crate](https://crates.io/crates/ort) (ONNX Runtime bindings) for local MobileNetV3 and CLIP feature extraction.
  * Rust [`reqwest` crate](https://crates.io/crates/reqwest) for calling optional cloud endpoints (OpenAI, Anthropic, custom models).
* **Multi-Threading:** Rust [`rayon`](https://crates.io/crates/rayon) for parallel file scanning, quality pre-screening, and batch embedding extraction without UI blocking.

---

## 3. Database Schema & Local Storage Specification

SQLite database located at standard OS data paths (managed in Rust):
* **Linux:** `~/.config/ai-photo-classifier/app.db`
* **macOS:** `~/Library/Application Support/ai-photo-classifier/app.db`
* **Windows:** `%APPDATA%\ai-photo-classifier\app.db`

### 3.1 SQLite Schema (DDL)
Same structure as previously defined, initialized inside the Rust core on application startup:
```sql
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
    model_name TEXT NOT NULL,
    model_version TEXT NOT NULL,
    embedding BLOB NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY(photo_id, provider_type, model_name),
    FOREIGN KEY(photo_id) REFERENCES photos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_predictions (
    photo_id TEXT PRIMARY KEY,
    provider_type TEXT NOT NULL DEFAULT 'local_onnx',
    model_name TEXT NOT NULL,
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
    model_name TEXT NOT NULL,
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
```

---

## 4. Pluggable Machine Learning Engine (Rust Specification)

### 4.1 Rust Traits (`IMLEngineAdapter` Interface)
In Rust, the pluggable model adapter layer is structured using **traits** rather than TypeScript interfaces.

```rust
use serde::{Serialize, Deserialize};
use std::collections::HashMap;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelMetadata {
    pub id: String,
    pub name: String,
    pub provider_type: String, // "local_onnx", "cloud_openai", etc.
    pub embedding_dim: usize,
    pub requires_api_key: bool,
    pub is_offline_capable: bool,
}

pub trait FeatureExtractorAdapter: Send + Sync {
    fn metadata(&self) -> ModelMetadata;
    fn initialize(&mut self, config: Option<serde_json::Value>) -> Result<(), String>;
    fn extract_embedding(&self, image_path: &str) -> Result<Vec<f32>, String>;
    fn batch_extract_embeddings(&self, image_paths: &[String]) -> Result<HashMap<String, Vec<f32>>, String>;
}

pub trait TransferLearningHeadAdapter: Send + Sync {
    fn train_head(
        &self,
        embeddings: &[Vec<f32>],
        labels: &[UserRatingLabel],
        quality: &[QualityMetrics]
    ) -> Result<ModelSnapshot, String>;

    fn predict(
        &self,
        embedding: &[f32],
        quality: &QualityMetrics
    ) -> Result<PredictionResult, String>;
}
```

### 4.2 Local ONNX Execution via Rust `ort`
* **MobileNetV3-Small & CLIP ViT-B/32:** Pre-trained feature extractor `.onnx` models are loaded dynamically by the Rust core backend using the `ort` crate.
* GPU/NPU acceleration is configured natively using DirectML (Windows), CoreML (macOS), or TensorRT/CUDA (Linux) if available.
* Extracted embedding vectors are written directly as binary `BLOB`s to the SQLite table.

---

## 5. View Modes & Frontend IPC Command Contract

### 5.1 Tauri commands (Rust Backend Handler Hooks)
The frontend communicates with Rust using **Tauri commands** (IPC). Here are the primary hooks:

```rust
#[tauri::command]
async fn select_folder() -> Result<Option<FolderRecord>, String> {
    // Spawns native OS dialog to select directory
}

#[tauri::command]
async fn import_folder(folder_path: String) -> Result<FolderRecord, String> {
    // Triggers background scanning, EXIF parsing, thumbnail creation, and ML feature extraction.
    // Emits progressive Tauri events ("import-progress") to update the frontend UI.
}

#[tauri::command]
async fn get_photos_in_folder(folder_id: String) -> Result<Vec<CombinedPhotoData>, String> {
    // Fetches photos joined with ratings, exif, quality metrics, and predictions.
}

#[tauri::command]
async fn update_user_rating(photo_id: String, pick_status: String, star_rating: i32) -> Result<UserRating, String> {
    // Saves rating to DB. Triggers ML auto-retraining if count is multiples of 10.
}

#[tauri::command]
async fn get_histogram(image_path: String) -> Result<HistogramData, String> {
    // Computes Red, Green, Blue, and Luma distributions from the cached thumbnail.
}

#[tauri::command]
async fn export_rawtherapee(photo_path: String, rating: i32, pick_status: String) -> Result<String, String> {
    // Synchronizes ratings to RawTherapee PP3 sidecar files and XMP files natively.
}
```

### 5.2 Elimination Compare View (`C`)
* Same interface workflow: N-up grid layout.
* **Synchronized Zoom & Pan:** Implemented in WebGL/HTML5 Canvas on the frontend. Moving or zooming any image synchronizes coordinates across all other active compare cards.
* **Elimination:** User hits `\` or `Delete`, sending a local state update to remove the image card. The canvas layout automatically scales up the remaining images.

---

## 6. Ergonomic Keyboard Shortcuts
No changes from the original specification. All culling shortcuts (`P`, `X`, `U`, `0`-`5`, `\`, `C`, `G`, `E`, `S`, `Space`, Arrows) listen globally on the window element in the React app.

---

## 7. Performance & Native Metadata Sync

### 7.1 Multi-Threaded Rust Processing Pipeline
Rather than relying on Node worker processes, the Rust core utilizes:
1. **Rayon Parallel Iterators:** Splits directory scanning, thumbnail creation (via `image::thumbnail`), and EXIF extraction across all available CPU cores.
2. **Tauri Progress Events:** Rust background tasks emit JSON progress payloads back to the frontend:
   ```json
   { "event": "import-progress", "payload": { "folderId": "f123", "current": 25, "total": 100 } }
   ```

### 7.2 Native Metadata Export (RawTherapee & XMP)
Implemented directly in Rust within a native file exporter module:
* **RawTherapee Exporter:** Creates/modifies a `[photo_name].[ext].pp3` text file. Updates or appends:
  * `[Rank]` $\rightarrow$ `Rank=[0-5]`
  * `[ColorLabel]` $\rightarrow$ `ColorLabel=[1 for reject, 3 for pick, 0 for unflagged]`
* **XMP Exporter:** Writes a simple XML sidecar mapping standard ratings (`xmp:Rating`) and color tags (`xmp:Label`).

---

## 8. Implementation Roadmap (Tauri Version)

| Phase | Milestone | Key Deliverables |
| :--- | :--- | :--- |
| **Phase 1** | Project Boot & SQLite | Scaffolding Tauri v2 + React UI. Implement Rust `rusqlite` database layer & schema initialization. |
| **Phase 2** | Parallel Scan & Thumbnail | Rust folder scanner utilizing `rayon`. Implement image thumbnail pipeline (WebP output) and EXIF extraction. |
| **Phase 3** | Hotkey Views & Sync | Port React Virtual Grid, Loupe view with canvas zoom, and **Elimination Compare View**. Implement native RawTherapee `.pp3`/`.xmp` file writing. |
| **Phase 4** | Rust ML & ONNX Core | Setup `ort` crate. Add local feature extraction and background logistic regression classifier head in Rust. |
| **Phase 5** | AI Guidance & UI | Port AI Stats dashboard, confusion matrix visualization, and active model selector interface. |
| **Phase 6** | Polish, Packaging & Metadata Sync | Build native cross-platform bundles (`.msi` for Windows, `.dmg` for macOS, `.deb`/`AppImage` for Linux). |

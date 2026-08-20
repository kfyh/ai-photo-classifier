# Database & Storage Specification

> **Module:** Local SQLite Storage, Schema DDL & Sidecar Exporters  
> **Status:** Active / Implemented  
> **Backend Implementation:** Rust (`src-tauri/src/db.rs`, `src-tauri/src/exporters.rs`)

---

## 1. Local Database Storage Locations

The application operates 100% locally with zero required cloud connectivity. Relational data, embeddings, and snapshots are stored in an embedded SQLite database managed via `rusqlite` (with Write-Ahead Logging `WAL` enabled):

* **Linux:** `~/.config/ai-photo-classifier/app.db`
* **macOS:** `~/Library/Application Support/ai-photo-classifier/app.db`
* **Windows:** `%APPDATA%\ai-photo-classifier\app.db`
* **Thumbnail Cache Directory:** `<AppConfigDir>/cache/` (e.g. `~/.config/ai-photo-classifier/cache/<photo_id>_thumb.webp`)

---

## 2. Relational Database Schema (DDL)

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

## 3. Metadata Sidecar Exporters

Implemented in Rust ([`src-tauri/src/exporters.rs`](file:///workspace/src-tauri/src/exporters.rs)) to synchronize confirmed ratings directly with professional RAW processing tools.

### 3.1 RawTherapee Sidecar (`.pp3`) Exporter
Generates or updates `<photo_path>.pp3`:
* Sets `[Rank]` section $\rightarrow$ `Rank=<0-5>`
* Sets `[ColorLabel]` section $\rightarrow$ `ColorLabel=<3 for Pick, 1 for Reject, 0 for Unflagged>`

### 3.2 Adobe XMP Sidecar (`.xmp`) Exporter *(Added in v2.0)*
Introduced in version 2.0 alongside the Tauri + Rust migration to support universal DAM ecosystems (Adobe Lightroom, Darktable, Capture One, DigiKam). Generates standard XML sidecar `<photo_stem>.xmp`:
```xml
<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="4"
    xmp:Label="Green"/>
 </rdf:RDF>
</x:xmpmeta>
```

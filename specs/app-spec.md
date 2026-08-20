# Technical Implementation Specification: AI Photo Classifier (Tauri + Rust)

> **Document Version:** 2.0.0  
> **Status:** Active / Implemented (Tauri v2 + Rust Architecture)  
> **Target Platforms:** Linux, macOS, Windows (Cross-Platform Desktop DAM)  
> **Execution Mode:** 100% Offline-Capable Default with Pluggable Cloud ML Adapters  
> **Core Stack:** Rust (Tauri v2 Core), React (v18+), TypeScript, Vite, Tailwind CSS, SQLite (`rusqlite`), ONNX (`ort`)

---

## 1. Executive Summary & Goals

The **AI Photo Classifier** is a high-performance, cross-platform desktop application modeled after professional digital asset management (DAM) tools such as Adobe Lightroom and Darktable. Its core purpose is to accelerate photographer culling workflows through personalized Machine Learning (ML) Transfer Learning, flexible model experimentation, and ergonomic multi-photo elimination comparison workflows.

### 1.1 Architecture & Performance Pillars
* **Native Rust Backend**: Eliminates Node.js native addon instability and Chromium bloat by running database management, multi-threaded image culling, EXIF parsing, and machine learning inference directly inside the Tauri Rust core.
* **Ultra-Low Resource Footprint**: Shrinks application memory footprint to ~30–50MB and startup time to $<200\text{ms}$.
* **Sub-50ms Rapid Ingestion**: Staged two-phase image scanning utilizes embedded EXIF thumbnails for instantaneous grid population.
* **Ergonomic Keyboard Culling**: Global single-key Lightroom shortcuts (`P`, `X`, `U`, `0`–`5`, `\`, `G`, `E`, `C`, `S`) for uninterrupted flow.

---

## 2. Specification Hierarchy & Modular Index

This master specification defines the top-level architecture and IPC contracts. Detailed subsystem implementations are specified in dedicated modular documents:

| Specification Module | File Path | Focus Area |
| :--- | :--- | :--- |
| **Product & User Stories** | [`user-story.md`](file:///workspace/specs/user-story.md) | Photographer workflows, 3-state taxonomy (`Pick`/`Neutral`/`Reject`), view user stories |
| **Image Pipeline & Rendering** | [`image-processing-and-render.md`](file:///workspace/specs/image-processing-and-render.md) | 2-phase scanning, WebP thumbnail caching, EXIF parser, blur/luma metrics, histograms |
| **User Interface & Hotkeys** | [`ui.md`](file:///workspace/specs/ui.md) | Viewports (Grid, Loupe, Compare, Stats), collapsible sidebars, hotkey engine |
| **AI Learning & Suggestions** | [`ai-learning-and-suggesting.md`](file:///workspace/specs/ai-learning-and-suggesting.md) | Pluggable ONNX/Cloud models, vector augmentation ($D=515$), online retraining loop |
| **Database & Sidecar Storage** | [`database-and-storage.md`](file:///workspace/specs/database-and-storage.md) | Relational SQLite DDL schema, RawTherapee `.pp3` & Adobe `.xmp` exporters |

---

## 3. High-Level System Architecture

```
+-----------------------------------------------------------------------------------+
|                                 TAURI DESKTOP APP                                 |
|                                                                                   |
|  +-----------------------------------------------------------------------------+  |
|  |               RENDERER VIEWPORT (React + TS + Vite WebView)                 |  |
|  |                                                                             |  |
|  |  +----------------+  +------------------+  +------------------------------+ |  |
|  |  |   Grid View    |  |    Loupe View    |  | Multi-Compare Elimination    | |  |
|  |  |   (Overview)   |  |  (High-Res Loupe)|  |      (Burst Culling)         | |  |
|  |  +----------------+  +------------------+  +------------------------------+ |  |
|  |  +-----------------------------------------------------------------------+  |  |
|  |  |                 AI Analytics & Disagreement Dashboard                 |  |  |
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

---

## 4. Tauri IPC Command Contract Matrix

The React frontend interacts with the Rust core backend via asynchronous Tauri IPC commands defined in [`src-tauri/src/commands.rs`](file:///workspace/src-tauri/src/commands.rs):

| Tauri Command | Input Parameters | Return Type | Description |
| :--- | :--- | :--- | :--- |
| `select_folder` | *None* | `Option<FolderRecord>` | Opens native OS folder picker dialog and registers folder |
| `get_folders` | *None* | `Vec<FolderRecord>` | Returns all tracked shoot folders |
| `import_folder` | `folder_path: String` | `FolderRecord` | Spawns background two-phase scan; emits `import-progress` |
| `get_photos_in_folder` | `folder_id: String` | `Vec<CombinedPhotoData>` | Fetches photos joined with EXIF, ratings, metrics, and AI predictions |
| `update_user_rating` | `photo_id: String, pick_status: String, star_rating: i32` | `UserRating` | Updates rating in DB; auto-triggers ML retrain on multiples of 10 |
| `get_histogram` | `image_path: String, photo_id: Option<String>` | `HistogramData` | Calculates 256-bin RGB and Luma distributions |
| `export_rawtherapee` | `photo_path: String, rating: i32, pick_status: String` | `String` | Writes RawTherapee `.pp3` and Adobe `.xmp` sidecar metadata |
| `get_active_model` | *None* | `MLModelOption` | Returns currently active ML feature extractor model |
| `set_active_model` | `model_id: String` | `MLModelOption` | Switches active model adapter (MobileNetV3, CLIP, Cloud Vision) |
| `retrain_ai` | *None* | `RetrainResult` | Forces immediate manual online retrain of logistic regression head |
| `get_accuracy_logs` | *None* | `Vec<AccuracyLog>` | Returns historical retraining metrics and confusion matrices |
| `clear_database` | *None* | `bool` | Clears all cached thumbnails, database tables, and predictions |

---

## 5. Tauri Background Event Streams

| Event Name | Payload Format | Source | Description |
| :--- | :--- | :--- | :--- |
| **`import-progress`** | `{ folder_id: string, current: number, total: number, photo: CombinedPhotoData }` | Rust Background Task | Streams freshly generated thumbnails and metadata to UI in real time |
| **`import-complete`** | `{ folderId: string, total: number }` | Rust Background Task | Signals completion of deep metadata analysis and AI extraction |

# Image Processing & Rendering Specification

> **Module:** Core Image Pipeline & Viewport Rendering  
> **Status:** Active / Implemented  
> **Backend Implementation:** Rust (`src-tauri/src/image_pipeline.rs`, `src-tauri/src/commands.rs`, `src-tauri/src/db.rs`, `src-tauri/src/ml/`)  
> **Frontend Viewports:** React + TypeScript (`src/components/GridView.tsx`, `src/components/Filmstrip.tsx`, `src/components/LoupeView.tsx`, `src/components/CompareView.tsx`, `src/components/BlinkiesOverlay.tsx`)

---

## 1. Overview & Architecture

The image processing pipeline is designed to handle thousands of images without exhausting system memory or blocking the UI. The highest priority is ensuring the user can immediately view thumbnails, navigate viewports, and perform classifications. Heavy processing—such as extended metadata extraction, histogram computation, and AI classification—runs strictly as secondary, low-priority background tasks with bounded concurrency and disk persistence.

```
+-----------------------------------------------------------------------------------+
|                            IMAGE PROCESSING PIPELINE                              |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  Stage 1: Instant File Discovery & Catalog Pre-Registration [Implemented]         |
|  Directory Scan (rayon) -> 500-Item Atomic SQLite Batch Insert -> Instant Catalog |
|                                                                                   |
|  Stage 2: Viewport-First & Progressive Thumbnail Generation [Implemented]           |
|  Visible Page Priority -> Fast 400px JPEG -> Slot-Matched Progressive JPEG (Q88)    |
|                                                                                   |
|  Stage 3: Low-Priority Background Processing [Implemented]                        |
|  Throttled Worker Queue -> EXIF & Histograms -> ML Predictions -> Batch DB Save   |
|                                                                                   |
|  Stage 4: Memory-Safe Viewport & Canvas Rendering [Implemented]                   |
|  Transform-Windowed Grid Pool + Prefetch -> Full-Res Loupe -> On-Demand Blinkies  |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Prioritized Ingestion & Thumbnail Pipeline

### 2.1 Stage 1: Instant Discovery (Filenames & Basic Metadata First)
To make the catalog immediately interactive when opening large shoots (thousands of images):
1. **Fast Directory Scanning (`Implemented`)**: `ImagePipeline::scan_folder` scans for supported formats in parallel using `rayon::prelude::*`.
2. **Atomic Batch Pre-Registration (`Implemented`)**: `import_folder` inspects file headers in parallel (`inspect_file_header_fast`) and pre-inserts discovered files with `processing_status = 'pending'` in 500-item SQLite transactions (`AppDatabase::insert_photos_batch`, $<15\text{ms}$ for 3,000 files) with SQLite `WAL` mode enabled.
3. **Immediate Catalog Availability (`Implemented`)**: `import_folder` and `get_photos_in_folder` return the initial catalog records and basic file/header metadata to the frontend immediately so the user can see the grid layout and begin navigating before full folder thumbnail generation completes.

### 2.2 Stage 2: Viewport-First & Progressive Slot-Sized Thumbnail Generation
Thumbnails are generated and cached to disk in two progressive tiers, prioritizing what the user is currently viewing:
1. **Fast Embedded EXIF / 400px JPEG (`Implemented`)**: `ImagePipeline::try_extract_embedded_thumbnail` and `generate_thumbnail_fast_exif_only` read container tags `Tag::JPEGInterchangeFormat` / `Tag::JPEGInterchangeFormatLength` (or scan RAW/TIFF headers) to extract embedded JPEG previews ($<1\text{ms}$, $<100\text{KB}$ RAM), caching them as `<photo_id>_thumb.jpg` in `~/.config/ai-photo-classifier/cache/` (migrating legacy `.webp` cache entries automatically). Served to the frontend via `get_thumbnails_batch` (`data:image/jpeg;base64,...`).
2. **Progressive Slot-Matched JPEG (`Implemented`)**: `ImagePipeline::get_sized_thumbnail_base64` (exposed via `get_sized_thumbnails_batch`) generates and caches `<photo_id>_thumb_<slot_px>.jpg` (clamped `128..=2048`, JPEG quality `88`) sized via `target_long_edge_for_cover_slot` so the shorter edge is at least `slot_px` (preventing `object-cover` upscaling). Reuses large embedded previews when sufficient, otherwise performs a bounded decode.
3. **Visible Page Priority (`Implemented`)**: `GridView.tsx` and `Filmstrip.tsx` invoke `prioritize_thumbnails(photo_ids: Vec<String>)` for the currently visible viewport page (plus a lookahead buffer). `WorkerControlState` places visible photo IDs at the front of the priority queue and preempts sequential/background work so visible thumbnails always generate and emit first.
4. **Bounded Fallback Decoding (`Implemented`)**: When an image lacks an embedded EXIF thumbnail and requires full decoding (`ImageReader::decode`), `ImagePipeline` acquires a permit from `DecodeSemaphore` (`MAX_CONCURRENT_FULL_DECODES = 3`), immediately downsamples to the target dimension, and drops the full-resolution buffer before releasing the permit so 45MP files never spike RAM.

### 2.3 Stage 3: Throttled Low-Priority Background Processing & Disk Persistence
To prevent the app from getting stuck processing images or running out of memory on multi-thousand-image shoots:
1. **Cached-Thumbnail Analysis (`Implemented`)**: `process_photo_single_pass` opens the cached $400\text{px}$ `.jpg` thumbnail ($<500\text{KB}$ RAM) rather than re-decoding full-resolution source files, and drops the image buffer immediately after histogram extraction.
2. **Atomic Batch Persistence & Batched IPC (`Implemented`)**: Background workers process in small chunks, persisting results atomically via `AppDatabase::update_photos_processed_batch` and emitting a single batched `import-progress` event (`photos: Some(batch)`) merged in `App.tsx` via an $O(1)$ `Map`.
3. **Resumable Pending Queue (`Implemented`)**: `get_photos_in_folder` checks `get_pending_photos_in_folder` and automatically resumes `ensure_background_worker` for unfinished items.
4. **Strict Single-Worker / Low-Priority Throttling (`Implemented`)**: `WorkerControlState::worker_running` (`AtomicBool`) guarantees only one background worker runs at a time, pivoting cleanly when the active folder changes and yielding (`12ms–35ms`) between small chunks so UI commands (`update_user_rating`, `get_histogram`, `prioritize_thumbnails`) execute with zero latency.

---

## 3. Deprecation of Objective Quality Metrics in Favor of Machine Learning

### 3.1 Rationale: Preserving Artistic Intentionality
Hardcoded mathematical defect rules frequently misclassify intentional creative choices:
* **Low Key & High Key Photography**: Intentional dark shadow moods or bright minimalist compositions are falsely flagged as underexposed/black frames or overexposed defects.
* **Intentional Motion Blur & Panning**: Creative shutter-drag and motion-blur techniques fail Laplacian edge variance checks.
* **Abstract & Selective Focus / Bokeh**: Shallow depth-of-field or abstract out-of-focus compositions are penalized by global sharpness metrics.

### 3.2 Removal & ML Decoupling (`Implemented`)
* Removed `calculate_quality_metrics_from_image` from the active processing pipeline (`image_pipeline.rs` / `commands.rs`).
* Decoupled `QualityMetrics` from `MLEngine::predict`, `FeatureExtractorAdapter::extract_embedding`, `LocalOnnxAdapter`, `CloudVisionAdapter`, and `LogisticRegressionHead::predict` so predictions rely purely on visual embeddings and learned user preferences.
* Removed objective quality defect badges/metrics from `RightSidebar.tsx` while keeping SQLite schema migrations backward-compatible (`quality: None`).

---

## 4. User-Driven Exposure Aids: Histograms & "Blinkies"

Rather than automatic defect flagging, exposure analysis is provided as visual feedback tools under the user's control:

### 4.1 RGB & Luminance Histogram Engine (`Implemented`)
* Histograms are computed on downsampled buffers in Rust (`calculate_histogram_from_image`) with 256-bin counts for Red, Green, Blue, and Luminance ($L = 0.299R + 0.587G + 0.114B$).
* Cached in SQLite (`photos.histogram_json`) and retrieved via `get_histogram` (`get_cached_histogram` fast-path) for SVG rendering in [`HistogramWidget.tsx`](file:///workspace/src/components/HistogramWidget.tsx).

### 4.2 Highlight & Shadow Clipping Overlay ("Blinkies") (`Implemented`)
* **Optional User Toggle**: [`LoupeView.tsx`](file:///workspace/src/components/LoupeView.tsx) and [`CompareView.tsx`](file:///workspace/src/components/CompareView.tsx) provide a "Blinkies (B)" toggle button (and `B` keyboard shortcut) backed by [`BlinkiesOverlay.tsx`](file:///workspace/src/components/BlinkiesOverlay.tsx) to visually highlight pure clipped highlights ($R, G, \text{or } B \ge 250$ or $L \ge 250$ in red/magenta) and crushed shadows ($L \le 5$ in cyan/blue) on an HTML5 `<canvas>` matched to the image bounds.
* **Disabled by Default / Respecting User Selection**: Blinkies are off by default, never activate automatically when selecting or classifying an image, and incur zero CPU/memory overhead when toggled off.

---

## 5. Viewport Rendering & Memory Management

### 5.1 Grid View & Filmstrip Rendering with Transform Windowing (`Implemented`)
* **Transform-Positioned DOM Pool (`GridView.tsx`)**: Computes `columns`, `cellSize`, and `rowStride` from container `clientWidth`/`clientHeight` and `gridSize`, syncing CSS `gridTemplateColumns` to `repeat(columns, minmax(0, 1fr))`. Renders visible rows plus `OVERSCAN_ROWS = 4` above/below inside a fixed-height `relative` wrapper (`totalContentHeight`) using `overflowAnchor: 'none'` and `position: absolute; transform: translateY(...)` to eliminate layout reflow and browser scroll-anchoring snaps.
* **Off-Screen Prefetch & Zero-Flash Progressive Swap (`src/utils/image.ts`)**: `useResolvedThumbnails` schedules non-cancelling batch fetches over a `PREFETCH_EXTRA_ROWS = 3` buffer (ordered visible-first, then below, then above) using LRU caches (`thumbDataUrlCache` max 1000, `sizedThumbCache` max 500). Slot-matched thumbnails are pre-decoded off-screen (`new Image().decode()`) and rendered as an overlay `<img>` (`getSizedPhotoSrc`) on top of the fast thumbnail `<img>` (`getPhotoSrc`) so upgrading resolution never flashes.
* **Filmstrip Windowing (`Filmstrip.tsx`)**: Virtualizes the horizontal filmstrip using `scrollLeft`, `clientWidth`, and fixed item stride (`64px`) with left/right spacers so only items near the visible scroll window are mounted in the DOM.
* **Strict Thumbnail Binding (No Full-Res Fallback)**: Never binds full-resolution multi-megabyte source `file_path` URLs into small grid or filmstrip slots while a thumbnail is still generating; renders a lightweight skeleton spinner placeholder until the cached JPEG thumbnail arrives.

### 5.2 Loupe View Rendering (`Implemented`)
* Center-aligned viewport with `scale(1)` (Fit View) and `scale(2.5)` (100% Zoom) toggle modes.
* Loads the actual full-resolution image via `getFullImageSrc(photo.file_path)` (`convertFileSrc`) with a loading spinner overlay (`"Loading full-resolution image..."`), automatically falling back to the cached thumbnail preview (`getPhotoSrc` + `useResolvedThumbnails`) if the browser cannot natively decode the format (e.g., RAW/TIFF).
* Supports user-toggled **Blinkies** clipping overlay (`B` key), HUD info overlay (`I` key), and keyboard-driven rapid cycling (`ArrowLeft` / `ArrowRight`).

### 5.3 Compare View Synchronized Canvas Zoom & Pan (`Implemented`)
* **Adaptive N-Up Grid**: Dynamically computes CSS grid columns based on candidate count (2 candidates $\rightarrow$ 2-col, 4 candidates $\rightarrow$ $2 \times 2$, 6 candidates $\rightarrow$ $3 \times 2$).
* **Synchronized Zoom (`Z` key) & Blinkies (`B` key)**: Toggles unified zoom scale ($2.2\times$) and optional highlight/shadow clipping overlays across all candidate viewports.
* **Seamless Card Elimination**: Removing a candidate immediately redistributes canvas space to remaining candidates with smooth layout transitions.

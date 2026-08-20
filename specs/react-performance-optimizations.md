# Specification: React Performance Optimizations & Architecture Pitfalls

## 1. Overview & Context
This document outlines the current performance bottlenecks and architectural pitfalls identified when handling large photo shoots ($2,500$ to $50,000+$ photos) in the desktop application (Tauri + React + Rust). It details where the system experiences memory pressure, UI thread blocking, and inefficient state management, serving as a roadmap for future optimization initiatives.

---

## 2. Current Architectural Pitfalls

### Pitfall A: Monolithic In-Memory Array (`photos: CombinedPhotoData[]`)
* **Problem**: 
  * The entire shoot folder's dataset is currently held in a single flat React state array (`photos`) in [App.tsx](file:///workspace/src/App.tsx).
  * For a shoot with 5,000 photos, thousands of JavaScript objects containing nested metadata (`PhotoRecord`, `PhotoExif`, `UserRating`, `QualityMetrics`, `AIPrediction`, and `histogram_json`) reside permanently in the V8 heap.
* **Impact**:
  * High baseline memory footprint for the Webview process.
  * Frequent Garbage Collection (GC) pauses during sorting, filtering, and rating updates.
  * Array operations (e.g. searching, re-indexing, cloning on state updates) become proportionally slower as folder size increases.

---

### Pitfall B: Upfront Loading of Heavy Data (Histograms & EXIF)
* **Problem**:
  * SQLite `photos` and `photo_exif` queries include heavy fields:
    * `histogram_json`: 256-bin RGB + Luminance arrays ($1,024$ integers serialized as JSON text, $\sim 2\text{--}4\text{ KB}$ per photo).
    * Detailed EXIF structures ($9$ fields per photo).
  * Bulk queries like `get_photos_in_folder` serialize and transmit all histograms and EXIF data over Tauri IPC for *every photo in the shoot*, even though:
    * Histograms are only rendered for the **single currently selected photo** in the right sidebar.
    * Detailed EXIF is only inspected when opening the Loupe or sidebar details pane.
* **Impact**:
  * Multi-megabyte IPC payload transfers on folder open.
  * Unnecessary JSON serialization in Rust and deserialization in JavaScript.

---

### Pitfall C: Non-Virtual DOM Node Saturation & GPU Texture Retention
* **Problem**:
  * In un-virtualized grid view configurations, React attempts to mount thousands of DOM cards simultaneously.
  * Each photo card contains:
    * `<img />` tag with full or thumbnail URL.
    * Multiple badge containers, SVG icons (Lucide React), buttons, and interactive 5-star rating widgets.
* **Impact**:
  * $50,000+$ DOM nodes in the browser layout tree.
  * Webview browser engine retains decoded image textures in GPU VRAM for off-screen cards.
  * Layout calculations, hover state paints, and scroll rendering drop below 60 FPS.

---

### Pitfall D: High-Frequency IPC Event Streams Flooding React Loop
* **Problem**:
  * During background import / thumbnail processing, the Rust background worker emits progress events (`import-progress`).
  * If emitted on a per-image basis without batching or debounce thresholds:
    * React receives hundreds of IPC events per second.
    * Each event triggers a state setter, queuing a re-render cycle before the previous render has finished committing to the screen.
* **Impact**:
  * JavaScript main thread starvation, leading to the operating system reporting the application as "Not Responding / Frozen".

---

### Pitfall F: Display Resolution Mismatch & Full-Resolution Over-Decoding
* **Problem**:
  * Most photo culling and inspection workflows happen on 1080p, 1440p, or 4K screens.
  * Modern cameras produce 45MP to 60MP+ files ($8256 \times 5504$ pixels).
  * In Loupe and Compare views, loading the full-resolution file causes the browser/Webview to decode and rasterize the entire 45MP bitmap into GPU texture memory ($\sim 136\text{ MB}$ uncompressed RAM per photo), even though the display viewport only shows $\sim 1920 \times 1080$ ($\sim 2\text{ MP}$, requiring only $\sim 8\text{ MB}$ RAM).
* **Impact**:
  * Massive unnecessary memory consumption ($>90\%$ of decoded pixel data is discarded by downscaling at paint time).
  * Noticeable decode latency when navigating rapidly through photos with arrow keys in Loupe view.

---

## 3. Recommended Future Architecture Directions

1. **Tiered Image Pyramid (Multi-Resolution Caching)**:
   * **Stage 1 (Grid)**: Fast 400px WebP thumbnail ($\sim 15\text{ KB}$ disk, instant).
   * **Stage 2 (Loupe / Compare Preview)**: High-quality 2048px (2K/QHD) WebP preview ($\sim 200\text{--}400\text{ KB}$ disk, $\sim 8\text{ MB}$ RAM). Provides retina-sharp full-screen rendering with near-instant arrow key navigation.
   * **Stage 3 (100% Zoom / Pixel Peeping)**: Load and decode the original full-resolution RAW/JPEG only on explicit 100% zoom toggle (`Z` key), discarding it immediately when zooming back out.

2. **Lightweight Grid Summaries (Projection Queries)**:
   * Define a minimal `PhotoSummary` type for the Grid View:
     * Only essential fields: `id`, `file_name`, `thumbnail_path`, `pick_status`, `star_rating`, `ai_prediction`.
   * Strip `histogram_json`, `photo_exif`, and raw embeddings from grid queries.
   * Fetch heavy metadata on-demand via `getPhotoDetails(photoId)` only when a photo is selected.

3. **Full Windowed Virtualization**:
   * Implement strict row/grid virtualization (e.g. `react-window` or virtual masonry) to ensure only visible cards ($\sim 20\text{--}40$ items) exist in the DOM at any given instant.

4. **Paginated / Cursor-Based SQLite Fetching**:
   * Load photos in chunks (e.g. 200 items per page/batch) as the user scrolls, avoiding upfront multi-thousand array allocations.

5. **Throttled Batch IPC Pipeline**:
   * Maintain a bounded worker queue in Rust (e.g. 4–8 concurrent threads max) and emit progress in consolidated batches every $100\text{ms}$ or $48\text{ items}$.

6. **Normalized Client-Side State Cache**:
   * Transition from a flat array `photos[]` to an ID-indexed map (`entities: { [id: string]: PhotoSummary }`) or lightweight state store for $O(1)$ rating updates and multi-select mutations.

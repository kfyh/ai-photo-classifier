# Evaluation: PixiJS / HTML5 Canvas for Photo Viewport Rendering

> **Scope:** Rendering architecture evaluation for `GridView`, `LoupeView`, `CompareView`, and `Filmstrip`  
> **Current Stack:** Tauri v2 (Rust backend + WebKitGTK/WKWebView/WebView2) + React 18 + Tailwind CSS  
> **Reference Files:** `src/components/GridView.tsx`, `src/components/LoupeView.tsx`, `src/components/CompareView.tsx`, `src/components/BlinkiesOverlay.tsx`, `src/utils/image.ts`, `src-tauri/src/image_pipeline.rs`, `src-tauri/src/commands.rs`

---

## 1. Executive Summary

Using **PixiJS (WebGL2/WebGPU)** or **HTML5 2D `<canvas>`** inside the Tauri WebView can make photo scrolling, panning, zooming, and Blinkies shaders smoother, **but it introduces a 3-layer synchronization architecture (React ↔ Canvas/Pixi Scene Graph ↔ Rust)** and **does not by itself fix the primary image-transport bottleneck**.

- **If keeping Tauri + WebView:** Replacing `data:image/jpeg;base64,...` over JSON IPC with a **custom binary Tauri URI protocol** (e.g., `thumb://localhost/...`) delivers most of the decoding/flicker win at a fraction of the complexity.
- **Where PixiJS shines:** `LoupeView` and `CompareView` (smooth GPU pan/zoom, mipmapped downscaling, and a zero-CPU WebGL fragment shader for `BlinkiesOverlay`).
- **Where PixiJS adds heavy complexity:** `GridView`, where each card currently combines an image with interactive DOM controls (Pick/Reject buttons, 5-star rating widget, AI suggestion pill, filename truncation, selection borders).
- **Long-term alternative:** If you decide WebView itself is not the right host, migrating to a **pure-Rust GPU GUI (`iced` or `egui`)** eliminates the JS/WebView boundary altogether, rather than adding a third rendering engine (PixiJS) inside WebView.

---

## 2. Where the Bottleneck Actually Is Today

In the current implementation, every thumbnail in `GridView` traverses a heavy pipeline before reaching the screen:

1. **Rust (`image_pipeline.rs`):** Decodes/resizes JPEG and encodes to bytes.
2. **Rust → JS IPC (`commands.rs`):** Base64-encodes the JPEG (+33% payload size) and serializes a `HashMap<String, String>` over JSON IPC (`get_thumbnails_batch`, `get_sized_thumbnails_batch`).
3. **JS / WebView (`image.ts`):** Holds up to 1,000 base64 strings in `thumbDataUrlCache` and 500 in `sizedThumbCache`, parses `data:image/jpeg;base64,...`, and swaps DOM `<img>` layers.
4. **WebKitGTK (Linux):** WebKitGTK's `data:` URI image decoding and DOM rasterization are significantly slower than native GPU textures or binary HTTP/custom-protocol image streams.

**Key takeaway:** Moving `<img>` to a PixiJS `Sprite` still requires decoding JPEG bytes into a GPU texture (`createImageBitmap` / `HTMLImageElement` → `gl.texImage2D`). If images still arrive as base64 strings over JSON IPC, PixiJS will inherit the same IPC and base64 decode cost.

---

## 3. Comparison: Current DOM vs. HTML5 2D Canvas vs. PixiJS

| Dimension | Current React DOM (`GridView` + `transform`) | HTML5 2D `<canvas>` | PixiJS (WebGL2 / WebGPU) |
| :--- | :--- | :--- | :--- |
| **Scroll Performance** | Good when transform-windowed (`OVERSCAN_ROWS = 4`), but bound by DOM/WebKitGTK image rasterization. | High (single canvas, no DOM node churn), but `drawImage()` scales on CPU/2D compositor and lacks mipmaps. | Very high (60–120 FPS); GPU-composited sprites, hardware mipmapping (`TRILINEAR`) prevents moiré/shimmering on downscaled grids. |
| **Loupe Pan/Zoom & Blinkies** | CSS `transform: scale()` + `BlinkiesOverlay` CPU `getImageData()` pixel loop. | Manual pan/zoom math; Blinkies still requires CPU `getImageData()` or offscreen canvas. | Native GPU pan/zoom + **fragment shader Blinkies** (0ms CPU readback, works at full 60fps even while zooming/panning). |
| **Interactive Card UI** | Native HTML/Tailwind (`StarRating`, hover Pick/Reject buttons, AI pills, tooltips, accessibility). | Must hand-code hit-testing, hover states, text truncation, and cursor changes. | Same as 2D Canvas, **or** requires a synchronized DOM overlay layer on top of the canvas. |
| **Memory / VRAM Control** | Managed implicitly by browser (hard to force eviction on WebKitGTK). | Managed implicitly via `ImageBitmap` references. | Explicit (`texture.destroy(true)`) — great for bounding VRAM, but **leaks GPU memory immediately if missed**. |
| **Bundle / Runtime Overhead** | 0 extra dependencies. | 0 extra dependencies. | Adds PixiJS (~150–250KB+ minified) + WebGL context lifecycle & context-loss recovery. |

---

## 4. Complexity Analysis: React + PixiJS/Canvas + Rust

Introducing PixiJS creates a **three-layer architecture**:

1. **Rust Layer (Data, SQLite, Image Decode, ONNX ML):** Owns source files, disk cache, and background workers.
2. **React Layer (App State, Sidebars, Toolbar, Shortcuts, Modals):** Owns `photos: CombinedPhotoData[]`, `selectedPhotoId`, `selectedPhotoIds`, filters, and keyboard shortcuts.
3. **PixiJS / Canvas Layer (Imperative GPU Scene Graph):** Owns `PIXI.Application`, `Container`s, `Sprite`s, `Texture`s, and `Ticker` animations.

### Specific Complexity Costs
* **Imperative State Synchronization:** React is declarative; PixiJS is imperative. Every change to `photos` (background `import-progress` batches, rating updates, filter changes, `gridSize` slider changes) must be diffed and synced into PixiJS containers/sprites without recreating textures or stalling the frame budget.
* **The Hybrid Overlay Trap (in `GridView`):**
  * If you render **only** the photo thumbnails in PixiJS and keep the Pick/Reject/Star/AI/Selection UI in React DOM on top, you now have *two* coordinate systems that must stay pixel-aligned during scroll and resize — reintroducing scroll-sync jitter.
  * If you render **everything** (borders, badges, stars, filenames, buttons) inside PixiJS, you have to reimplement `StarRating`, hover pills, tooltips, font scaling, and text ellipsis in canvas/WebGL, duplicating UI logic already built in Tailwind + Lucide.
* **Texture Upload Stalls & VRAM Limits:** Uploading 24+ JPEGs to WebGL textures synchronously in one frame causes frame drops. You need an async `createImageBitmap` queue (off-main-thread decode) + time-sliced GPU uploads (e.g., max 2–4 texture uploads per `requestAnimationFrame`) + an explicit LRU texture cache calling `texture.destroy(true)`.
* **WebKitGTK WebGL2 Quirks:** On Linux Tauri builds, WebGL2 behavior depends on GPU drivers and WebKitGTK's ANGLE/EGL backend; software-rendered WebGL fallback can perform worse than standard 2D DOM compositing.

---

## 5. Verdict & Recommended Path

### Option A: Fix Image Transport First (Keep React DOM) — **Recommended First Step**
Before introducing PixiJS, replace base64 JSON IPC (`get_thumbnails_batch` / `get_sized_thumbnails_batch`) with a **custom Tauri URI scheme** (e.g., `thumb://localhost/{photo_id}/{slot_px}`) that streams raw `image/jpeg` bytes directly from `ImagePipeline` with `Cache-Control` headers.
* **Complexity:** Low (isolated to Rust protocol handler + `src/utils/image.ts`).
* **Impact:** Eliminates base64 encoding/decoding and JSON serialization overhead across `GridView`, `Filmstrip`, and `CompareView`.

### Option B: Targeted PixiJS / WebGL for `LoupeView` & `CompareView` Only
If you want GPU-grade pan/zoom and real-time Blinkies without rewriting `GridView`'s interactive cards:
* Use a WebGL/PixiJS viewport **only** in `LoupeView` (and optionally `CompareView`), where there is only 1–6 images, no card-level Star/Pick DOM grid, and high value from smooth zoom/pan + a Blinkies fragment shader.
* Keep `GridView` in React DOM (fed by Option A's binary protocol).

### Option C: Full Native Rust UI (Skip PixiJS-in-WebView)
If you eventually outgrow WebView (especially WebKitGTK on Linux), **do not** invest heavily in a React + PixiJS hybrid. Migrate the UI directly to a **pure-Rust GPU GUI (`iced` or `egui` on `wgpu`)**, which gives you native GPU texture atlases, zero IPC serialization, and a single language/memory space across the image pipeline, ML engine, and UI.

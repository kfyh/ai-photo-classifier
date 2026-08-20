# Image Processing & Rendering Specification

> **Module:** Core Image Pipeline & Viewport Rendering  
> **Status:** Active / Implemented  
> **Backend Implementation:** Rust (`src-tauri/src/image_pipeline.rs`)  
> **Frontend Viewports:** React + TypeScript (`src/components/LoupeView.tsx`, `src/components/CompareView.tsx`, `src/components/GridView.tsx`)

---

## 1. Overview & Architecture

The image processing pipeline delivers sub-millisecond perceived latency during shoot ingestion, metadata parsing, and high-resolution rendering. It eliminates UI thread blocking through multi-threaded Rust execution ([`rayon`](https://crates.io/crates/rayon)) and a staged two-phase thumbnail and metadata extraction workflow.

```
+-----------------------------------------------------------------------------------+
|                            IMAGE PROCESSING PIPELINE                              |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  Phase 1: Rapid Ingestion (<50ms Instant Grid Fill)                               |
|  Folder Scan (rayon) -> Embedded EXIF Jpeg Extractor (<2ms) -> 400px WebP Disk    |
|                                                                                   |
|  Phase 2: Deep Processing (Parallel Background Rayon Chunks of 20)                 |
|  Full / High-Res Decode -> EXIF Tags -> Blur/Luma Metrics -> RGB Histograms -> AI |
|                                                                                   |
|  Phase 3: Viewport & Canvas Rendering                                             |
|  Adaptive N-up Grid -> 100%/Fit Canvas Scaling -> Synchronized Multi-Pan/Zoom    |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Two-Phase Ingestion & Thumbnail Pipeline

### 2.1 Phase 1: Rapid Ingestion Path (`generate_thumbnail_fast_exif_only`)
To populate the Grid View instantly upon folder selection, the pipeline avoids expensive full-resolution image decoding:
1. **Directory Scanning**: Scans for supported formats (`.jpg`, `.jpeg`, `.png`, `.webp`, `.tiff`, `.cr2`, `.nef`, `.arw`, `.dng`) in parallel using `rayon::prelude::*`.
2. **Embedded EXIF Jpeg Extraction**: Reads container tags `Tag::JPEGInterchangeFormat` and `Tag::JPEGInterchangeFormatLength` using the Rust `exif` crate. Reads the raw embedded thumbnail bytes directly ($<2\text{ms}$).
3. **WebP Generation**: Resizes the embedded thumbnail to $400 \times 400\text{px}$ and saves as `<photo_id>_thumb.webp` in `~/.config/ai-photo-classifier/cache/`.
4. **Immediate UI Emission**: Emits `import-progress` events over Tauri IPC to render the first batch of 24 photos in the UI in $<50\text{ms}$.

### 2.2 Phase 2: Parallel Deep Analysis (`process_photo_single_pass`)
The remaining photos and deep analytical metrics are processed in parallel chunks of 20 items:
1. **Fallback Decoding**: If no embedded thumbnail exists, loads image data using the `image` crate with format deduction.
2. **EXIF Metadata Parsing**:
   - Camera Make & Model (`Tag::Make`, `Tag::Model`)
   - Lens Model (`Tag::LensModel`)
   - Exposure settings: ISO (`Tag::PhotographicSensitivity`), Aperture (`Tag::FNumber`), Shutter Speed (`Tag::ExposureTime`), Focal Length (`Tag::FocalLength`), Exposure Bias (`Tag::ExposureBiasValue`).
3. **Quality & Defect Screening**: Calculates Laplacian blur scores and luminance metrics.
4. **RGB & Luma Histogram Generation**: Generates 256-bin distributions for red, green, blue, and luminance channels.
5. **AI Feature Extraction & Prediction**: Computes visual embeddings and generates initial AI suggestions.

---

## 3. Objective Quality Metrics Calculation

Objective quality screening is executed natively in Rust (`calculate_quality_metrics_from_image`):

```rust
// Downsamples to 128x128 8-bit grayscale for deterministic variance analysis
let gray = img.resize_exact(128, 128, FilterType::Triangle).to_luma8();
```

* **Laplacian Blur Variance Score**:
  $$\text{Laplacian}(x, y) = I(x+1, y) + I(x-1, y) + I(x, y+1) + I(x, y-1) - 4 \cdot I(x, y)$$
  $$\text{Blur Score} = \text{Var}(\text{Laplacian}) = \frac{1}{N} \sum (\text{Lap} - \mu_{\text{Lap}})^2$$
  - Higher scores ($> 80$) indicate sharp focus and high edge frequency.
  - Low scores ($< 40$) indicate motion blur, missed focus, or lens softness.
* **Mean Luminance**: Average pixel intensity across the frame ($0.0$ to $255.0$).
* **Black Frame Detection**: Flagged if $>80\%$ of pixels have luminance $<15$.
* **Severe Overexposure Detection**: Flagged if $>40\%$ of pixels have luminance $>240$.

---

## 4. RGB & Luminance Histogram Engine

Histograms are computed on downsampled $300 \times 300\text{px}$ buffers in Rust (`calculate_histogram_from_image`):
* Computes discrete 256-bin counts for:
  - **Red Channel** ($R \in [0, 255]$)
  - **Green Channel** ($G \in [0, 255]$)
  - **Blue Channel** ($B \in [0, 255]$)
  - **Luminance Channel**: $L = 0.299 \cdot R + 0.587 \cdot G + 0.114 \cdot B$
* Normalized against the peak frequency bin ($0$ to $100\%$) and rendered in the frontend via SVG area paths in [`HistogramWidget.tsx`](file:///workspace/src/components/HistogramWidget.tsx).

---

## 5. Viewport Rendering Mechanics

### 5.1 Grid View Rendering
* Virtual CSS Grid with dynamic `minmax(gridSize, 1fr)` column calculation.
* Lazy-loaded thumbnail images with automatic fallback to full image source upon thumbnail generation lag.

### 5.2 Loupe View Rendering
* Center-aligned viewport with `scale(1)` (Fit View) and `scale(2.5)` (100% Zoom) toggle modes.
* Asynchronous high-resolution preview loader with spinner overlay and error boundaries.
* Keyboard-driven rapid cycling (`ArrowLeft` / `ArrowRight`) pre-caching adjacent image assets.

### 5.3 Compare View Synchronized Canvas Zoom & Pan
* **Adaptive N-Up Grid**: Dynamically computes CSS grid columns based on candidate count (2 candidates $\rightarrow$ 2-col, 4 candidates $\rightarrow$ $2 \times 2$, 6 candidates $\rightarrow$ $3 \times 2$).
* **Synchronized Zoom (`Z` key)**: Toggles unified zoom scale ($2.2\times$) across all candidate viewports.
* **Seamless Card Elimination**: Removing a candidate immediately redistributes canvas space to remaining candidates with smooth layout transitions.

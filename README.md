# AI Photo Classifier 📷⚡

[![Tauri](https://img.shields.io/badge/Tauri-v2-blue.svg?logo=tauri&logoColor=white)](https://tauri.app/)
[![Rust](https://img.shields.io/badge/Rust-1.70+-orange.svg?logo=rust&logoColor=white)](https://www.rust-lang.org/)
[![React](https://img.shields.io/badge/React-18-61DAFB.svg?logo=react&logoColor=black)](https://reactjs.org/)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-3178C6.svg?logo=typescript&logoColor=white)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

A high-performance, cross-platform desktop application built for professional photographers to drastically accelerate photo culling workflows. Modeled after industry-standard Digital Asset Management (DAM) tools like Adobe Lightroom and Darktable, it combines **personalized on-device Machine Learning (Transfer Learning)**, **objective quality pre-screening**, and **ergonomic hotkey workflows**.

---

## 🎯 Objective & Problem Statement

Photographers frequently return from shoots with hundreds or thousands of photos. Sorting and classifying them is mentally exhausting and time-consuming. 

**AI Photo Classifier** solves this by:
1. **Learning your personal aesthetic taste** dynamically as you confirm ratings.
2. **Pre-screening technical defects** (motion blur, missed focus, black frames, overexposure) using objective computer vision metrics.
3. **Suggesting Pick/Reject flags and 0–5 star ratings** for new and unreviewed photos.
4. **Providing ergonomic multi-candidate elimination** tools for burst shots and bracketed sequences.
5. **Operating 100% locally and offline** by default to guarantee data privacy and maximum processing speed.

---

## ✨ Key Features & View Modes

### 1. Ingestion & Grid View (`G`)
* **Sub-50ms Rapid Ingestion**: Staged two-phase pipeline extracts embedded EXIF thumbnails for instantaneous grid display before deep background processing begins.
* **Ambient AI Badges**: Visual overlay badges (e.g. `AI: 4 ★`) displayed directly on photo cards.
* **Batch Operations**: Multi-select support (`Ctrl`/`Cmd` + Click) to apply flags and star ratings across multiple photos simultaneously.

### 2. High-Resolution Loupe View (`E` / `Enter`)
* **Primary Review Mode**: Full-viewport inspection with instant zoom toggle (`Z` key: Fit vs. 100% Zoom).
* **Fluid Keyboard Culling**: Navigate seamlessly with `ArrowLeft` / `ArrowRight` while applying ratings with zero latency.
* **EXIF HUD Overlay (`I`)**: Heads-Up Display showing camera, lens, shutter speed, aperture, and ISO.

### 3. Burst Compare View (`C`)
* **Multi-Candidate Elimination**: Side-by-side N-up layout for burst sequences and bracketed exposures.
* **Synchronized Zoom & Pan**: Moving or zooming one image locks and pans all other candidate viewports to the exact same relative coordinates.
* **One-Key Elimination (`\` or `Delete`)**: Eliminate weaker candidates until the single standout winner remains.

### 4. AI Analytics & Disagreement Dashboard (`S`)
* **Model Convergence Tracking**: Real-time KPI cards for Pick Accuracy (%), Precision/Recall, Star Rating Accuracy (%), and Mean Absolute Error (MAE in stars).
* **Historical Trend Charts**: Visualizes model learning progress across retraining runs.
* **6×6 Confusion Matrix**: Detailed breakdown mapping actual user ratings against AI predicted ratings.
* **Audit Disagreements Filter**: Dedicated one-click filter (`showDisagreementsOnly`) to isolate photos where the AI prediction diverged from your assigned rating.

### 5. Native Metadata Sidecar Export (RawTherapee & Adobe XMP)
* **RawTherapee (`.pp3`)**: Automatically writes/updates `[Rank]` (`Rank=0-5`) and `[ColorLabel]` (`ColorLabel=3` for Pick, `ColorLabel=1` for Reject, `ColorLabel=0` for Unflagged) sidecar configuration files.
* **Adobe XMP (`.xmp`) *(Added in v2.0)***: Introduced during the Tauri + Rust migration (v2.0) to provide universal interoperability with Adobe Lightroom, Darktable, Capture One, and DigiKam. Generates standard XML sidecars containing `xmp:Rating` (0–5) and `xmp:Label` tags ("Green" for Pick, "Red" for Reject).
* **Simultaneous Dual Sync**: Clicking the export action generates both `.pp3` and `.xmp` sidecar files in a single pass without altering original RAW image files.

---

## 🧠 Use of Transfer Learning & ML Architecture

The application uses an adaptive **Transfer Learning** architecture that trains lightweight classification heads on top of pre-extracted deep visual representations:

```
+-----------------------------------------------------------------------------------+
|                           AI TRANSFER LEARNING ENGINE                             |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  1. Pluggable Feature Extractors                                                  |
|     - Local ONNX: MobileNetV3-Small (~15ms/photo) | CLIP ViT-B/32 (~80ms/photo)   |
|     - Cloud Adapters: OpenAI GPT-4o Vision API | Anthropic Claude Vision API      |
|                                                                                   |
|  2. Quality Augmentation Engine                                                   |
|     Vector z = [ Visual Embedding (512), BlurScore/1000, Luma/255, Overexposed ]  |
|     Augmented Feature Vector (D = 515)                                            |
|                                                                                   |
|  3. Dual Classification Heads (Rust LogisticRegressionHead)                       |
|     - 3-State Flag Head: Pick (P) vs. Unflagged/Neutral (U) vs. Reject (X)        |
|     - 6-Class Ordinal Head: 0, 1, 2, 3, 4, or 5 Stars (Softmax probabilities)     |
|                                                                                   |
|  4. Online Background Retraining Loop                                             |
|     - Triggers automatically every 10 confirmed user ratings                      |
|     - Regularized L2 Ridge gradient descent completes in <150ms on CPU            |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

### 3-State Classification Taxonomy:
* **Pick (`P`)**: Strong keeper to work on, develop, or share.
* **Reject (`X`)**: Unusable frame (unintentional shot, black frame, severe blur, blown out).
* **Unflagged / Neutral (`U`)**: Valid baseline state for standard photos or non-winning alternates from a burst comparison.

---

## ⌨️ Ergonomic Lightroom Keyboard Shortcuts

| Shortcut | Action | Context |
| :--- | :--- | :--- |
| **`P`** | Flag as **Pick** | Active Selection |
| **`X`** | Flag as **Reject** | Active Selection |
| **`U`** | Set to **Unflagged / Neutral** | Active Selection |
| **`0` – `5`** | Assign **Star Rating** (0 to 5) | Active Selection |
| **`ArrowLeft` / `ArrowRight`** | Navigate Previous / Next Photo | Global |
| **`G`** | Switch to **Grid View** | Global |
| **`E` / `Enter`** | Switch to **Loupe View** | Global |
| **`C`** | Switch to **Compare View** | Global |
| **`S`** | Switch to **AI Analytics View** | Global |
| **`\` / `Delete` / `Backspace`** | Eliminate Candidate | Compare View |
| **`Z`** | Toggle Zoom (Fit $\leftrightarrow$ 100%) | Loupe & Compare Views |
| **`I`** | Toggle EXIF Info HUD | Loupe View |
| **`Tab`** | Toggle Left Folder Sidebar | Global |
| **`Shift + Tab`** | Toggle Right Metadata Sidebar | Global |

---

## 🛠️ Project Structure & Specifications

Comprehensive architectural and module specifications are available in the [`specs/`](specs/) directory:

* [`specs/app-spec.md`](specs/app-spec.md): Central technical implementation architecture & Tauri IPC contract.
* [`specs/user-story.md`](specs/user-story.md): User stories, rating taxonomy, and view workflows.
* [`specs/image-processing-and-render.md`](specs/image-processing-and-render.md): Two-phase thumbnail pipeline, EXIF parsing, blur metrics, and histogram engine.
* [`specs/ui.md`](specs/ui.md): Layout design, viewports, and keyboard interaction engine.
* [`specs/ai-learning-and-suggesting.md`](specs/ai-learning-and-suggesting.md): Machine learning engine, vector augmentation, and online retraining algorithms.
* [`specs/database-and-storage.md`](specs/database-and-storage.md): Relational SQLite schema and sidecar exporter specifications.

---

## 🚀 How to Build and Run

### Prerequisites

1. **Node.js** (v18.0 or later) & `npm`
2. **Rust** (v1.70 or later) & `cargo` ([Install Rust](https://www.rust-lang.org/tools/install))
3. **Platform Dependencies for Tauri v2**:
   * **Linux (Debian/Ubuntu)**:
     ```bash
     sudo apt-get update
     sudo apt-get install -y libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
     ```
   * **macOS**: Xcode Command Line Tools (`xcode-select --install`)
   * **Windows**: Microsoft C++ Build Tools & WebView2 runtime (pre-installed on Windows 10/11)

---

### Installation

Clone the repository and install frontend dependencies:

```bash
git clone https://github.com/your-username/ai-photo-classifier.git
cd ai-photo-classifier
npm install
```

---

### Running in Development

#### Option A: Full Native Desktop App (Recommended)
Launches the native Tauri desktop shell with hot-reloading for both the Rust backend and React frontend:

```bash
npm run tauri dev
```

#### Option B: Browser Fallback Preview (Frontend Only)
Runs the React/Vite development server in browser simulation mode (with mock data and file-picker fallbacks):

```bash
npm run dev
```
Then open `http://localhost:5173` in your browser.

---

### Building for Production

To compile an optimized, standalone native desktop executable for your operating system:

```bash
npm run tauri build
```

The compiled native installer packages will be output to `src-tauri/target/release/bundle/`:
* **Linux**: `.deb`, `.AppImage`
* **macOS**: `.dmg`, `.app`
* **Windows**: `.msi`, `.exe`

---

## 📄 License

This project is open source and available under the [MIT License](LICENSE).
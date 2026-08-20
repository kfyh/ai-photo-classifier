# User Interface & Interaction Specification

> **Module:** Desktop UI, View Modes & Keyboard Engine  
> **Status:** Active / Implemented  
> **Frontend Stack:** React v18+, TypeScript, Tailwind CSS, Lucide React, Recharts  
> **Components:** `src/App.tsx`, `src/components/*`

---

## 1. UI Shell Layout Architecture

The application interface follows a professional 3-column Digital Asset Management (DAM) layout with collapsible sidebars and an active main viewport:

```
+---------------------------------------------------------------------------------------------------+
| TopToolbar: Folder Title | Import Progress | Search & Filter Bar | Model Selector | View Mode Tabs |
+---------------------------------------------------------------------------------------------------+
| Collapsible     | Central Viewport                                                | Collapsible   |
| Left Sidebar    |                                                                 | Right Sidebar |
|                 | [ Grid View (G) | Loupe View (E) | Compare (C) | Stats (S) ]    |               |
| - Folder Tree   |                                                                 | - Histogram   |
| - Photo Counts  |                                                                 | - Quick Rate  |
| - Directory     |                                                                 | - AI Breakdown|
|   Picker        | [ Persistent Bottom Filmstrip for Loupe & Compare Modes ]       | - EXIF & Blur |
| - DB Clean      |                                                                 | - PP3/XMP Sync|
+-----------------+-----------------------------------------------------------------+---------------+
```

---

## 2. Viewport Modes

### 2.1 Grid View (`G`)
* **Purpose**: Ingestion check, shoot structure exploration, and bulk culling overview.
* **Layout**: CSS Grid with dynamic resizing slider (`gridSize`: 120px to 400px).
* **Card Anatomy**:
  - WebP Thumbnail image with lazy loading.
  - Ambient purple AI prediction badge in the top-right corner (`AI: 4 ★`).
  - Bottom gradient overlay with filename, Pick/Reject quick flag toggles, and interactive 5-star rating widget.
  - Multi-select support via `Ctrl + Click`, `Meta + Click`, or `Shift + Click`.

### 2.2 Loupe View (`E` / `Enter`)
* **Purpose**: Primary high-resolution photo review and rapid sequential rating.
* **Layout**: Centered full-viewport canvas with optional floating Heads-Up Display (HUD) for EXIF metadata (`I` key).
* **Navigation**: Fluid cycling via `ArrowLeft` / `ArrowRight` or floating arrow buttons.
* **Floating Culling Bar**: Centered bottom pill with Pick (`P`), Reject (`X`), and large 5-star rating widget.

### 2.3 Elimination Compare View (`C`)
* **Purpose**: Side-by-side evaluation of burst sequences, bracketed shots, or similar frames.
* **Layout**: Adaptive N-up grid layout (2 to 6+ images).
* **Elimination Action**: User presses `\` or `Delete` / `Backspace` to eliminate the focused photo, scaling up the remaining contenders until 1 winner remains.
* **Winner Screen**: Highlights the winning shot with confirmation actions to mark as Pick (`P`) and open directly in Loupe view.

### 2.4 AI Analytics Dashboard (`S`)
* **Purpose**: Monitor model accuracy, rating fidelity, and audit edge-case disagreements.
* **Components**:
  - Summary KPI cards: Pick Accuracy (%), Precision/Recall (%), Star Accuracy (%), MAE (stars), Confirmed Training Samples.
  - Historical accuracy trend line chart using Recharts.
  - 6×6 Star Rating Confusion Matrix Table (Actual Assigned vs AI Predicted).
  - Quick action button: "Audit AI Disagreements" (`showDisagreementsOnly: true`).

### 2.5 Bottom Filmstrip
* Displays a horizontal scrolling preview bar at the bottom of the viewport during Loupe and Compare modes for rapid timeline orientation.

---

## 3. Ergonomic Keyboard Shortcuts Engine

Global window-level event listener (`useEffect` in [`App.tsx`](file:///workspace/src/App.tsx#L472-L530)) mapped to standard Lightroom keybindings:

| Keybinding | Action | Context |
| :--- | :--- | :--- |
| **`P`** | Toggle **Pick Flag** (Pick $\leftrightarrow$ Unflagged) | Active photo selection |
| **`X`** | Toggle **Reject Flag** (Reject $\leftrightarrow$ Unflagged) | Active photo selection |
| **`U`** | Set **Unflagged / Neutral** state | Active photo selection |
| **`0` – `5`** | Assign Star Rating ($0$ to $5$ stars) | Active photo selection |
| **`ArrowLeft` / `ArrowRight`** | Navigate Previous / Next photo | Global |
| **`G`** | Switch to **Grid View** | Global |
| **`E` / `Enter`** | Switch to **Loupe View** | Global |
| **`C`** | Switch to **Elimination Compare View** | Global |
| **`S`** | Switch to **AI Stats & Analytics View** | Global |
| **`\` / `Delete` / `Backspace`** | Eliminate focused candidate | Compare View |
| **`Z`** | Toggle Zoom (Fit $\leftrightarrow$ 100% Zoom) | Loupe & Compare Views |
| **`I`** | Toggle EXIF Info HUD Overlay | Loupe View |
| **`Tab`** | Toggle Left Folder Sidebar | Global |
| **`Shift + Tab`** | Toggle Right Metadata & AI Sidebar | Global |

---

## 4. State Management & Optimistic Updates

* **Optimistic Local Updates**: When a rating or flag hotkey is pressed, the React state (`photos`) updates immediately for 0ms perceived UI latency, followed by asynchronous persistence to the Rust SQLite database.
* **Batch Multi-Select Application**: If multiple photos are selected in the Grid (`selectedPhotoIds`), rating updates are broadcast across all selected items simultaneously.
* **Background Import Streams**: Listens to Tauri backend event streams (`import-progress`, `import-complete`) to append incoming photo thumbnails progressively without freezing the interface.

# User Story & Product Specification: AI Photo Classifier (v2.0)

> **Document Version:** 2.0.0 (Retrospective Update)  
> **Status:** Active / Implemented  
> **Target Audience:** Photographers, DAM Engineers, AI/ML Developers  

---

## 1. Core Workflow & Problem Statement

As a photographer dealing with hundreds or thousands of photos from a shoot, culling is tedious and mentally draining. Classification involves both objective technical criteria (sharpness, exposure, framing) and subjective aesthetic intuition (composition, mood, expression, portfolio suitability).

I currently categorize and rate photos using the following standard:

### 1.1 Rating & Flagging Taxonomy

* **Pick (`P`)**: Photos with strong potential that I want to develop, share, or publish.
* **Reject (`X`)**: Clearly unusable frames — unintentional shots, fully black frames, severe motion blur, or blown highlights.
* **Unflagged / Neutral (`U`)**: Valid baseline neutral state — usable standard photos that are neither exceptional nor defective, or photos left unflagged after a burst comparison.

#### 0 to 5 Star Scale:
* **0 Stars**: Same as **Reject** — completely unusable photo.
* **1 Star**: Has minimal merit, but is blurry, out-of-focus, missed composition, or technically flawed.
* **2 Stars**: Technically acceptable, but boring, redundant, or uninspiring.
* **3 Stars**: Good quality, usable standard shot (e.g., suitable for stock photography or b-roll).
* **4 Stars**: Strong image — I really like this photo and it is worth developing further.
* **5 Stars**: Massive keeper — portfolio piece, standout shot, once-in-a-lifetime capture.

---

## 2. Dedicated View User Stories

### 2.1 Grid View (`G`) — Default Overview & Ingestion Verification
> **As a photographer**, when I open a shoot folder, I want the application to default to a responsive **Grid View** so that I can immediately verify all photos have loaded properly and get a comprehensive bird's-eye overview of the shoot's contents, variety, and AI suggestions.

* **High-Level Ingestion Check**: Instantly confirms thumbnail generation, file counts, and folder layout without waiting for deep processing.
* **Ambient AI Badges**: Displays overlay badges (e.g., `AI: 4 ★`) directly on thumbnails so the photographer can scan overall quality distribution across the shoot.
* **Adjustable Zoom**: Dynamic slider and hotkeys to resize thumbnails from compact overview sheets to large preview tiles.

---

### 2.2 Loupe View (`E` / `Enter`) — Primary High-Res Inspection & Rapid Culling
> **As a photographer**, I want a clean, full-viewport **Loupe View** to deeply inspect individual photos at high resolution, and use left/right arrow navigation to rapidly cycle through and rate every photo sequentially.

* **Primary Daily Driver**: Serves as the most frequently used review mode during active culling.
* **Fluid Keyboard Navigation**: Seamlessly navigate through the entire shoot using `ArrowLeft` / `ArrowRight` with instant image rendering.
* **One-Touch Culling**: Direct single-key shortcuts (`P` for Pick, `X` for Reject, `U` for Unflag, `0`–`5` for Stars) to rate photos with zero UI latency.
* **Persistent Filmstrip**: Optional bottom filmstrip providing contextual awareness of preceding and upcoming images in the sequence.

---

### 2.3 Compare View (`C`) — Multi-Candidate Elimination for Burst Sequences
> **As a photographer**, when evaluating similar photos from high-speed burst shots or bracketed exposures, I want an **Elimination Compare View** that displays candidate photos side-by-side with synchronized zoom and pan, allowing me to eliminate weaker shots until only the best candidate remains.

* **Side-by-Side N-Up Layout**: Compares 2 to 6+ candidate photos simultaneously.
* **Synchronized Zoom & Pan**: Moving or zooming into a focal point (e.g., subject's eyes) on one image automatically locks and pans all other candidate viewports to the identical relative coordinates.
* **Elimination Workflow**: Hitting `\` or `Delete` eliminates a selected candidate, smoothly redistributing screen real estate among the remaining contenders.
* **Winning Selection**: Instantly promotes the winning photo to Pick (`P`) and transitions directly into Loupe view.

> [!NOTE]
> **Technical Note on Compare & Contextual Ratings (Relative vs. Absolute Quality):**  
> In burst comparison workflows, some photos will remain `unflagged` (or be marked as non-picks) even though they are technically sharp and well-composed on their own merits. This occurs because an adjacent photo in the same burst sequence captured a slightly better micro-expression, cleaner wing angle, or crisper focus. Transfer learning models must recognize that `unflagged` is a natural, valid category for technically acceptable but non-winning burst alternates.

---

### 2.4 AI Analytics Dashboard (`S`) — Performance & Disagreement Auditing
> **As the model learns**, I want quantitative visibility into how well the AI predictions match my manual choices over time, and a way to audit edge cases.

* **Audit AI Disagreements Mode**: A dedicated filter toggle (`showDisagreementsOnly: true`) immediately filters the grid to display only photos where the AI prediction diverges from the assigned user rating (e.g., model predicted 4 stars, user gave 2 stars).
* **Historical Trend Chart**: Interactive line chart visualizing the convergence of Pick/Reject and Star Rating accuracy across successive retraining iterations.
* **6×6 Star Rating Confusion Matrix**: Complete matrix cross-referencing Actual Assigned Ratings against AI Predicted Ratings to identify systematic bias or subjectivity boundaries (e.g., 3-star vs 4-star stock keepers).

---

## 3. The AI Suggestion Architecture & Transfer Learning

### 3.1 Three-State Flag Classification (`Pick` / `Unflagged` / `Reject`)
* Unlike naive binary classifiers, transfer learning treats **`unflagged` (Neutral)** as an explicit, first-class target state.
* This prevents standard/unremarkable photos from being artificially forced into extreme `pick` or `reject` bins, accurately reflecting standard culling habits.

### 3.2 Pluggable Feature Extraction & Vector Augmentation
* **Deep Visual Embeddings**: Supports local on-device models via ONNX Runtime ([`MobileNetV3-Small`](file:///workspace/src-tauri/src/ml/engine.rs#L11-L18) for ultra-fast ~15ms scoring, [`CLIP ViT-B/32`](file:///workspace/src-tauri/src/ml/engine.rs#L20-L27) for aesthetic semantic depth) and optional cloud vision APIs ([`OpenAI GPT-4o`](file:///workspace/src-tauri/src/ml/engine.rs#L29-L36), [`Anthropic Claude`](file:///workspace/src-tauri/src/ml/engine.rs#L38-L45)).
* **Objective Quality Augmentation**: Embeddings ($D=512$) are concatenated with real-time objective quality metrics (Laplacian blur score variance, mean luminance, overexposure/black frame indicators) to form an augmented 515-dimensional vector.

### 3.3 Dual Prediction Heads
1. **3-State Pick / Neutral / Reject Head**: Multi-class logistic regression providing discrete flag recommendations and confidence percentages.
2. **Ordinal Star Rating Head (0–5)**: 6-class Softmax classifier predicting the exact star tier and probability distribution.

### 3.4 Continuous Background Feedback Loop
* **Automatic Retraining**: Every 10 confirmed user ratings (`confirmed_count % 10 == 0`), the background engine automatically triggers online gradient descent (L2-regularized Ridge regression, $\lambda=0.01$, $\alpha=0.05$, 60 epochs).
* **Sub-150ms Speed**: Completes retraining on CPU in $<150\text{ms}$ without UI blocking.
* **Sidecar Metadata Synchronization**: Native generation of RawTherapee `.pp3` sidecars (`[Rank]`, `[ColorLabel]`) and Adobe `.xmp` sidecars.

---

## 4. Changelog & Evolution (v1.0 $\rightarrow$ v2.0)

| Feature Area | v1.0 Initial Concept | v2.0 Implemented State (Current Repo) |
| :--- | :--- | :--- |
| **Platform Shell** | High-level DAM concept | Tauri v2 + Rust Core with React/TypeScript frontend |
| **Flag Classification** | Binary Pick / Reject | 3-State Model: `Pick`, `Unflagged` (Neutral), and `Reject` |
| **Grid View (`G`)** | Simple thumbnail layout | Default ingestion verification & shoot structure overview with `AI: X ★` overlays |
| **Loupe View (`E`)** | Standard single photo view | Primary review mode with high-res rendering and rapid keyboard culling (`ArrowLeft`/`Right`) |
| **Compare View (`C`)** | Generic compare tool | N-up elimination workflow with synchronized zoom/pan for burst shots |
| **Burst Culling Nuance** | Not addressed | Technical specification for relative quality culling (good photos staying unflagged) |
| **AI ML Architecture** | Conceptual transfer learning | Pluggable local ONNX (MobileNetV3, CLIP) + Cloud Vision API adapters |
| **Quality Analysis** | Subjective inspection | Automated Laplacian blur score, luminance, and overexposure quality metrics |
| **Retraining Mechanics** | Undefined batch training | Continuous background online learning triggered every 10 confirmed photos ($<150\text{ms}$) |
| **Audit & Diagnostics** | Basic stats request | Dedicated "Audit Disagreements" filter mode, trend line charts, and 6×6 confusion matrix |
| **DAM Integration** | Manual export | Automated RawTherapee `.pp3` and Adobe `.xmp` metadata sidecar synchronization |
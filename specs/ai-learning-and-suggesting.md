# AI Learning & Suggesting Specification

> **Module:** Machine Learning Engine, Feature Extraction & Transfer Learning  
> **Status:** Active / Implemented  
> **Backend Implementation:** Rust (`src-tauri/src/ml/*`)  
> **Frontend Visualization:** React (`src/components/StatsDashboard.tsx`, `src/components/RightSidebar.tsx`)

---

## 1. Overview & Architecture

The AI subsystem provides personalized, on-device Machine Learning (ML) transfer learning to accelerate photo culling. It continuously adapts to the photographer's subjective classification preferences while incorporating objective image quality metrics to avoid subjective false positives on technically defective images.

```
+-----------------------------------------------------------------------------------+
|                           AI TRANSFER LEARNING ENGINE                             |
+-----------------------------------------------------------------------------------+
|                                                                                   |
|  1. Pluggable Feature Extractors                                                  |
|     +-------------------------+     +--------------------------+                  |
|     | Local ONNX (ort crate)  |     | Cloud Vision (reqwest)   |                  |
|     | MobileNetV3 / CLIP ViT  |     | OpenAI / Claude Vision   |                  |
|     +------------+------------+     +------------+-------------+                  |
|                  |                               |                                |
|                  +---------------+---------------+                                |
|                                  | Raw Embedding Vector (D=512)                   |
|                                  v                                                |
|  2. Quality Augmentation Engine                                                   |
|     Vector z = [ Embeddings (512), BlurScore/1000, Luma/255, OverexposedFlag ]    |
|     Augmented Feature Vector (D = 515)                                            |
|                                  |                                                |
|                                  v                                                |
|  3. Dual Classification Heads (Rust LogisticRegressionHead)                       |
|     +----------------------------------+  +-------------------------------------+ |
|     | 3-State Pick/Neutral/Reject Head |  | 6-Class Ordinal Star Rating Head    | |
|     | Multi-class Softmax / Sigmoid    |  | Softmax Probability Distribution    | |
|     +----------------------------------+  +-------------------------------------+ |
|                                  ^                                                |
|                                  | Online L2-Regularized Gradient Descent         |
|  4. Background Retraining Loop --+                                                |
|     Triggered every 10 confirmed user ratings (<150ms on CPU)                     |
|                                                                                   |
+-----------------------------------------------------------------------------------+
```

---

## 2. Pluggable Model Adapters

The ML Engine employs a trait-based adapter pattern ([`FeatureExtractorAdapter`](file:///workspace/src-tauri/src/ml/traits.rs)) supporting both local offline neural networks and cloud vision endpoints:

| Model ID | Provider | Embedding Dim | Execution Mode | Characteristics |
| :--- | :--- | :--- | :--- | :--- |
| **`mobilenet_v3`** | Local ONNX | 512 | 100% Offline | Ultra-fast (~15ms/photo), lightweight edge feature extractor |
| **`clip_vit_b32`** | Local ONNX | 512 | 100% Offline | High-semantic visual representation (~80ms/photo) |
| **`cloud_openai`** | OpenAI API | 512 | Cloud | GPT-4o Vision API for aesthetic reasoning |
| **`cloud_anthropic`** | Anthropic API | 512 | Cloud | Claude Vision API for high-level commentary |

Extracted embedding vectors are serialized directly as binary `BLOB`s in SQLite (`photo_embeddings` table) to eliminate redundant model passes.

---

## 3. Augmented Feature Vector ($D = 515$)

To bridge subjective aesthetic features with objective technical flaws, the raw $512$-dimensional visual embedding is concatenated with normalized quality metrics:

$$z = \begin{bmatrix} e_1, e_2, \dots, e_{512}, & \min\left(\frac{\text{blur\_score}}{1000}, 1.0\right), & \frac{\text{mean\_luminance}}{255.0}, & \mathbb{I}(\text{overexposed}) \end{bmatrix}^T$$

This ensures that out-of-focus or severely blown-out frames are penalized even if their semantic composition resembles a keeper.

---

## 4. Dual Classification Heads

Implemented in pure Rust ([`src-tauri/src/ml/classifier.rs`](file:///workspace/src-tauri/src/ml/classifier.rs)):

### 4.1 Pick / Neutral / Reject Head
* Evaluates dot product score against learned weight vector $w_{\text{pick}} \in \mathbb{R}^{515}$:
  $$P(\text{pick}) = \sigma(w_{\text{pick}}^T z) = \frac{1}{1 + e^{-w_{\text{pick}}^T z}}$$
* Predictions assign `pick` ($P \ge 0.5$) or `reject` ($P < 0.5$) with confidence score $\max(P, 1 - P)$.
* Recognizes `unflagged` (Neutral) as a valid state in transfer learning datasets to avoid over-polarizing baseline photos.

### 4.2 Ordinal Star Rating Head (0 to 5 Stars)
* Computes class logits for each star tier $c \in \{0, 1, 2, 3, 4, 5\}$ using weight matrix $W_{\text{rating}} \in \mathbb{R}^{6 \times 515}$:
  $$s_c = w_c^T z$$
  $$P(\text{rating} = c) = \frac{e^{s_c - \max_j s_j}}{\sum_{k=0}^5 e^{s_k - \max_j s_j}}$$
* Assigns the predicted star rating $\arg\max_c P(c)$ along with its confidence probability.

---

## 5. Online Transfer Learning & Retraining Mechanics

### 5.1 Auto-Retrain Trigger
* Whenever a user confirms or updates a photo rating, the backend checks total confirmed samples in SQLite:
  $$\text{confirmed\_count} > 0 \quad \text{and} \quad \text{confirmed\_count} \pmod{10} == 0$$
* If the milestone is met, a background non-blocking Tokio thread spawns to retrain the logistic regression head.

### 5.2 Regularized Optimization Algorithm
* **Optimizer**: Online batch gradient descent with L2 Ridge regularization penalty ($\lambda = 0.01$, learning rate $\alpha = 0.05$, 60 epochs).
* **Weight Update Rule**:
  $$w \leftarrow w - \alpha \left( (P(z) - y) \cdot z + \lambda w \right)$$
* **Training Latency**: Completes in $<150\text{ms}$ on CPU across hundreds of samples without UI disruption.

---

## 6. Accuracy Metrics & Disagreement Diagnostics

Upon each retraining run, the engine computes a snapshot evaluation log stored in the `accuracy_logs` table:
* **Pick Accuracy, Precision, and Recall**: Quantifies binary and flag classification fidelity.
* **Star Rating Accuracy (%) & Mean Absolute Error (MAE)**:
  $$\text{MAE} = \frac{1}{N} \sum_{i=1}^N \left| \hat{y}_i - y_i \right|$$
* **6×6 Star Rating Confusion Matrix**: Formats all $6 \times 6$ actual vs. predicted ratings into a JSON matrix, rendered directly in the Stats Dashboard.
* **Audit Disagreements Filter**: Enables instant filtering (`showDisagreementsOnly: true`) in the Grid View to isolate edge cases for review.

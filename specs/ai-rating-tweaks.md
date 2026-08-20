# Technical Implementation Specification: AI Predictive Suggestions, Accessibility & UI Rating Tweaks

> **Document Version:** 1.0.0  
> **Status:** Specification Complete (Ready for Implementation)  
> **Target Module:** Frontend Viewport (`src/components/`, `src/App.tsx`, `src/types/`, `src/index.css`)  
> **Primary Goals:** Ghosted Type-Ahead AI Suggestions, Single-Key/Click Acceptance, Colorblind Accessibility (Red-Green / Deuteranopia & Protanopia), UI Font Scaling, and Confidence Thresholding.

---

## 1. Executive Summary & Problem Statement

### 1.1 Overview
In the initial implementation, AI predictions were displayed as static badges and separate inspection widgets alongside manual rating controls. To streamline rapid photo culling, AI predictions must behave like **predictive text / type-ahead autocompletion**:
1. **Ghosted Suggestions:** AI suggested picks and star ratings appear directly inside standard rating UI controls as semi-transparent ("ghosted") previews for unrated photos.
2. **One-Action Acceptance:** Users can accept the AI suggestion instantaneously via the `Tab` key or by clicking an inline UI badge/button.
3. **Clean Metadata Transition:** As soon as a photo receives user-confirmed metadata (Pick, Reject, Star Rating 1–5), predictive overlays vanish from gallery viewports (Grid, Loupe, Compare). The Inspector panel retains the historical prediction for analytical comparison.
4. **Dynamic AI Batch Refinement:** Model re-training and re-inference cycles update predictions dynamically for all photos that remain unrated.
5. **Accessibility & Contrast Overhaul (Red-Green Colorblindness & Readability):** Confidence percentages and status indicators must achieve high-contrast readability (WCAG AAA standard) and avoid chromatic ambiguity for red-green colorblindness (Deuteranopia/Protanopia) through distinct luminance, shape encoding, and colorblind-safe palettes.
6. **Font & UI Scaling:** Introduce configurable UI text zoom levels to accommodate varied viewing distances and visual requirements.
7. **Confidence Gating:** Predictions below a configurable confidence threshold ($X\%$, defaulting to $25\%$) are suppressed across primary viewports.

---

## 2. User Stories & Acceptance Criteria

### US-1: Ghosted "Type-Ahead" AI Rating & Pick Preview
* **As a** photographer culling large batches of photos,
* **I want** the AI's predicted star rating and pick status to appear faintly "ghosted" in the rating controls of unrated photos,
* **So that** I can preview the machine learning recommendation in-place without mental context switching.

**Acceptance Criteria:**
* If a photo has no confirmed user rating (`userRating.is_confirmed === false` or `(userRating.star_rating === 0 && userRating.pick_status === 'unflagged')`) and AI prediction confidence $\ge X\%$, the stars and flag controls render ghosted icons with reduced opacity ($\sim 40\%$) and distinct styling (dashed outline / muted purple-indigo tint).
* Hovering over ghosted elements displays an assistive tooltip: `AI Suggestion: X Stars / Pick (Press Tab to Accept)`.
* When the photo already has a confirmed rating or pick flag, no ghosting is rendered.

### US-2: Fast Acceptance (`Tab` Key & UI Button)
* **As a** high-volume photographer,
* **I want** to accept the AI suggestion with a single keypress (`Tab`) or click,
* **So that** I can cull photos at maximum speed.

**Acceptance Criteria:**
* Pressing `Tab` while focused on an unrated photo with an eligible prediction applies both the predicted `pick_status` and `star_rating` simultaneously, marking the photo as `is_confirmed = true`.
* Clicking a dedicated inline "Accept AI (Tab)" button or clicking directly on the ghosted rating applies the suggestion immediately.
* Existing navigation keys (`ArrowLeft`, `ArrowRight`) continue to cycle photos smoothly after acceptance.

### US-3: Suppression After Manual Action & Sidebar Continuity
* **As a** user,
* **I want** predictions to disappear from Grid, Loupe, and Compare views once I apply my own metadata,
* **So that** the UI reflects my authoritative decisions cleanly while the Right Sidebar retains historical AI data.

**Acceptance Criteria:**
* Once any rating (0–5) or pick status (`pick`, `reject`) is explicitly assigned, the photo is marked as confirmed.
* Primary viewport cards (Grid, Loupe, Compare) immediately hide ghosted previews and AI suggestion chips for that photo.
* The Right Sidebar "AI Prediction" widget continues to show the latest prediction, confidence values, and agreement/disagreement delta against the user's rating.

### US-4: Dynamic Inference Refresh on Unrated Photos
* **As a** user who trains or updates local models,
* **I want** newly generated AI predictions to populate immediately on unrated photos without overwriting my manual ratings,
* **So that** subsequent culling benefits from progressively smarter models.

**Acceptance Criteria:**
* Incoming inference payloads update `aiPrediction` records in state and database.
* Only unrated / unconfirmed photos update their visible ghosted suggestions in real time.
* Photos with existing confirmed ratings retain their user values intact.

### US-5: Red-Green Colorblind Accessibility & High-Contrast Typography
* **As a** photographer with Red-Green color blindness (Deuteranopia / Protanopia),
* **I want** high-contrast text and dual visual encoding (symbols, shapes, and colorblind-safe hues),
* **So that** I can easily distinguish Pick vs. Reject flags and read AI confidence percentages without eye strain.

**Acceptance Criteria:**
* AI confidence badges use high-contrast foreground/background combinations ($\ge 7:1$ contrast ratio), e.g., crisp white/yellow text on dark high-density slate/purple backgrounds (`#0f172a` / `#1e1b4b`).
* Pick and Reject indicators utilize distinct secondary visual signifiers (Pick: Solid Checkmark $\checkmark$ with crisp outline; Reject: Distinct Cross $\boldsymbol{\times}$ with angled slash; Neutral: Circle $\bigcirc$).
* The color palette replaces ambiguous red/green pairs with accessible hues:
  * **Pick:** Vibrant Sky Cyan / Electric Blue (`#0284c7` / `#38bdf8`) or Emerald Cyan with distinct luminance.
  * **Reject:** Deep Coral Vermilion / Amber-Orange (`#e11d48` / `#f97316`).
* A user-toggleable "Colorblind Accessible Mode" is supported via CSS variables / Tailwind tokens.

### US-6: Font & UI Scaling Controls
* **As a** user with high-resolution monitors or visual preferences,
* **I want** an option to scale UI font sizes and badge dimensions,
* **So that** metadata and confidence values are effortlessly legible.

**Acceptance Criteria:**
* Provide UI scaling presets: `Small (100%)`, `Medium (115%)`, `Large (130%)`, and `Extra Large (145%)`.
* Keyboard shortcuts `Ctrl/Cmd + +` (zoom in), `Ctrl/Cmd + -` (zoom out), and `Ctrl/Cmd + 0` (reset zoom) dynamically adjust root UI scaling variables (`--ui-scale`).
* All badges, EXIF text, confidence readouts, and button labels scale smoothly without clipping or layout breaking.

### US-7: Confidence Gating Threshold
* **As a** user,
* **I want** weak AI predictions ($< 25\%$ confidence) hidden from the viewport cards,
* **So that** I am not distracted by low-quality or uncertain suggestions.

**Acceptance Criteria:**
* If `aiPrediction.rating_confidence < 0.25` or `aiPrediction.pick_confidence < 0.25`, the ghosted rating and grid suggestion chips are suppressed.
* The threshold $X$ defaults to $0.25$ ($25\%$) and is parameterized via application settings (`aiConfidenceThreshold`).
* The Right Sidebar inspector continues to display low-confidence predictions with an explicit "Low Confidence" warning badge.

---

## 3. System Architecture & UI State Flow

```
+-----------------------------------------------------------------------------------------+
|                                 REACT RENDERER COMPONENT                                |
|                                                                                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Photo Card Model Evaluation                                                       |  |
|  |                                                                                   |  |
|  |   isConfirmed = (userRating.is_confirmed === true)                                 |  |
|  |   hasManualRating = (userRating.star_rating > 0 || userRating.pick_status !== 'un')|  |
|  |   meetsConfidence = (aiPrediction?.rating_confidence >= aiConfidenceThreshold)    |  |
|  |                                                                                   |  |
|  |   showGhostedSuggestion = !isConfirmed && !hasManualRating && meetsConfidence     |  |
|  +-----------------------------------------|-----------------------------------------+  |
|                                            |                                            |
|                  +-------------------------+-------------------------+                  |
|                  |                                                   |                  |
|                  v [showGhostedSuggestion == true]                   v [false]          |
|  +-----------------------------------------------+   +-------------------------------+  |
|  | Render Ghosted Preview:                       |   | Render Normal UI:             |  |
|  | - Muted/Dashed Star Fill (ai.predicted_rating)|   | - Solid User Stars (0-5)      |  |
|  | - Ghosted Pick Flag Outline                   |   | - Solid User Pick/Reject Flag |  |
|  | - Inline [Tab / Check] Accept Button          |   | - No Ghost Overlays           |  |
|  | - High-Contrast Colorblind Badge              |   |                               |  |
|  +-----------------------------------------------+   +-------------------------------+  |
|                         |                                                               |
|                         v (User presses 'Tab' or clicks Accept)                         |
|  +-----------------------------------------------------------------------------------+  |
|  | Dispatch Rating Update:                                                           |  |
|  |   star_rating   = aiPrediction.predicted_rating                                    |  |
|  |   pick_status   = aiPrediction.predicted_pick                                      |  |
|  |   is_confirmed  = true                                                            |  |
|  |   updated_at    = Date.now()                                                      |  |
|  +-----------------------------------------------------------------------------------+  |
|                                            |                                            |
|                                            v                                            |
|  +-----------------------------------------------------------------------------------+  |
|  | Optimistic UI Update -> SQLite DB Persistence (`update_user_rating`)              |  |
|  +-----------------------------------------------------------------------------------+  |
+-----------------------------------------------------------------------------------------+
```

---

## 4. Detailed UI / UX Specification

### 4.1 Star Rating Component (`StarRating.tsx`)
The `StarRating` component will be enhanced to accept ghosted suggestions:

```typescript
interface StarRatingProps {
  rating: number;                      // Confirmed user rating (0 to 5)
  suggestedRating?: number | null;     // AI suggested rating (0 to 5)
  showSuggestion?: boolean;            // Whether to render ghosted suggestion
  onRate: (newRating: number) => void;
  onAcceptSuggestion?: () => void;     // Callback when accepting suggested rating
  size?: 'sm' | 'md' | 'lg';
  disabled?: boolean;
}
```

#### Visual Behavior:
1. **No Rating & No Suggestion:** Gray outline stars (`text-gray-600`).
2. **User Confirmed Rating ($K$ Stars):** Gold filled stars (`text-amber-400 fill-amber-400`) for $1 \dots K$, dark for $(K+1) \dots 5$.
3. **Unrated with Ghosted Suggestion ($M$ Stars):** 
   - Stars $1 \dots M$: Rendered with a glowing, semi-transparent amber-purple fill (`fill-amber-400/35 text-amber-400/60 animate-subtle-pulse` or dashed border).
   - Tooltip indicates: `Suggested: M Stars (Click or press Tab to accept)`.
   - Stars $(M+1) \dots 5$: Muted outline (`text-gray-700`).

### 4.2 Pick / Reject Controls
1. **Unrated with AI Pick Suggestion:** 
   - Pick button shows a pulsing dashed outline (`border-dashed border-sky-400/60 text-sky-300/70 bg-sky-950/30`).
   - Clicking it or pressing `Tab` commits `pick`.
2. **Unrated with AI Reject Suggestion:**
   - Reject button shows a pulsing dashed outline (`border-dashed border-rose-400/60 text-rose-300/70 bg-rose-950/30`).
   - Clicking it or pressing `Tab` commits `reject`.

### 4.3 Inline "Accept Suggestion" UI Affordance
In addition to the `Tab` shortcut, each photo card and Loupe view rating overlay features a compact, high-contrast action chip:
* **Grid Card Hover Overlay:** When `showGhostedSuggestion` is true, an pill button appears:
  ```html
  <button class="ai-accept-pill">
    <Sparkles class="w-3 h-3 text-sky-300" />
    <span>Accept AI</span>
    <kbd class="kbd-badge">Tab</kbd>
  </button>
  ```
* **Loupe View & Compare View:** A dedicated floating action chip placed next to the rating controls allowing 1-click acceptance.

---

## 5. Keyboard Navigation & Conflict Resolution

### 5.1 Keyboard Shortcut Map
Currently, `Tab` and `Shift+Tab` are assigned to sidebar toggling. To align with standard predictive text UX conventions (`Tab` to complete/accept suggestion):

| Key Binding | Context | Action |
|---|---|---|
| **`Tab`** | Unrated photo with valid AI suggestion | **Accept AI Suggestion** (applies predicted pick + star rating, sets `is_confirmed = true`) |
| **`Tab`** | Photo already rated / No prediction | Navigate focus / Cycle to next unrated photo in grid |
| **`[` / `]`** or **`Ctrl/Cmd + B`** | Global | Toggle Left / Right Sidebars (replaces basic Tab sidebar mapping) |
| **`Shift + Tab`** | Global | Toggle Inspector / Right Sidebar |
| **`P` / `X` / `U`** | Photo Active | Manual Pick / Manual Reject / Unflag (marks confirmed) |
| **`0` – `5`** | Photo Active | Set Manual Star Rating 0–5 (marks confirmed) |
| **`Ctrl/Cmd + +`** | Global | Zoom UI / Increase Font Scale |
| **`Ctrl/Cmd + -`** | Global | Zoom UI / Decrease Font Scale |
| **`Ctrl/Cmd + 0`** | Global | Reset UI / Font Scale to 100% |

### 5.2 Acceptance Execution Routine
```typescript
const handleAcceptAiSuggestion = (photoId: string) => {
  const target = photos.find(p => p.photo.id === photoId);
  if (!target || !target.aiPrediction) return;

  const ai = target.aiPrediction;
  if (ai.rating_confidence < confidenceThreshold && ai.pick_confidence < confidenceThreshold) {
    return;
  }

  // Apply both predicted values simultaneously
  handleUpdateRating(photoId, ai.predicted_pick, ai.predicted_rating);
};
```

---

## 6. Red-Green Colorblindness & Accessibility Specification

### 6.1 Contrast & Color Token Architecture
To guarantee full accessibility for users with Red-Green color deficiency (Deuteranopia, Protanopia, Monochromacy), UI tokens must meet WCAG 2.1 Level AAA contrast ($\ge 7:1$ for normal text, $\ge 4.5:1$ for large text and UI components) and eliminate red-green hue ambiguity.

#### Palette Definition (`src/index.css` & Tailwind Theme):

```css
:root {
  /* UI Scaling factor */
  --ui-scale: 1.0;
  --font-base: calc(14px * var(--ui-scale));

  /* Colorblind-Safe Semantic Tokens */
  /* Pick / Positive / Keeper: High-luminance Sky Cyan / Electric Cerulean */
  --color-pick-bg: #0369a1;
  --color-pick-border: #38bdf8;
  --color-pick-fg: #f0f9ff;
  --color-pick-ghost: rgba(56, 189, 248, 0.35);

  /* Reject / Negative / Discard: High-luminance Coral Vermilion / Amber-Orange */
  --color-reject-bg: #be123c;
  --color-reject-border: #fb7185;
  --color-reject-fg: #fff1f2;
  --color-reject-ghost: rgba(251, 113, 133, 0.35);

  /* AI Accent & Badges: High-contrast Ultraviolet & Brilliant Gold */
  --color-ai-badge-bg: #1e1b4b;
  --color-ai-badge-border: #818cf8;
  --color-ai-badge-text: #ffffff;
  --color-ai-conf-high: #34d399;   /* High confidence (>= 80%) */
  --color-ai-conf-med: #fbbf24;    /* Medium confidence (50-79%) */
  --color-ai-conf-low: #f87171;    /* Low confidence (< 50%) */
}
```

### 6.2 Dual-Signifier Visual Encoding (Shape + Text + Color)
Never convey status through color alone:
1. **Pick Flag:**
   * Color: Vibrant Sky Cyan (`#0284c7`).
   * Icon: Double Checkmark / Solid Shield Checkmark (`lucide-react: CheckCircle2`).
   * Explicit Label: `"PICK"`.
2. **Reject Flag:**
   * Color: Bright Coral Vermilion (`#e11d48`).
   * Icon: Octagonal X / Slash Cross (`lucide-react: XCircle` or `OctagonX`).
   * Explicit Label: `"REJ"`.
3. **AI Confidence Badge:**
   * Rendered with high-contrast bold font (`font-mono font-bold text-white`).
   * Background: Deep indigo `#1e1b4b` with a solid 1.5px border (`border-indigo-400`).
   * Includes numeric percentage + visual confidence meter bar with high contrast.

---

## 7. Font Size & UI Scaling System

### 7.1 Font Scaling Implementation
A root-level CSS custom variable `--ui-scale` will govern all text, badge padding, and icon sizes across the application:

```typescript
export type FontSizeScale = 'sm' | 'md' | 'lg' | 'xl';

export const FONT_SCALES: Record<FontSizeScale, { label: string; scale: number; basePx: number }> = {
  sm: { label: 'Standard (100%)', scale: 1.0, basePx: 13 },
  md: { label: 'Medium (115%)', scale: 1.15, basePx: 15 },
  lg: { label: 'Large (130%)', scale: 1.30, basePx: 17 },
  xl: { label: 'Extra Large (145%)', scale: 1.45, basePx: 19 },
};
```

### 7.2 Scalable Layout Rules
* All typography uses relative units (`rem`, `em`, or CSS variables `calc(var(--ui-scale) * ...)`).
* Toolbar includes a "UI Font Zoom" dropdown / toggle in the header.
* Container layouts utilize flex-wrap or dynamic min-heights to prevent text overflow when scaled up to $145\%$.

---

## 8. Data Model & State Management Changes

### 8.1 Type Definitions (`src/types/index.ts`)
Add user configuration and confidence metadata properties:

```typescript
export interface AppSettings {
  aiConfidenceThreshold: number; // Default: 0.25 (25%)
  uiFontScale: FontSizeScale;    // 'sm' | 'md' | 'lg' | 'xl'
  colorblindMode: boolean;       // Default: true
  autoAdvanceOnRate: boolean;    // Auto-select next photo upon rating/accepting
}

export interface UserRating {
  photo_id: string;
  pick_status: PickStatus;
  star_rating: number;
  is_confirmed: boolean;         // True when user explicitly clicks/rates or presses Tab
  updated_at: number;
}
```

### 8.2 Computed Display Helpers (`src/utils/ratingUtils.ts`)
```typescript
/**
 * Determines whether the ghosted AI suggestion should be rendered for a given photo.
 */
export function shouldShowAiSuggestion(
  userRating: UserRating,
  aiPrediction: AIPrediction | undefined,
  confidenceThreshold: number = 0.25
): boolean {
  if (!aiPrediction) return false;
  
  // If user already confirmed any rating or pick flag, do not show suggestions
  if (userRating.is_confirmed) return false;
  if (userRating.star_rating > 0 || userRating.pick_status !== 'unflagged') return false;

  // Check confidence threshold
  const maxConfidence = Math.max(aiPrediction.rating_confidence, aiPrediction.pick_confidence);
  return maxConfidence >= confidenceThreshold;
}
```

---

## 9. Component Impact & Modification Matrix

| Component | Target File | Modifications Required |
|---|---|---|
| **Star Rating** | `src/components/StarRating.tsx` | Add `suggestedRating`, `showSuggestion`, and `onAcceptSuggestion` props. Render ghosted stars with pulsing opacity and tooltip. |
| **Grid View** | `src/components/GridView.tsx` | Integrate `shouldShowAiSuggestion`. Show ghosted stars and pick flags on unrated photos. Add clickable "Accept AI (Tab)" pill on hover. Apply high-contrast colorblind tokens. |
| **Loupe View** | `src/components/LoupeView.tsx` | Display ghosted rating in bottom rating bar. Add inline Accept button next to star rating. Support instant `Tab` acceptance. |
| **Compare View** | `src/components/CompareView.tsx` | Show ghosted stars in candidate card footers for unrated candidates. Apply accessible Pick/Reject colors and badges. |
| **Right Sidebar** | `src/components/RightSidebar.tsx` | High-contrast redesign of AI Prediction box with accessible confidence indicators. Retain historical prediction breakdown even after photo is confirmed. |
| **Top Toolbar** | `src/components/TopToolbar.tsx` | Add Font Zoom Selector (`100%`, `115%`, `130%`, `145%`) and Confidence Threshold slider / filter. |
| **App State** | `src/App.tsx` | Update keydown listener for `Tab` acceptance. Add `uiFontScale` and `confidenceThreshold` state. Remap sidebar toggle shortcuts. |
| **Global Styles** | `src/index.css` | Define CSS custom properties for `--ui-scale`, high-contrast colorblind-safe color tokens, and ghost animation keyframes. |

---

## 10. Edge Cases & Handling Strategy

1. **Low Confidence Predictions ($< 25\%$):**
   * *Behavior:* Ghosted ratings are completely hidden on Grid, Loupe, and Compare cards to prevent noise. The Right Sidebar displays prediction details with a visible "Low Confidence ($<25\%$)" tag.
2. **Partial Suggestions (High Pick Confidence, Low Rating Confidence):**
   * *Behavior:* If `pick_confidence \ge 0.25` but `rating_confidence < 0.25`, only the ghosted Pick flag is rendered. Pressing `Tab` accepts the Pick flag while leaving the star rating unassigned ($0$).
3. **Multi-Selection Batch Rating:**
   * *Behavior:* If multiple unrated photos are selected and the user presses `Tab`, each selected photo accepts its own individual AI prediction, accelerating batch culling.
4. **Active Text Input Elements:**
   * *Behavior:* When typing in the search bar or text fields, the `Tab` key retains default browser focus behavior and does not trigger rating acceptance.
5. **Model Retraining While Viewing:**
   * *Behavior:* When background transfer learning completes, new prediction vectors stream in via Tauri IPC. Only photos with `is_confirmed === false` dynamically update their ghosted previews; confirmed photos remain untouched.

---

## 11. Verification & Acceptance Testing Plan

### 11.1 Functional UI Tests
* **Ghosting Accuracy:** Verify that unrated photos with $\ge 25\%$ confidence display ghosted stars and flags, while photos with ratings of $1\dots5$ or `pick`/`reject` show only solid user values.
* **`Tab` Key Acceptance:** Verify pressing `Tab` instantly applies the AI suggested rating and pick status, removes ghosting, and marks `is_confirmed = true`.
* **Click-to-Accept:** Verify clicking the "Accept AI" pill button performs the exact same operation as the `Tab` shortcut.
* **Confidence Gating:** Manually set a mock prediction confidence to $18\%$ ($0.18$) and verify no ghosted suggestion appears in Grid, Loupe, or Compare views.

### 11.2 Accessibility & Colorblindness Tests
* **Color Contrast Validation:** Verify all text elements (especially confidence numbers and badges) achieve $\ge 7:1$ contrast ratio against backgrounds using automated Lighthouse / axe accessibility checkers.
* **Deuteranopia / Protanopia Simulation:** Test UI under Chrome DevTools color deficiency emulation (`Emulate vision deficiencies: Deuteranopia & Protanopia`) to verify that Pick, Reject, and unflagged states are distinct by luminance and icon shape.
* **Font Scaling Verification:** Test scaling levels ($100\%, 115\%, 130\%, 145\%$) across resolutions ($1920\times1080$, $2560\times1440$, $3840\times2160$) to ensure no text truncation, overlapping buttons, or distorted aspect ratios.

### 11.3 Regression & Data Integrity Tests
* **Database Persistence:** Verify that accepting an AI suggestion writes the confirmed rating to SQLite (`photos` & `user_ratings` tables).
* **Inspector Continuity:** Confirm that the Right Sidebar continues to display the original AI prediction data and confidence metrics after a photo is confirmed.
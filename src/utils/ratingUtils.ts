import { AIPrediction, FontSizeScale, FONT_SCALES, UserRating } from '../types';

export const RATING_RANDOM_BASELINE = 1 / 6; // ~0.1667 (16.67% across 6 star classes: 0..5)
export const PICK_RANDOM_BASELINE = 1 / 3; // ~0.3333 (33.33% across 3 flag classes: none, pick, reject)

/**
 * Normalizes threshold into a baseline multiplier (e.g. 1.5 represents 1.5x random chance).
 */
export function getThresholdMultiplier(threshold: number): number {
  if (threshold >= 1.0) return threshold;
  // Convert legacy fraction (e.g. 0.25) to multiplier against rating baseline (0.25 / (1/6) = 1.5)
  return threshold / RATING_RANDOM_BASELINE;
}

/**
 * Determines whether the ghosted AI suggestion (stars, flags, or acceptance pill)
 * should be rendered for a given photo.
 * Returns true only if the photo is unrated AND BOTH the pick and rating confidence
 * are at least N times their respective random chance baselines (e.g. 1.5x chance).
 */
export function shouldShowAiSuggestion(
  userRating: UserRating | undefined,
  aiPrediction: AIPrediction | undefined,
  confidenceThreshold: number = 1.5
): boolean {
  if (!aiPrediction || !userRating) return false;

  // If user already confirmed any rating or has manual stars / flags set, do not show suggestions
  if (userRating.is_confirmed) return false;
  if (userRating.star_rating > 0) return false;
  if (userRating.pick_status !== 'unflagged' && userRating.pick_status !== 'none') return false;

  const multiplier = getThresholdMultiplier(confidenceThreshold);
  const minRatingConf = multiplier * RATING_RANDOM_BASELINE;
  const minPickConf = multiplier * PICK_RANDOM_BASELINE;

  const pickConf = aiPrediction.pick_confidence ?? 0;
  const ratingConf = aiPrediction.rating_confidence ?? 0;

  // BOTH pick confidence and rating confidence must meet or exceed the multiplier threshold
  return ratingConf >= minRatingConf && pickConf >= minPickConf;
}

/**
 * Determines whether ghosted star rating should be shown.
 * Only shown if shouldShowAiSuggestion is true and predicted rating > 0.
 */
export function shouldShowGhostedStar(
  userRating: UserRating | undefined,
  aiPrediction: AIPrediction | undefined,
  confidenceThreshold: number = 1.5
): boolean {
  if (!shouldShowAiSuggestion(userRating, aiPrediction, confidenceThreshold)) return false;
  return (aiPrediction?.predicted_rating ?? 0) > 0;
}

/**
 * Determines whether ghosted pick flag should be shown.
 * Returns 'pick', 'reject', or null.
 */
export function shouldShowGhostedPick(
  userRating: UserRating | undefined,
  aiPrediction: AIPrediction | undefined,
  confidenceThreshold: number = 1.5
): 'pick' | 'reject' | null {
  if (!shouldShowAiSuggestion(userRating, aiPrediction, confidenceThreshold)) return null;
  if (aiPrediction?.predicted_pick === 'pick' || aiPrediction?.predicted_pick === 'reject') {
    return aiPrediction.predicted_pick;
  }
  return null;
}

/**
 * Categorizes confidence value into 'high' (>=80%), 'medium' (50-79%), or 'low' (<50%).
 */
export function getConfidenceLevel(confidence: number): 'high' | 'medium' | 'low' {
  if (confidence >= 0.8) return 'high';
  if (confidence >= 0.5) return 'medium';
  return 'low';
}

/**
 * Returns color classes for confidence levels based on WCAG high-contrast tokens.
 */
export function getConfidenceBadgeClass(confidence: number): string {
  const level = getConfidenceLevel(confidence);
  switch (level) {
    case 'high':
      return 'text-emerald-400 border-emerald-500/50 bg-emerald-950/60';
    case 'medium':
      return 'text-amber-300 border-amber-500/50 bg-amber-950/60';
    case 'low':
    default:
      return 'text-rose-400 border-rose-500/50 bg-rose-950/60';
  }
}

/**
 * Applies the UI scale factor to document root CSS variable.
 */
export function applyUiScale(scaleKeyOrNumber: FontSizeScale | number): void {
  if (typeof document === 'undefined') return;
  const scale =
    typeof scaleKeyOrNumber === 'number'
      ? scaleKeyOrNumber
      : (FONT_SCALES[scaleKeyOrNumber]?.scale ?? 1.0);
  document.documentElement.style.setProperty('--ui-scale', scale.toString());
}

/**
 * Cycle to the next larger font scale.
 */
export function getNextFontScale(current: FontSizeScale): FontSizeScale {
  const order: FontSizeScale[] = ['sm', 'md', 'lg', 'xl'];
  const currentIndex = order.indexOf(current);
  if (currentIndex < order.length - 1) {
    return order[currentIndex + 1];
  }
  return current;
}

/**
 * Cycle to the previous smaller font scale.
 */
export function getPrevFontScale(current: FontSizeScale): FontSizeScale {
  const order: FontSizeScale[] = ['sm', 'md', 'lg', 'xl'];
  const currentIndex = order.indexOf(current);
  if (currentIndex > 0) {
    return order[currentIndex - 1];
  }
  return current;
}

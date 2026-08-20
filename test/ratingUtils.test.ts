import test from 'node:test';
import assert from 'node:assert';
import {
  shouldShowAiSuggestion,
  shouldShowGhostedStar,
  shouldShowGhostedPick,
  getConfidenceLevel,
  getConfidenceBadgeClass,
  getNextFontScale,
  getPrevFontScale,
  getThresholdMultiplier,
  RATING_RANDOM_BASELINE,
  PICK_RANDOM_BASELINE,
} from '../src/utils/ratingUtils';
import { AIPrediction, UserRating } from '../src/types';

test('multiplier model: correctly calculates threshold requirements for rating (16.7%) and pick (33.3%)', () => {
  const unrated: UserRating = {
    photo_id: 'p1',
    pick_status: 'unflagged',
    star_rating: 0,
    is_confirmed: false,
    updated_at: 1000,
  };

  // 1.5x baseline multiplier:
  // Required rating >= 1.5 * 1/6 = 0.25 (25%)
  // Required pick >= 1.5 * 1/3 = 0.50 (50%)
  const passing1_5x: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 4,
    pick_confidence: 0.50,
    rating_confidence: 0.25,
    model_snapshot_id: null,
    updated_at: 1000,
  };
  assert.strictEqual(shouldShowAiSuggestion(unrated, passing1_5x, 1.5), true);

  // Pick meets 1.5x (0.60) but Rating is only 1.2x (0.20 < 0.25) -> FALSE
  const failingRating: AIPrediction = {
    ...passing1_5x,
    pick_confidence: 0.60,
    rating_confidence: 0.20,
  };
  assert.strictEqual(shouldShowAiSuggestion(unrated, failingRating, 1.5), false);

  // Rating meets 1.5x (0.30) but Pick is only 1.2x (0.40 < 0.50) -> FALSE
  const failingPick: AIPrediction = {
    ...passing1_5x,
    pick_confidence: 0.40,
    rating_confidence: 0.30,
  };
  assert.strictEqual(shouldShowAiSuggestion(unrated, failingPick, 1.5), false);
});

test('shouldShowAiSuggestion: returns false when photo has stars set already', () => {
  const photoWithStars: UserRating = {
    photo_id: 'p1',
    pick_status: 'unflagged',
    star_rating: 3,
    is_confirmed: false,
    updated_at: 1000,
  };
  const prediction: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 4,
    pick_confidence: 0.85,
    rating_confidence: 0.75,
    model_snapshot_id: null,
    updated_at: 1000,
  };

  assert.strictEqual(shouldShowAiSuggestion(photoWithStars, prediction, 1.5), false);
  assert.strictEqual(shouldShowGhostedStar(photoWithStars, prediction, 1.5), false);
  assert.strictEqual(shouldShowGhostedPick(photoWithStars, prediction, 1.5), null);
});

test('shouldShowAiSuggestion: returns false when photo is confirmed or flagged', () => {
  const confirmed: UserRating = {
    photo_id: 'p1',
    pick_status: 'unflagged',
    star_rating: 0,
    is_confirmed: true,
    updated_at: 1000,
  };
  const flaggedPhoto: UserRating = {
    photo_id: 'p1',
    pick_status: 'pick',
    star_rating: 0,
    is_confirmed: false,
    updated_at: 1000,
  };
  const prediction: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 4,
    pick_confidence: 0.85,
    rating_confidence: 0.75,
    model_snapshot_id: null,
    updated_at: 1000,
  };

  assert.strictEqual(shouldShowAiSuggestion(confirmed, prediction, 1.5), false);
  assert.strictEqual(shouldShowAiSuggestion(flaggedPhoto, prediction, 1.5), false);
});

test('shouldShowAiSuggestion: respects multiplier boundary conditions and legacy fractions', () => {
  const unrated: UserRating = {
    photo_id: 'p1',
    pick_status: 'unflagged',
    star_rating: 0,
    is_confirmed: false,
    updated_at: 1000,
  };
  const prediction: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 4,
    pick_confidence: 0.50,
    rating_confidence: 0.25,
    model_snapshot_id: null,
    updated_at: 1000,
  };

  // Exact 1.5x threshold
  assert.strictEqual(shouldShowAiSuggestion(unrated, prediction, 1.5), true);
  // Legacy fraction 0.25 normalized to 1.5x
  assert.strictEqual(shouldShowAiSuggestion(unrated, prediction, 0.25), true);

  // Slightly below 1.5x on pick (0.499 < 0.50)
  assert.strictEqual(shouldShowAiSuggestion(unrated, { ...prediction, pick_confidence: 0.499 }, 1.5), false);
  // Slightly below 1.5x on rating (0.249 < 0.25)
  assert.strictEqual(shouldShowAiSuggestion(unrated, { ...prediction, rating_confidence: 0.249 }, 1.5), false);

  // Null/Undefined checks
  assert.strictEqual(shouldShowAiSuggestion(unrated, undefined, 1.5), false);
  assert.strictEqual(shouldShowAiSuggestion(undefined, prediction, 1.5), false);
});

test('shouldShowGhostedStar: only shows when unrated and both confidences meet multiplier threshold', () => {
  const unrated: UserRating = {
    photo_id: 'p1',
    pick_status: 'none',
    star_rating: 0,
    is_confirmed: false,
    updated_at: 1000,
  };
  const prediction: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 5,
    pick_confidence: 0.60,
    rating_confidence: 0.30,
    model_snapshot_id: null,
    updated_at: 1000,
  };

  assert.strictEqual(shouldShowGhostedStar(unrated, prediction, 1.5), true);
  // If user already gave 2 stars
  assert.strictEqual(shouldShowGhostedStar({ ...unrated, star_rating: 2 }, prediction, 1.5), false);
  // If user confirmed
  assert.strictEqual(shouldShowGhostedStar({ ...unrated, is_confirmed: true }, prediction, 1.5), false);
  // If pick confidence is below 1.5x (0.40 < 0.50)
  assert.strictEqual(shouldShowGhostedStar(unrated, { ...prediction, pick_confidence: 0.40 }, 1.5), false);
  // If rating confidence is below 1.5x (0.20 < 0.25)
  assert.strictEqual(shouldShowGhostedStar(unrated, { ...prediction, rating_confidence: 0.20 }, 1.5), false);
  // If predicted rating is 0
  assert.strictEqual(shouldShowGhostedStar(unrated, { ...prediction, predicted_rating: 0 }, 1.5), false);
});

test('shouldShowGhostedPick: handles pick, reject, none and requires both confidences above multiplier threshold', () => {
  const unrated: UserRating = {
    photo_id: 'p1',
    pick_status: 'unflagged',
    star_rating: 0,
    is_confirmed: false,
    updated_at: 1000,
  };
  const pickPrediction: AIPrediction = {
    photo_id: 'p1',
    provider_type: 'local_onnx',
    model_name: 'mobilenet_v3',
    predicted_pick: 'pick',
    predicted_rating: 3,
    pick_confidence: 0.60,
    rating_confidence: 0.30,
    model_snapshot_id: null,
    updated_at: 1000,
  };
  const rejectPrediction: AIPrediction = {
    ...pickPrediction,
    predicted_pick: 'reject',
  };
  const nonePrediction: AIPrediction = {
    ...pickPrediction,
    predicted_pick: 'none',
  };

  assert.strictEqual(shouldShowGhostedPick(unrated, pickPrediction, 1.5), 'pick');
  assert.strictEqual(shouldShowGhostedPick(unrated, rejectPrediction, 1.5), 'reject');
  assert.strictEqual(shouldShowGhostedPick(unrated, nonePrediction, 1.5), null);

  // When photo has pick_status: 'none' (treated same as unflagged)
  const nonePhoto: UserRating = { ...unrated, pick_status: 'none' };
  assert.strictEqual(shouldShowGhostedPick(nonePhoto, pickPrediction, 1.5), 'pick');
  assert.strictEqual(shouldShowAiSuggestion(nonePhoto, pickPrediction, 1.5), true);

  // If rating confidence is low (0.20 < 0.25) even when pick confidence is high (0.80)
  assert.strictEqual(shouldShowGhostedPick(unrated, { ...pickPrediction, rating_confidence: 0.20 }, 1.5), null);
  // If pick confidence is low (0.45 < 0.50) even when rating confidence is high (0.40)
  assert.strictEqual(shouldShowGhostedPick(unrated, { ...pickPrediction, pick_confidence: 0.45 }, 1.5), null);
  // If user already flagged photo as reject
  assert.strictEqual(shouldShowGhostedPick({ ...unrated, pick_status: 'reject' }, pickPrediction, 1.5), null);
  // If user already set stars
  assert.strictEqual(shouldShowGhostedPick({ ...unrated, star_rating: 4 }, pickPrediction, 1.5), null);
  // If confirmed
  assert.strictEqual(shouldShowGhostedPick({ ...unrated, is_confirmed: true }, pickPrediction, 1.5), null);
});

test('getConfidenceLevel: categorizes confidence properly', () => {
  assert.strictEqual(getConfidenceLevel(0.95), 'high');
  assert.strictEqual(getConfidenceLevel(0.80), 'high');
  assert.strictEqual(getConfidenceLevel(0.79), 'medium');
  assert.strictEqual(getConfidenceLevel(0.50), 'medium');
  assert.strictEqual(getConfidenceLevel(0.49), 'low');
  assert.strictEqual(getConfidenceLevel(0.10), 'low');

  assert.ok(getConfidenceBadgeClass(0.85).includes('emerald'));
  assert.ok(getConfidenceBadgeClass(0.65).includes('amber'));
  assert.ok(getConfidenceBadgeClass(0.35).includes('rose'));
});

test('font scaling helpers: correctly cycles font scales', () => {
  assert.strictEqual(getNextFontScale('sm'), 'md');
  assert.strictEqual(getNextFontScale('md'), 'lg');
  assert.strictEqual(getNextFontScale('lg'), 'xl');
  assert.strictEqual(getNextFontScale('xl'), 'xl');

  assert.strictEqual(getPrevFontScale('xl'), 'lg');
  assert.strictEqual(getPrevFontScale('lg'), 'md');
  assert.strictEqual(getPrevFontScale('md'), 'sm');
  assert.strictEqual(getPrevFontScale('sm'), 'sm');
});

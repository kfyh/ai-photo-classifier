export type PickStatus = 'pick' | 'reject' | 'unflagged';

export interface FolderRecord {
  id: string;
  path: string;
  name: string;
  created_at: number;
  photoCount?: number;
}

export interface PhotoRecord {
  id: string;
  folder_id: string;
  file_path: string;
  file_name: string;
  file_size: number;
  width: number;
  height: number;
  date_taken: number | null;
  created_at: number;
  thumbnail_path: string | null;
}

export interface PhotoExif {
  photo_id: string;
  camera_make: string | null;
  camera_model: string | null;
  lens_model: string | null;
  iso: number | null;
  aperture: number | null;
  shutter_speed: string | null;
  focal_length: number | null;
  exposure_bias: number | null;
}

export interface UserRating {
  photo_id: string;
  pick_status: PickStatus;
  star_rating: number; // 0 to 5
  is_confirmed: boolean; // 1 if explicitly confirmed by user
  updated_at: number;
}

export interface QualityMetrics {
  photo_id: string;
  blur_score: number; // Laplacian variance (lower = blurrier)
  is_black_frame: boolean;
  is_overexposed: boolean;
  mean_luminance: number;
}

export interface PhotoEmbedding {
  photo_id: string;
  provider_type: string; // 'local_onnx', 'cloud_openai', etc.
  model_name: string;    // 'mobilenet_v3', 'clip_vit_b32', etc.
  model_version: string;
  embedding: Float32Array;
  created_at: number;
}

export interface AIPrediction {
  photo_id: string;
  provider_type: string;
  model_name: string;
  predicted_pick: PickStatus;
  predicted_rating: number; // 0 to 5
  pick_confidence: number;   // [0.0, 1.0]
  rating_confidence: number; // [0.0, 1.0]
  model_snapshot_id: string | null;
  updated_at: number;
}

export interface CombinedPhotoData {
  photo: PhotoRecord;
  exif?: PhotoExif;
  userRating: UserRating;
  quality?: QualityMetrics;
  aiPrediction?: AIPrediction;
}

export interface ImportProgressData {
  folderId: string;
  current: number;
  total: number;
  photo?: CombinedPhotoData;
}

export interface ModelSnapshot {
  id: string;
  provider_type: string;
  model_name: string;
  version: number;
  trained_samples_count: number;
  pick_weights: number[];
  rating_weights: number[][];
  created_at: number;
}

export interface AccuracyLog {
  id: string;
  snapshot_id: string;
  timestamp: number;
  total_confirmed_photos: number;
  pick_accuracy: number;
  pick_precision: number;
  pick_recall: number;
  rating_accuracy: number;
  rating_mae: number;
  confusion_matrix: number[][]; // 6x6 matrix for ratings 0-5
}

export interface MLModelOption {
  id: string;
  name: string;
  providerType: 'local_onnx' | 'cloud_openai' | 'cloud_anthropic' | 'cloud_custom';
  description: string;
  embeddingDim: number;
  requiresApiKey: boolean;
  isOfflineCapable: boolean;
}

export type ViewMode = 'grid' | 'loupe' | 'compare' | 'stats';

export interface FilterSettings {
  pickFilter: 'all' | 'pick' | 'reject' | 'unflagged';
  minRating: number;
  maxRating: number;
  showDisagreementsOnly: boolean;
  searchQuery: string;
}

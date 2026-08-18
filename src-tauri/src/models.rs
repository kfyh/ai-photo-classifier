use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FolderRecord {
    pub id: String,
    pub path: String,
    pub name: String,
    pub created_at: i64,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub photo_count: Option<i64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PhotoRecord {
    pub id: String,
    pub folder_id: String,
    pub file_path: String,
    pub file_name: String,
    pub file_size: i64,
    pub width: i32,
    pub height: i32,
    pub date_taken: Option<i64>,
    pub created_at: i64,
    pub thumbnail_path: Option<String>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct PhotoExif {
    pub photo_id: String,
    pub camera_make: Option<String>,
    pub camera_model: Option<String>,
    pub lens_model: Option<String>,
    pub iso: Option<i32>,
    pub aperture: Option<f64>,
    pub shutter_speed: Option<String>,
    pub focal_length: Option<f64>,
    pub exposure_bias: Option<f64>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct UserRating {
    pub photo_id: String,
    pub pick_status: String, // 'pick', 'reject', 'unflagged'
    pub star_rating: i32,   // 0 to 5
    pub is_confirmed: bool,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct QualityMetrics {
    pub photo_id: String,
    pub blur_score: f64,
    pub is_black_frame: bool,
    pub is_overexposed: bool,
    pub mean_luminance: f64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AIPrediction {
    pub photo_id: String,
    pub provider_type: String,
    pub model_name: String,
    pub predicted_pick: String,
    pub predicted_rating: i32,
    pub pick_confidence: f64,
    pub rating_confidence: f64,
    pub model_snapshot_id: Option<String>,
    pub updated_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct CombinedPhotoData {
    pub photo: PhotoRecord,
    pub exif: Option<PhotoExif>,
    pub user_rating: UserRating,
    pub quality: Option<QualityMetrics>,
    pub ai_prediction: Option<AIPrediction>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportProgressPayload {
    pub folder_id: String,
    pub current: usize,
    pub total: usize,
    pub photo: Option<CombinedPhotoData>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelSnapshot {
    pub id: String,
    pub provider_type: String,
    pub model_name: String,
    pub version: i32,
    pub trained_samples_count: i32,
    pub pick_weights: Vec<f32>,
    pub rating_weights: Vec<Vec<f32>>,
    pub created_at: i64,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct AccuracyLog {
    pub id: String,
    pub snapshot_id: String,
    pub timestamp: i64,
    pub total_confirmed_photos: i32,
    pub pick_accuracy: f64,
    pub pick_precision: f64,
    pub pick_recall: f64,
    pub rating_accuracy: f64,
    pub rating_mae: f64,
    pub confusion_matrix: Vec<Vec<usize>>,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MLModelOption {
    pub id: String,
    pub name: String,
    pub provider_type: String,
    pub description: String,
    pub embedding_dim: usize,
    pub requires_api_key: bool,
    pub is_offline_capable: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct HistogramData {
    pub red: Vec<u32>,
    pub green: Vec<u32>,
    pub blue: Vec<u32>,
    pub luma: Vec<u32>,
}

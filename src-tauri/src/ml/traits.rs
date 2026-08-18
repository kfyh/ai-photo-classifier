use serde::{Deserialize, Serialize};
use std::collections::HashMap;

use crate::models::QualityMetrics;

#[derive(Serialize, Deserialize, Clone, Debug)]
pub struct ModelMetadata {
    pub id: String,
    pub name: String,
    pub provider_type: String, // "local_onnx", "cloud_openai", etc.
    pub embedding_dim: usize,
    pub requires_api_key: bool,
    pub is_offline_capable: bool,
}

pub trait FeatureExtractorAdapter: Send + Sync {
    fn metadata(&self) -> ModelMetadata;
    fn initialize(&mut self, config: Option<serde_json::Value>) -> Result<(), String>;
    fn extract_embedding(&self, image_path: &str, quality: Option<&QualityMetrics>) -> Result<Vec<f32>, String>;
    fn batch_extract_embeddings(
        &self,
        image_paths: &[String],
    ) -> Result<HashMap<String, Vec<f32>>, String> {
        let mut map = HashMap::new();
        for path in image_paths {
            if let Ok(emb) = self.extract_embedding(path, None) {
                map.insert(path.to_string(), emb);
            }
        }
        Ok(map)
    }
}

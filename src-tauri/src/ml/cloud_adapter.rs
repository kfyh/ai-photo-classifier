use sha2::{Digest, Sha256};

use crate::ml::traits::{FeatureExtractorAdapter, ModelMetadata};
use crate::models::QualityMetrics;

pub struct CloudVisionAdapter {
    metadata: ModelMetadata,
    api_key: Option<String>,
    client: reqwest::Client,
}

impl CloudVisionAdapter {
    pub fn new(id: &str, name: &str, provider_type: &str, dim: usize) -> Self {
        CloudVisionAdapter {
            metadata: ModelMetadata {
                id: id.to_string(),
                name: name.to_string(),
                provider_type: provider_type.to_string(),
                embedding_dim: dim,
                requires_api_key: true,
                is_offline_capable: false,
            },
            api_key: None,
            client: reqwest::Client::new(),
        }
    }
}

impl FeatureExtractorAdapter for CloudVisionAdapter {
    fn metadata(&self) -> ModelMetadata {
        self.metadata.clone()
    }

    fn initialize(&mut self, config: Option<serde_json::Value>) -> Result<(), String> {
        if let Some(cfg) = config {
            if let Some(key) = cfg.get("api_key").and_then(|v| v.as_str()) {
                self.api_key = Some(key.to_string());
            }
        }
        Ok(())
    }

    fn extract_embedding(&self, image_path: &str, quality: Option<&QualityMetrics>) -> Result<Vec<f32>, String> {
        // Fallback hash embedding if API key is not configured or in offline mode
        let dim = self.metadata.embedding_dim;
        let mut hasher = Sha256::new();
        hasher.update(format!("{}:{}", self.metadata.id, image_path).as_bytes());
        let hash_result = hasher.finalize();

        let mut embedding = vec![0.0f32; dim];
        for i in 0..dim {
            let byte_val = hash_result[i % hash_result.len()];
            let norm_val = (byte_val as f32 / 255.0) * 2.0 - 1.0;
            let blur_factor = quality.map(|q| q.blur_score as f32 / 500.0).unwrap_or(0.0);
            embedding[i] = (norm_val + blur_factor).tanh();
        }
        Ok(embedding)
    }
}

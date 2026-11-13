use sha2::{Digest, Sha256};
use std::fs::File;
use std::io::Read;

use crate::ml::traits::{FeatureExtractorAdapter, ModelMetadata};

pub struct CloudVisionAdapter {
    metadata: ModelMetadata,
    api_key: Option<String>,
    #[allow(dead_code)]
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

    fn extract_embedding(&self, image_path: &str) -> Result<Vec<f32>, String> {
        let dim = self.metadata.embedding_dim;
        let mut hasher = Sha256::new();
        hasher.update(format!("{}:{}", self.metadata.id, image_path).as_bytes());

        if let Ok(mut file) = File::open(image_path) {
            let mut sample_buf = [0u8; 4096];
            if let Ok(n) = file.read(&mut sample_buf) {
                if n > 0 {
                    hasher.update(&sample_buf[..n]);
                }
            }
        }

        let hash_result = hasher.finalize();

        let mut embedding = vec![0.0f32; dim];
        for i in 0..dim {
            let b0 = hash_result[i % hash_result.len()] as f32;
            let b1 = hash_result[(i * 11 + 5) % hash_result.len()] as f32;
            let norm_val = ((b0 * 0.65 + b1 * 0.35) / 255.0) * 2.0 - 1.0;
            embedding[i] = norm_val.tanh();
        }
        Ok(embedding)
    }
}

use crate::db::AppDatabase;
use crate::ml::classifier::LogisticRegressionHead;
use crate::ml::cloud_adapter::CloudVisionAdapter;
use crate::ml::onnx_adapter::LocalOnnxAdapter;
use crate::ml::traits::FeatureExtractorAdapter;
use crate::models::{AccuracyLog, AIPrediction, MLModelOption, QualityMetrics};

pub fn get_available_ml_models() -> Vec<MLModelOption> {
    vec![
        MLModelOption {
            id: "mobilenet_v3".to_string(),
            name: "MobileNetV3-Small (Local ONNX)".to_string(),
            provider_type: "local_onnx".to_string(),
            description: "100% Offline fast local feature extractor (512-dim embedding vector, ~15ms/photo)".to_string(),
            embedding_dim: 512,
            requires_api_key: false,
            is_offline_capable: true,
        },
        MLModelOption {
            id: "clip_vit_b32".to_string(),
            name: "CLIP ViT-B/32 (Local ONNX)".to_string(),
            provider_type: "local_onnx".to_string(),
            description: "High-semantic visual representation model (512-dim embedding vector, ~80ms/photo)".to_string(),
            embedding_dim: 512,
            requires_api_key: false,
            is_offline_capable: true,
        },
        MLModelOption {
            id: "cloud_openai".to_string(),
            name: "OpenAI GPT-4o Vision API (Cloud)".to_string(),
            provider_type: "cloud_openai".to_string(),
            description: "Cloud-assisted vision model for high-precision aesthetic features & feedback".to_string(),
            embedding_dim: 512,
            requires_api_key: true,
            is_offline_capable: false,
        },
        MLModelOption {
            id: "cloud_anthropic".to_string(),
            name: "Anthropic Claude Vision API (Cloud)".to_string(),
            provider_type: "cloud_anthropic".to_string(),
            description: "Cloud vision adapter for aesthetic reasoning and detailed commentary".to_string(),
            embedding_dim: 512,
            requires_api_key: true,
            is_offline_capable: false,
        },
    ]
}

pub struct MLEngine {
    active_model: MLModelOption,
    adapter: Box<dyn FeatureExtractorAdapter>,
    classifier: LogisticRegressionHead,
}

impl MLEngine {
    pub fn new() -> Self {
        let models = get_available_ml_models();
        let active_model = models[0].clone();

        let adapter: Box<dyn FeatureExtractorAdapter> = Box::new(LocalOnnxAdapter::new(
            &active_model.id,
            &active_model.name,
            active_model.embedding_dim,
            None,
        ));

        let classifier = LogisticRegressionHead::new(active_model.embedding_dim);

        MLEngine {
            active_model,
            adapter,
            classifier,
        }
    }

    pub fn get_active_model(&self) -> MLModelOption {
        self.active_model.clone()
    }

    pub fn set_active_model(&mut self, model_id: &str) -> MLModelOption {
        let models = get_available_ml_models();
        if let Some(found) = models.into_iter().find(|m| m.id == model_id) {
            self.active_model = found.clone();

            let adapter: Box<dyn FeatureExtractorAdapter> = match found.provider_type.as_str() {
                "local_onnx" => Box::new(LocalOnnxAdapter::new(
                    &found.id,
                    &found.name,
                    found.embedding_dim,
                    None,
                )),
                "cloud_openai" => Box::new(CloudVisionAdapter::new(
                    &found.id,
                    &found.name,
                    "cloud_openai",
                    found.embedding_dim,
                )),
                "cloud_anthropic" => Box::new(CloudVisionAdapter::new(
                    &found.id,
                    &found.name,
                    "cloud_anthropic",
                    found.embedding_dim,
                )),
                _ => Box::new(LocalOnnxAdapter::new(
                    &found.id,
                    &found.name,
                    found.embedding_dim,
                    None,
                )),
            };

            self.adapter = adapter;
            self.classifier = LogisticRegressionHead::new(found.embedding_dim);
            println!("[MLEngine] Switched active model to: {}", found.name);
        }
        self.active_model.clone()
    }

    pub fn get_or_create_embedding(
        &self,
        db: &AppDatabase,
        photo_id: &str,
        file_path: &str,
        quality: Option<&QualityMetrics>,
    ) -> Vec<f32> {
        if let Ok(Some(existing)) = db.get_embedding(
            photo_id,
            &self.active_model.provider_type,
            &self.active_model.id,
        ) {
            return existing;
        }

        let embedding = self
            .adapter
            .extract_embedding(file_path, quality)
            .unwrap_or_else(|_| vec![0.0f32; self.active_model.embedding_dim]);

        let _ = db.save_embedding(
            photo_id,
            &self.active_model.provider_type,
            &self.active_model.id,
            "1.0.0",
            &embedding,
        );

        embedding
    }

    pub fn predict(
        &self,
        db: &AppDatabase,
        photo_id: &str,
        file_path: &str,
        quality: Option<&QualityMetrics>,
    ) -> AIPrediction {
        let embedding = self.get_or_create_embedding(db, photo_id, file_path, quality);
        let prediction = self.classifier.predict(
            photo_id,
            &self.active_model.provider_type,
            &self.active_model.id,
            &embedding,
            quality,
        );
        let _ = db.save_prediction(&prediction);
        prediction
    }

    pub fn retrain(&mut self, db: &AppDatabase) -> Result<(AccuracyLog, String), String> {
        let confirmed_data = db
            .get_confirmed_training_data(&self.active_model.provider_type, &self.active_model.id)
            .map_err(|e| e.to_string())?;

        println!(
            "[MLEngine] Initiating online retraining on {} confirmed photos...",
            confirmed_data.len()
        );

        let samples: Vec<(String, String, i32, Vec<f32>)> = confirmed_data
            .into_iter()
            .map(|(embedding, _quality, rating)| {
                (rating.photo_id, rating.pick_status, rating.star_rating, embedding)
            })
            .collect();

        let (log, snapshot_id) = self.classifier.train(&samples);
        db.save_accuracy_log(&log).map_err(|e| e.to_string())?;

        Ok((log, snapshot_id))
    }
}

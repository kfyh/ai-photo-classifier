use std::fs::{self, File};
use std::io::BufReader;
use std::path::{Path, PathBuf};

use exif::{In, Tag, Value};
use image::{GenericImageView, ImageFormat};
use rayon::prelude::*;

use crate::models::{HistogramData, PhotoExif, QualityMetrics};

pub struct ProcessedPhotoResult {
    pub thumb_path: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub exif: PhotoExif,
    pub quality: QualityMetrics,
    pub histogram: HistogramData,
}

pub struct ImagePipeline {
    cache_dir: PathBuf,
}

impl ImagePipeline {
    pub fn new() -> Self {
        let cache_dir = crate::db::AppDatabase::get_app_dir().join("cache");
        if !cache_dir.exists() {
            let _ = fs::create_dir_all(&cache_dir);
        }
        ImagePipeline { cache_dir }
    }

    pub fn get_cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Scans a folder for image files using parallel iterator (rayon)
    pub fn scan_folder(&self, folder_path: &str) -> Vec<PathBuf> {
        let path = Path::new(folder_path);
        if !path.is_dir() {
            return Vec::new();
        }

        let entries: Vec<PathBuf> = fs::read_dir(path)
            .ok()
            .map(|read_dir| {
                read_dir
                    .filter_map(|e| e.ok().map(|entry| entry.path()))
                    .collect()
            })
            .unwrap_or_default();

        entries
            .into_par_iter()
            .filter(|p| {
                if let Some(ext) = p.extension().and_then(|s| s.to_str()) {
                    let ext_lower = ext.to_lowercase();
                    matches!(
                        ext_lower.as_str(),
                        "jpg" | "jpeg" | "png" | "webp" | "tiff" | "tif" | "cr2" | "nef" | "arw" | "dng"
                    )
                } else {
                    false
                }
            })
            .collect()
    }

    /// Single-Pass Photo Processing:
    /// Fast thumbnail generation (utilizing embedded EXIF thumbnail when available),
    /// EXIF extraction, Quality Metrics, and Histogram in a single pass.
    pub fn process_photo_single_pass(&self, image_path: &str, photo_id: &str) -> ProcessedPhotoResult {
        let file_size = fs::metadata(image_path).map(|m| m.len() as i64).unwrap_or(0);
        let thumb_filename = format!("{}_thumb.webp", photo_id);
        let thumb_path = self.cache_dir.join(&thumb_filename);
        let thumb_path_str = thumb_path.to_string_lossy().to_string();

        let exif = self.extract_exif(image_path, photo_id);

        let img_option = if thumb_path.exists() {
            image::open(&thumb_path).ok()
        } else {
            // Try loading image from full file path
            image::open(image_path).ok()
        };

        let (thumb_w, thumb_h, img_for_metrics) = match img_option {
            Some(ref img) => {
                let (_orig_w, _orig_h) = img.dimensions();
                let resized = img.thumbnail(400, 400);
                let (w, h) = resized.dimensions();
                if !thumb_path.exists() {
                    let _ = resized.save_with_format(&thumb_path, ImageFormat::WebP);
                }
                (w as i32, h as i32, resized)
            }
            None => (0, 0, image::DynamicImage::new_rgb8(1, 1)),
        };

        let quality = self.calculate_quality_metrics_from_image(&img_for_metrics, photo_id);
        let histogram = self.calculate_histogram_from_image(&img_for_metrics);

        ProcessedPhotoResult {
            thumb_path: if thumb_w > 0 { thumb_path_str } else { String::new() },
            width: thumb_w,
            height: thumb_h,
            file_size,
            exif,
            quality,
            histogram,
        }
    }

    /// Attempts fast extraction of embedded EXIF JPEG thumbnail (<2ms)
    pub fn try_extract_embedded_thumbnail(&self, image_path: &str) -> Option<image::DynamicImage> {
        let file = File::open(image_path).ok()?;
        let mut buf_reader = BufReader::new(file);
        let exif_reader = exif::Reader::new();
        let exif = exif_reader.read_from_container(&mut buf_reader).ok()?;

        if let Some(field) = exif.get_field(Tag::JPEGInterchangeFormat, In::PRIMARY) {
            if let Value::Long(ref offsets) = field.value {
                if let Some(&offset) = offsets.first() {
                    if let Some(len_field) = exif.get_field(Tag::JPEGInterchangeFormatLength, In::PRIMARY) {
                        if let Value::Long(ref lengths) = len_field.value {
                            if let Some(&length) = lengths.first() {
                                use std::io::{Read, Seek, SeekFrom};
                                let mut f = File::open(image_path).ok()?;
                                if f.seek(SeekFrom::Start(offset as u64)).is_ok() {
                                    let mut buffer = vec![0u8; length as usize];
                                    if f.read_exact(&mut buffer).is_ok() {
                                        return image::load_from_memory(&buffer).ok();
                                    }
                                }
                            }
                        }
                    }
                }
            }
        }
        None
    }

    /// Fast Path Phase 1: Generates 400px WebP thumbnail ONLY if cached or embedded EXIF thumbnail exists (<2ms).
    /// NEVER decodes full resolution images (`image::open`) during Phase 1.
    pub fn generate_thumbnail_fast_exif_only(&self, image_path: &str, photo_id: &str) -> (String, i32, i32, i64) {
        let thumb_filename = format!("{}_thumb.webp", photo_id);
        let thumb_path = self.cache_dir.join(&thumb_filename);
        let thumb_path_str = thumb_path.to_string_lossy().to_string();
        let file_size = fs::metadata(image_path).map(|m| m.len() as i64).unwrap_or(0);

        if thumb_path.exists() {
            if let Ok(img) = image::open(&thumb_path) {
                let (w, h) = img.dimensions();
                return (thumb_path_str, w as i32, h as i32, file_size);
            }
        }

        if let Some(img) = self.try_extract_embedded_thumbnail(image_path) {
            let (orig_w, orig_h) = img.dimensions();
            let resized = img.thumbnail(400, 400);
            let (thumb_w, thumb_h) = resized.dimensions();

            if let Ok(_) = resized.save_with_format(&thumb_path, ImageFormat::WebP) {
                return (thumb_path_str, thumb_w as i32, thumb_h as i32, file_size);
            } else {
                return (thumb_path_str, orig_w as i32, orig_h as i32, file_size);
            }
        }

        (String::new(), 0, 0, file_size)
    }

    /// Generates a 400px WebP thumbnail cached on disk (Fast Path)
    pub fn generate_thumbnail(&self, image_path: &str, photo_id: &str) -> (String, i32, i32, i64) {
        let thumb_filename = format!("{}_thumb.webp", photo_id);
        let thumb_path = self.cache_dir.join(&thumb_filename);
        let thumb_path_str = thumb_path.to_string_lossy().to_string();
        let file_size = fs::metadata(image_path).map(|m| m.len() as i64).unwrap_or(0);

        if thumb_path.exists() {
            if let Ok(img) = image::open(&thumb_path) {
                let (w, h) = img.dimensions();
                return (thumb_path_str, w as i32, h as i32, file_size);
            }
        }

        let loaded_img = self
            .try_extract_embedded_thumbnail(image_path)
            .or_else(|| image::open(image_path).ok());

        if let Some(img) = loaded_img {
            let (orig_w, orig_h) = img.dimensions();
            let resized = img.thumbnail(400, 400);
            let (thumb_w, thumb_h) = resized.dimensions();

            if let Ok(_) = resized.save_with_format(&thumb_path, ImageFormat::WebP) {
                return (thumb_path_str, thumb_w as i32, thumb_h as i32, file_size);
            } else {
                return (thumb_path_str, orig_w as i32, orig_h as i32, file_size);
            }
        }

        (String::new(), 0, 0, file_size)
    }

    /// Extracts EXIF metadata using the `exif` crate
    pub fn extract_exif(&self, image_path: &str, photo_id: &str) -> PhotoExif {
        let mut exif_data = PhotoExif {
            photo_id: photo_id.to_string(),
            camera_make: None,
            camera_model: None,
            lens_model: None,
            iso: None,
            aperture: None,
            shutter_speed: None,
            focal_length: None,
            exposure_bias: None,
        };

        let file = match File::open(image_path) {
            Ok(f) => f,
            Err(_) => return exif_data,
        };

        let mut buf_reader = BufReader::new(file);
        let exif_reader = exif::Reader::new();
        let exif = match exif_reader.read_from_container(&mut buf_reader) {
            Ok(exif) => exif,
            Err(_) => return exif_data,
        };

        if let Some(field) = exif.get_field(Tag::Make, In::PRIMARY) {
            exif_data.camera_make = Some(field.display_value().to_string().trim_matches('"').to_string());
        }
        if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
            exif_data.camera_model = Some(field.display_value().to_string().trim_matches('"').to_string());
        }
        if let Some(field) = exif.get_field(Tag::LensModel, In::PRIMARY) {
            exif_data.lens_model = Some(field.display_value().to_string().trim_matches('"').to_string());
        }

        if let Some(field) = exif.get_field(Tag::PhotographicSensitivity, In::PRIMARY) {
            if let Value::Short(ref v) = field.value {
                if let Some(&iso_val) = v.first() {
                    exif_data.iso = Some(iso_val as i32);
                }
            }
        }

        if let Some(field) = exif.get_field(Tag::FNumber, In::PRIMARY) {
            if let Value::Rational(ref v) = field.value {
                if let Some(rat) = v.first() {
                    let ap = rat.num as f64 / rat.denom as f64;
                    exif_data.aperture = Some((ap * 10.0).round() / 10.0);
                }
            }
        }

        if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
            exif_data.shutter_speed = Some(field.display_value().to_string());
        }

        if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
            if let Value::Rational(ref v) = field.value {
                if let Some(rat) = v.first() {
                    let fl = rat.num as f64 / rat.denom as f64;
                    exif_data.focal_length = Some(fl.round());
                }
            }
        }

        if let Some(field) = exif.get_field(Tag::ExposureBiasValue, In::PRIMARY) {
            if let Value::SRational(ref v) = field.value {
                if let Some(rat) = v.first() {
                    let eb = rat.num as f64 / rat.denom as f64;
                    exif_data.exposure_bias = Some((eb * 100.0).round() / 100.0);
                }
            }
        }

        exif_data
    }

    /// Calculates Laplacian blur score, mean luminance, black frame & overexposed flags from an image
    pub fn calculate_quality_metrics_from_image(
        &self,
        img: &image::DynamicImage,
        photo_id: &str,
    ) -> QualityMetrics {
        let gray = img.resize_exact(128, 128, image::imageops::FilterType::Triangle).to_luma8();
        let (width, height) = gray.dimensions();
        let raw_pixels = gray.as_raw();

        let total_pixels = raw_pixels.len() as f64;
        let mut total_luma = 0.0;
        let mut black_pixels = 0;
        let mut overexposed_pixels = 0;

        for &val in raw_pixels {
            total_luma += val as f64;
            if val < 15 {
                black_pixels += 1;
            }
            if val > 240 {
                overexposed_pixels += 1;
            }
        }

        let mean_luminance = total_luma / total_pixels;
        let is_black_frame = (black_pixels as f64 / total_pixels) > 0.8;
        let is_overexposed = (overexposed_pixels as f64 / total_pixels) > 0.4;

        let mut lap_sum = 0.0;
        let mut lap_sq_sum = 0.0;
        let mut count = 0.0;

        let w = width as usize;
        let h = height as usize;

        for y in 1..(h - 1) {
            for x in 1..(w - 1) {
                let center = raw_pixels[y * w + x] as f64;
                let up = raw_pixels[(y - 1) * w + x] as f64;
                let down = raw_pixels[(y + 1) * w + x] as f64;
                let left = raw_pixels[y * w + (x - 1)] as f64;
                let right = raw_pixels[y * w + (x + 1)] as f64;

                let lap = up + down + left + right - (4.0 * center);
                lap_sum += lap;
                lap_sq_sum += lap * lap;
                count += 1.0;
            }
        }

        let blur_score = if count > 0.0 {
            let lap_mean = lap_sum / count;
            (lap_sq_sum / count) - (lap_mean * lap_mean)
        } else {
            100.0
        };

        QualityMetrics {
            photo_id: photo_id.to_string(),
            blur_score: (blur_score * 100.0).round() / 100.0,
            is_black_frame,
            is_overexposed,
            mean_luminance: (mean_luminance * 100.0).round() / 100.0,
        }
    }

    pub fn calculate_quality_metrics(&self, image_path: &str, photo_id: &str) -> QualityMetrics {
        let thumb_filename = format!("{}_thumb.webp", photo_id);
        let thumb_path = self.cache_dir.join(&thumb_filename);

        let img_result = if thumb_path.exists() {
            image::open(&thumb_path)
        } else {
            image::open(image_path)
        };

        match img_result {
            Ok(i) => self.calculate_quality_metrics_from_image(&i, photo_id),
            Err(_) => QualityMetrics {
                photo_id: photo_id.to_string(),
                blur_score: 100.0,
                is_black_frame: false,
                is_overexposed: false,
                mean_luminance: 128.0,
            },
        }
    }

    pub fn calculate_histogram_from_image(&self, img: &image::DynamicImage) -> HistogramData {
        let rgb_img = img.resize(300, 300, image::imageops::FilterType::Triangle).to_rgb8();

        let mut red = vec![0u32; 256];
        let mut green = vec![0u32; 256];
        let mut blue = vec![0u32; 256];
        let mut luma = vec![0u32; 256];

        for pixel in rgb_img.pixels() {
            let r = pixel[0] as usize;
            let g = pixel[1] as usize;
            let b = pixel[2] as usize;
            let l = ((0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64).round() as usize).min(255);

            red[r] += 1;
            green[g] += 1;
            blue[b] += 1;
            luma[l] += 1;
        }

        let max_val = *red
            .iter()
            .chain(green.iter())
            .chain(blue.iter())
            .chain(luma.iter())
            .max()
            .unwrap_or(&1)
            .max(&1);

        HistogramData {
            red: red.into_iter().map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32).collect(),
            green: green.into_iter().map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32).collect(),
            blue: blue.into_iter().map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32).collect(),
            luma: luma.into_iter().map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32).collect(),
        }
    }

    pub fn calculate_histogram(&self, image_path: &str, photo_id: Option<&str>) -> HistogramData {
        let mut input_path = PathBuf::from(image_path);
        if let Some(pid) = photo_id {
            let thumb_path = self.cache_dir.join(format!("{}_thumb.webp", pid));
            if thumb_path.exists() {
                input_path = thumb_path;
            }
        }

        match image::open(&input_path) {
            Ok(i) => self.calculate_histogram_from_image(&i),
            Err(_) => {
                let zeros = vec![0; 256];
                HistogramData {
                    red: zeros.clone(),
                    green: zeros.clone(),
                    blue: zeros.clone(),
                    luma: zeros,
                }
            }
        }
    }
}

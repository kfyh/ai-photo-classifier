use std::fs::{self, File};
use std::io::{BufReader, Read, Seek, SeekFrom};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Condvar, Mutex};

use exif::{In, Tag, Value};
use image::{GenericImageView, ImageFormat};
use rayon::prelude::*;

use crate::models::{HistogramData, PhotoExif};

/// Maximum number of concurrent full-resolution image decodes allowed when an image
/// lacks an embedded EXIF thumbnail. Prevents 45MP files from exhausting system RAM.
const MAX_CONCURRENT_FULL_DECODES: usize = 3;

struct DecodeSemaphore {
    state: Mutex<usize>,
    cvar: Condvar,
    max_permits: usize,
}

struct DecodePermit<'a> {
    sem: &'a DecodeSemaphore,
}

impl DecodeSemaphore {
    fn new(max_permits: usize) -> Self {
        DecodeSemaphore {
            state: Mutex::new(0),
            cvar: Condvar::new(),
            max_permits,
        }
    }

    fn acquire(&self) -> DecodePermit<'_> {
        let mut active = self.state.lock().unwrap();
        while *active >= self.max_permits {
            active = self.cvar.wait(active).unwrap();
        }
        *active += 1;
        DecodePermit { sem: self }
    }
}

impl<'a> Drop for DecodePermit<'a> {
    fn drop(&mut self) {
        let mut active = self.sem.state.lock().unwrap();
        *active = active.saturating_sub(1);
        self.sem.cvar.notify_one();
    }
}

pub struct ProcessedPhotoResult {
    pub thumb_path: String,
    pub width: i32,
    pub height: i32,
    pub file_size: i64,
    pub exif: PhotoExif,
    pub histogram: HistogramData,
}

pub struct ImagePipeline {
    cache_dir: PathBuf,
    decode_semaphore: Arc<DecodeSemaphore>,
}

impl ImagePipeline {
    pub fn new() -> Self {
        let cache_dir = crate::db::AppDatabase::get_app_dir().join("cache");
        if !cache_dir.exists() {
            let _ = fs::create_dir_all(&cache_dir);
        }
        ImagePipeline {
            cache_dir,
            decode_semaphore: Arc::new(DecodeSemaphore::new(MAX_CONCURRENT_FULL_DECODES)),
        }
    }

    pub fn get_cache_dir(&self) -> &Path {
        &self.cache_dir
    }

    /// Scans a folder for image and raw files using parallel iterator (rayon)
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
                if let Some(name) = p.file_name().and_then(|s| s.to_str()) {
                    if name.starts_with('.') {
                        return false;
                    }
                }
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

    /// Ultra-fast filesystem metadata inspection (<0.02ms) for Stage 1 catalog registration
    /// without opening or parsing image files.
    pub fn inspect_file_metadata_fast(&self, image_path: &str) -> i64 {
        fs::metadata(image_path).map(|m| m.len() as i64).unwrap_or(0)
    }

    /// Header inspection (<0.5ms) that reads file size and image header dimensions
    /// without decoding pixel data.
    pub fn inspect_file_header_fast(&self, image_path: &str) -> (i64, i32, i32) {
        let file_size = fs::metadata(image_path).map(|m| m.len() as i64).unwrap_or(0);
        let (w, h) = image::image_dimensions(image_path).unwrap_or((400, 400));
        (file_size, w as i32, h as i32)
    }

    /// Checks whether a cached thumbnail path is a valid, complete JPEG inside `cache_dir`.
    pub fn is_valid_cached_thumb(&self, path: &Path) -> bool {
        if !path.starts_with(&self.cache_dir) {
            return false;
        }
        let is_jpg = path
            .extension()
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("jpg") || e.eq_ignore_ascii_case("jpeg"))
            .unwrap_or(false);
        if !is_jpg {
            return false;
        }
        let Ok(mut f) = File::open(path) else {
            return false;
        };
        let Ok(meta) = f.metadata() else {
            return false;
        };
        let len = meta.len();
        if len <= 600 {
            return false;
        }
        let mut head = [0u8; 3];
        if f.read_exact(&mut head).is_err() || head != [0xFF, 0xD8, 0xFF] {
            return false;
        }
        let mut tail = [0u8; 2];
        if f.seek(SeekFrom::End(-2)).is_err()
            || f.read_exact(&mut tail).is_err()
            || tail != [0xFF, 0xD9]
        {
            return false;
        }
        true
    }

    /// Scans a byte buffer for embedded JPEG streams (0xFF 0xD8 0xFF + valid marker) and decodes
    /// the best preview without truncating at nested APP1 EXIF EOI markers.
    fn extract_jpeg_from_bytes(buf: &[u8], start_offset: usize) -> Option<image::DynamicImage> {
        if buf.len() <= start_offset + 64 {
            return None;
        }
        let mut best_img: Option<image::DynamicImage> = None;
        let mut i = start_offset;
        let limit = buf.len().saturating_sub(4);

        while i < limit {
            if buf[i] == 0xFF && buf[i + 1] == 0xD8 && buf[i + 2] == 0xFF {
                let marker = buf[i + 3];
                let valid_marker = matches!(
                    marker,
                    0xC0..=0xCF | 0xDB | 0xDD | 0xE0..=0xEF | 0xFE
                );
                if valid_marker {
                    // 1. Let the JPEG decoder parse marker lengths directly from `soi` to its natural EOI
                    if let Ok(img) =
                        image::load_from_memory_with_format(&buf[i..], ImageFormat::Jpeg)
                    {
                        let (w, h) = img.dimensions();
                        if w >= 300 || h >= 300 {
                            return Some(img);
                        }
                        if w >= 32 && h >= 32 {
                            let replace = best_img
                                .as_ref()
                                .map(|b| w * h > b.width() * b.height())
                                .unwrap_or(true);
                            if replace {
                                best_img = Some(img);
                            }
                        }
                    } else if let Some(rel_eoi) = (i + 4..buf.len().saturating_sub(1))
                        .rev()
                        .find(|&k| buf[k] == 0xFF && buf[k + 1] == 0xD9)
                    {
                        let slice = &buf[i..=rel_eoi + 1];
                        if let Ok(img) = image::load_from_memory(slice) {
                            let (w, h) = img.dimensions();
                            if w >= 300 || h >= 300 {
                                return Some(img);
                            }
                            if w >= 32 && h >= 32 {
                                best_img = Some(img);
                            }
                        }
                    }
                }
            }
            i += 1;
        }

        best_img
    }

    /// Fast path: Attempts extraction of embedded EXIF thumbnail (<1ms, negligible RAM).
    /// Note: EXIF `JPEGInterchangeFormat` offset is relative to the start of the TIFF header (`exif.buf()`),
    /// NOT the start of the file on disk.
    pub fn try_extract_embedded_thumbnail(&self, image_path: &str) -> Option<image::DynamicImage> {
        let file = File::open(image_path).ok()?;
        let mut buf_reader = BufReader::new(file);
        let exif_reader = exif::Reader::new();
        if let Ok(exif) = exif_reader.read_from_container(&mut buf_reader) {
            let raw_tiff_buf = exif.buf();

            let mut offset_opt: Option<usize> = None;
            let mut length_opt: Option<usize> = None;

            for field in exif.fields() {
                if field.tag == Tag::JPEGInterchangeFormat {
                    offset_opt = match field.value {
                        Value::Long(ref v) => v.first().map(|&x| x as usize),
                        Value::Short(ref v) => v.first().map(|&x| x as usize),
                        _ => None,
                    };
                } else if field.tag == Tag::JPEGInterchangeFormatLength {
                    length_opt = match field.value {
                        Value::Long(ref v) => v.first().map(|&x| x as usize),
                        Value::Short(ref v) => v.first().map(|&x| x as usize),
                        _ => None,
                    };
                }
            }

            if let (Some(offset), Some(length)) = (offset_opt, length_opt) {
                if length > 0 && length <= 16 * 1024 * 1024 {
                    // 1. Standard TIFF-header-relative slice directly inside exif.buf()
                    if offset < raw_tiff_buf.len() {
                        let end = (offset + length).min(raw_tiff_buf.len());
                        let slice = &raw_tiff_buf[offset..end];
                        if let Ok(img) = image::load_from_memory(slice) {
                            return Some(img);
                        }
                    }

                    // 2. Fallback if camera recorded file-relative offset
                    if let Ok(mut f) = File::open(image_path) {
                        if f.seek(SeekFrom::Start(offset as u64)).is_ok() {
                            let mut buffer = vec![0u8; length];
                            if f.read_exact(&mut buffer).is_ok() {
                                if let Ok(img) = image::load_from_memory(&buffer) {
                                    return Some(img);
                                }
                            }
                        }
                    }
                }
            }

            // 3. Fallback: scan exif.buf() for embedded JPEG streams
            if let Some(img) = Self::extract_jpeg_from_bytes(raw_tiff_buf, 0) {
                return Some(img);
            }
        }

        // 4. For RAW/TIFF files (or containers where kamadak-exif doesn't traverse SubIFDs),
        // scan the first 8MB for embedded preview JPEGs.
        let ext = Path::new(image_path)
            .extension()
            .and_then(|s| s.to_str())
            .map(|s| s.to_ascii_lowercase())
            .unwrap_or_default();
        let is_raw_or_tiff = matches!(
            ext.as_str(),
            "cr2" | "nef" | "arw" | "dng" | "tiff" | "tif"
        );

        if is_raw_or_tiff {
            if let Ok(mut f) = File::open(image_path) {
                let mut raw_buf = vec![0u8; 8 * 1024 * 1024];
                if let Ok(n) = f.read(&mut raw_buf) {
                    raw_buf.truncate(n);
                    if let Some(img) = Self::extract_jpeg_from_bytes(&raw_buf, 4) {
                        return Some(img);
                    }
                }
            }
        }

        None
    }

    /// Bounded fallback decode: Acquires a semaphore permit so at most `MAX_CONCURRENT_FULL_DECODES`
    /// full-resolution images are decoded in RAM simultaneously. Immediately downsamples to `max_dim`
    /// and drops the full-resolution buffer before releasing the permit.
    fn decode_downsampled_bounded(
        &self,
        image_path: &str,
        max_w: u32,
        max_h: u32,
    ) -> Option<(image::DynamicImage, u32, u32)> {
        let _permit = self.decode_semaphore.acquire();
        let mut reader = image::ImageReader::open(image_path)
            .ok()?
            .with_guessed_format()
            .ok()?;
        reader.no_limits();
        if let Ok(full_img) = reader.decode() {
            let (orig_w, orig_h) = full_img.dimensions();
            let resized = full_img.thumbnail(max_w, max_h);
            drop(full_img);
            return Some((resized, orig_w, orig_h));
        }

        // Fallback byte scan for any embedded JPEG stream if standard decode failed
        if let Ok(mut f) = File::open(image_path) {
            let mut buf = vec![0u8; 4 * 1024 * 1024];
            if let Ok(n) = f.read(&mut buf) {
                buf.truncate(n);
                if let Some(img) = Self::extract_jpeg_from_bytes(&buf, 4) {
                    let (orig_w, orig_h) = img.dimensions();
                    let resized = img.thumbnail(max_w, max_h);
                    return Some((resized, orig_w, orig_h));
                }
            }
        }
        None
    }

    /// Extracts embedded preview if available, or falls back to bounded downsampled decode.
    pub fn extract_image_or_preview(&self, image_path: &str) -> Option<image::DynamicImage> {
        if let Some(img) = self.try_extract_embedded_thumbnail(image_path) {
            return Some(img.thumbnail(400, 400));
        }
        self.decode_downsampled_bounded(image_path, 400, 400)
            .map(|(resized, _, _)| resized)
    }

    /// Atomically saves a downsampled RGB8 thumbnail to disk as JPEG, falling back to WebP if JPEG fails.
    fn save_thumbnail_to_cache(&self, rgb: &image::RgbImage, photo_id: &str) -> Option<String> {
        if !self.cache_dir.exists() {
            let _ = fs::create_dir_all(&self.cache_dir);
        }
        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let jpg_tmp = self
            .cache_dir
            .join(format!(".{}_{}_{:?}.tmp.jpg", photo_id, unique, std::thread::current().id()));
        let jpg_path = self.cache_dir.join(format!("{}_thumb.jpg", photo_id));
        if rgb.save_with_format(&jpg_tmp, ImageFormat::Jpeg).is_ok() {
            if fs::rename(&jpg_tmp, &jpg_path).is_ok() && jpg_path.exists() {
                return Some(jpg_path.to_string_lossy().to_string());
            }
            let _ = fs::remove_file(&jpg_tmp);
        }
        let webp_tmp = self
            .cache_dir
            .join(format!(".{}_{}_{:?}.tmp.webp", photo_id, unique, std::thread::current().id()));
        let webp_path = self.cache_dir.join(format!("{}_thumb.webp", photo_id));
        if rgb.save_with_format(&webp_tmp, ImageFormat::WebP).is_ok() {
            if fs::rename(&webp_tmp, &webp_path).is_ok() && webp_path.exists() {
                return Some(webp_path.to_string_lossy().to_string());
            }
            let _ = fs::remove_file(&webp_tmp);
        }
        None
    }

    /// Fast Path Stage 2: Generates 400px JPEG thumbnail from embedded EXIF or bounded fallback decode.
    pub fn generate_thumbnail_fast_exif_only(
        &self,
        image_path: &str,
        photo_id: &str,
    ) -> (String, i32, i32, i64) {
        let jpg_thumb_path = self.cache_dir.join(format!("{}_thumb.jpg", photo_id));
        let webp_thumb_path = self.cache_dir.join(format!("{}_thumb.webp", photo_id));
        let (file_size, header_w, header_h) = self.inspect_file_header_fast(image_path);

        if self.is_valid_cached_thumb(&jpg_thumb_path) {
            return (
                jpg_thumb_path.to_string_lossy().to_string(),
                header_w,
                header_h,
                file_size,
            );
        }

        // Automatically migrate valid legacy .webp cache thumbnails to standard .jpg
        if webp_thumb_path.exists() {
            if let Ok(meta) = fs::metadata(&webp_thumb_path) {
                if meta.len() > 600 {
                    if let Ok(img) = image::open(&webp_thumb_path) {
                        if img.width() != 64 || img.height() != 64 {
                            let rgb = img.to_rgb8();
                            if let Some(saved_jpg) = self.save_thumbnail_to_cache(&rgb, photo_id) {
                                let _ = fs::remove_file(&webp_thumb_path);
                                return (saved_jpg, header_w, header_h, file_size);
                            }
                        }
                    }
                }
            }
            let _ = fs::remove_file(&webp_thumb_path);
        }

        // 1. Instant path: Embedded EXIF thumbnail (< 1ms, < 100KB RAM)
        if let Some(img) = self.try_extract_embedded_thumbnail(image_path) {
            let resized = img.thumbnail(400, 400);
            drop(img);
            let (thumb_w, thumb_h) = resized.dimensions();
            let rgb = resized.to_rgb8();
            drop(resized);
            if let Some(saved_path) = self.save_thumbnail_to_cache(&rgb, photo_id) {
                drop(rgb);
                let final_w = if header_w > 400 { header_w } else { thumb_w as i32 };
                let final_h = if header_h > 400 { header_h } else { thumb_h as i32 };
                return (saved_path, final_w, final_h, file_size);
            }
        }

        // 2. Bounded full decode only when no embedded thumbnail is available
        if let Some((resized, orig_w, orig_h)) = self.decode_downsampled_bounded(image_path, 400, 400) {
            let rgb = resized.to_rgb8();
            drop(resized);
            if let Some(saved_path) = self.save_thumbnail_to_cache(&rgb, photo_id) {
                drop(rgb);
                return (saved_path, orig_w as i32, orig_h as i32, file_size);
            }
        }

        // 3. Fallback placeholder JPEG (>600 bytes gradient pattern) so worker never loops infinitely
        let mut placeholder = image::RgbImage::new(160, 160);
        for (x, y, pixel) in placeholder.enumerate_pixels_mut() {
            let r = (24 + ((x * 37 + y * 13) % 28)) as u8;
            let g = (26 + ((x * 19 + y * 29) % 28)) as u8;
            let b = (34 + ((x * 23 + y * 31) % 32)) as u8;
            *pixel = image::Rgb([r, g, b]);
        }
        if let Some(saved_path) = self.save_thumbnail_to_cache(&placeholder, photo_id) {
            return (saved_path, header_w, header_h, file_size);
        }

        (String::new(), header_w, header_h, file_size)
    }

    /// Encodes binary bytes to a standard RFC 4648 base64 string without external dependencies.
    fn encode_base64(bytes: &[u8]) -> String {
        const TABLE: &[u8; 64] =
            b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
        let mut out = Vec::with_capacity((bytes.len() + 2) / 3 * 4);
        for chunk in bytes.chunks(3) {
            let b0 = chunk[0] as u32;
            let b1 = if chunk.len() > 1 { chunk[1] as u32 } else { 0 };
            let b2 = if chunk.len() > 2 { chunk[2] as u32 } else { 0 };
            let triple = (b0 << 16) | (b1 << 8) | b2;
            out.push(TABLE[((triple >> 18) & 0x3F) as usize]);
            out.push(TABLE[((triple >> 12) & 0x3F) as usize]);
            if chunk.len() > 1 {
                out.push(TABLE[((triple >> 6) & 0x3F) as usize]);
            } else {
                out.push(b'=');
            }
            if chunk.len() > 2 {
                out.push(TABLE[(triple & 0x3F) as usize]);
            } else {
                out.push(b'=');
            }
        }
        String::from_utf8(out).unwrap_or_default()
    }

    /// Returns a `data:image/jpeg;base64,...` URI for a photo's cached 400px JPEG thumbnail,
    /// generating or migrating the thumbnail on the spot if needed.
    pub fn get_thumbnail_base64(&self, image_path: &str, photo_id: &str) -> Option<String> {
        let jpg_thumb_path = self.cache_dir.join(format!("{}_thumb.jpg", photo_id));
        if !self.is_valid_cached_thumb(&jpg_thumb_path) {
            let _ = self.generate_thumbnail_fast_exif_only(image_path, photo_id);
        }
        if let Ok(bytes) = fs::read(&jpg_thumb_path) {
            if !bytes.is_empty() {
                return Some(format!(
                    "data:image/jpeg;base64,{}",
                    Self::encode_base64(&bytes)
                ));
            }
        }
        if let Some(img) = self.extract_image_or_preview(image_path) {
            let rgb = img.to_rgb8();
            let mut buf = std::io::Cursor::new(Vec::new());
            if rgb.write_to(&mut buf, ImageFormat::Jpeg).is_ok() {
                let bytes = buf.into_inner();
                if !bytes.is_empty() {
                    return Some(format!(
                        "data:image/jpeg;base64,{}",
                        Self::encode_base64(&bytes)
                    ));
                }
            }
        }
        None
    }

    fn target_long_edge_for_cover_slot(orig_w: u32, orig_h: u32, slot_px: u32) -> u32 {
        let min_orig = orig_w.min(orig_h).max(1);
        let max_orig = orig_w.max(orig_h).max(1);
        let desired_long_edge = ((slot_px as f64) * (max_orig as f64 / min_orig as f64))
            .ceil()
            .min((slot_px.saturating_mul(2)) as f64) as u32;
        desired_long_edge.max(slot_px).min(max_orig)
    }

    fn encode_and_cache_sized_jpeg(
        &self,
        rgb: &image::RgbImage,
        photo_id: &str,
        slot_px: u32,
    ) -> Option<Vec<u8>> {
        if !self.cache_dir.exists() {
            let _ = fs::create_dir_all(&self.cache_dir);
        }
        let mut bytes = Vec::new();
        let mut encoder = image::codecs::jpeg::JpegEncoder::new_with_quality(&mut bytes, 88);
        encoder
            .encode(
                rgb.as_raw(),
                rgb.width(),
                rgb.height(),
                image::ExtendedColorType::Rgb8,
            )
            .ok()?;
        if bytes.is_empty() {
            return None;
        }

        let unique = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let tmp_path = self.cache_dir.join(format!(
            ".{}_{}_{}_{:?}.tmp.jpg",
            photo_id,
            slot_px,
            unique,
            std::thread::current().id()
        ));
        let final_path = self
            .cache_dir
            .join(format!("{}_thumb_{}.jpg", photo_id, slot_px));
        if fs::write(&tmp_path, &bytes).is_ok() {
            if fs::rename(&tmp_path, &final_path).is_err() {
                let _ = fs::remove_file(&tmp_path);
            }
        }
        Some(bytes)
    }

    /// Generates (or returns cached) a JPEG thumbnail sized to match a square `slot_px`
    /// physical pixel slot without upscaling when rendered with `object-cover`.
    pub fn get_sized_thumbnail_base64(
        &self,
        image_path: &str,
        photo_id: &str,
        slot_px: u32,
    ) -> Option<String> {
        let clamped_slot = slot_px.clamp(128, 2048);
        let cached_path = self
            .cache_dir
            .join(format!("{}_thumb_{}.jpg", photo_id, clamped_slot));
        if self.is_valid_cached_thumb(&cached_path) {
            if let Ok(bytes) = fs::read(&cached_path) {
                if !bytes.is_empty() {
                    return Some(format!(
                        "data:image/jpeg;base64,{}",
                        Self::encode_base64(&bytes)
                    ));
                }
            }
        }

        // If an embedded preview is already large enough for the slot, use it without a full decode.
        if let Some(img) = self.try_extract_embedded_thumbnail(image_path) {
            let (ew, eh) = img.dimensions();
            if ew.min(eh) >= clamped_slot {
                let target_edge = Self::target_long_edge_for_cover_slot(ew, eh, clamped_slot);
                let resized = img.thumbnail(target_edge, target_edge);
                drop(img);
                let rgb = resized.to_rgb8();
                drop(resized);
                if let Some(bytes) = self.encode_and_cache_sized_jpeg(&rgb, photo_id, clamped_slot) {
                    return Some(format!(
                        "data:image/jpeg;base64,{}",
                        Self::encode_base64(&bytes)
                    ));
                }
            }
        }

        // Bounded full decode sized to the physical slot dimensions.
        let decoded = {
            let _permit = self.decode_semaphore.acquire();
            let reader_opt = image::ImageReader::open(image_path)
                .ok()
                .and_then(|r| r.with_guessed_format().ok());
            if let Some(mut reader) = reader_opt {
                reader.no_limits();
                if let Ok(full_img) = reader.decode() {
                    let (orig_w, orig_h) = full_img.dimensions();
                    let target_edge =
                        Self::target_long_edge_for_cover_slot(orig_w, orig_h, clamped_slot);
                    let resized = full_img.thumbnail(target_edge, target_edge);
                    drop(full_img);
                    Some(resized)
                } else {
                    None
                }
            } else {
                None
            }
        };

        if let Some(resized) = decoded {
            let rgb = resized.to_rgb8();
            drop(resized);
            if let Some(bytes) = self.encode_and_cache_sized_jpeg(&rgb, photo_id, clamped_slot) {
                return Some(format!(
                    "data:image/jpeg;base64,{}",
                    Self::encode_base64(&bytes)
                ));
            }
        }

        None
    }

    /// Generates a 400px thumbnail cached on disk
    pub fn generate_thumbnail(&self, image_path: &str, photo_id: &str) -> (String, i32, i32, i64) {
        self.generate_thumbnail_fast_exif_only(image_path, photo_id)
    }

    /// Deep Path Stage 3: EXIF extraction and Histogram computation using cached 400px thumbnail.
    /// Objective quality metrics (Laplacian blur, black frame, overexposure) are intentionally omitted
    /// in favor of visual ML classification and user-toggled Blinkies/Histogram exposure aids.
    pub fn process_photo_single_pass(
        &self,
        image_path: &str,
        photo_id: &str,
    ) -> ProcessedPhotoResult {
        let (file_size, header_w, header_h) = self.inspect_file_header_fast(image_path);
        let jpg_thumb_path = self.cache_dir.join(format!("{}_thumb.jpg", photo_id));
        let webp_thumb_path = self.cache_dir.join(format!("{}_thumb.webp", photo_id));

        let exif = self.extract_exif(image_path, photo_id);

        // Compute histogram from the lightweight 400px thumbnail (< 500KB RAM) rather than raw 45MP files
        let (resolved_thumb_path, img) = if jpg_thumb_path.exists() {
            let decoded = image::open(&jpg_thumb_path).unwrap_or_else(|_| image::DynamicImage::new_rgb8(1, 1));
            (jpg_thumb_path.to_string_lossy().to_string(), decoded)
        } else if webp_thumb_path.exists() {
            let decoded = image::open(&webp_thumb_path).unwrap_or_else(|_| image::DynamicImage::new_rgb8(1, 1));
            (webp_thumb_path.to_string_lossy().to_string(), decoded)
        } else {
            let (t_path, _, _, _) = self.generate_thumbnail_fast_exif_only(image_path, photo_id);
            if !t_path.is_empty() && Path::new(&t_path).exists() {
                let decoded = image::open(&t_path).unwrap_or_else(|_| image::DynamicImage::new_rgb8(1, 1));
                (t_path, decoded)
            } else {
                (image_path.to_string(), image::DynamicImage::new_rgb8(1, 1))
            }
        };

        let (thumb_w, thumb_h) = img.dimensions();
        let histogram = self.calculate_histogram_from_image(&img);
        // Drop decoded image buffer immediately after histogram calculation
        drop(img);

        let final_w = if header_w > 0 && header_w != 400 {
            header_w
        } else if thumb_w > 1 {
            thumb_w as i32
        } else {
            400
        };
        let final_h = if header_h > 0 && header_h != 400 {
            header_h
        } else if thumb_h > 1 {
            thumb_h as i32
        } else {
            400
        };

        ProcessedPhotoResult {
            thumb_path: resolved_thumb_path,
            width: final_w,
            height: final_h,
            file_size,
            exif,
            histogram,
        }
    }

    /// Extracts EXIF metadata using the `exif` crate (reads header container only)
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
            exif_data.camera_make = Some(
                field
                    .display_value()
                    .to_string()
                    .trim_matches('"')
                    .to_string(),
            );
        }
        if let Some(field) = exif.get_field(Tag::Model, In::PRIMARY) {
            exif_data.camera_model = Some(
                field
                    .display_value()
                    .to_string()
                    .trim_matches('"')
                    .to_string(),
            );
        }
        if let Some(field) = exif.get_field(Tag::LensModel, In::PRIMARY) {
            exif_data.lens_model = Some(
                field
                    .display_value()
                    .to_string()
                    .trim_matches('"')
                    .to_string(),
            );
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
                    if rat.denom != 0 {
                        let ap = rat.num as f64 / rat.denom as f64;
                        exif_data.aperture = Some((ap * 10.0).round() / 10.0);
                    }
                }
            }
        }

        if let Some(field) = exif.get_field(Tag::ExposureTime, In::PRIMARY) {
            exif_data.shutter_speed = Some(field.display_value().to_string());
        }

        if let Some(field) = exif.get_field(Tag::FocalLength, In::PRIMARY) {
            if let Value::Rational(ref v) = field.value {
                if let Some(rat) = v.first() {
                    if rat.denom != 0 {
                        let fl = rat.num as f64 / rat.denom as f64;
                        exif_data.focal_length = Some(fl.round());
                    }
                }
            }
        }

        if let Some(field) = exif.get_field(Tag::ExposureBiasValue, In::PRIMARY) {
            if let Value::SRational(ref v) = field.value {
                if let Some(rat) = v.first() {
                    if rat.denom != 0 {
                        let eb = rat.num as f64 / rat.denom as f64;
                        exif_data.exposure_bias = Some((eb * 10.0).round() / 10.0);
                    }
                }
            }
        }

        exif_data
    }

    pub fn calculate_histogram_from_image(&self, img: &image::DynamicImage) -> HistogramData {
        let rgb_img = img
            .resize(300, 300, image::imageops::FilterType::Triangle)
            .to_rgb8();

        let mut red = vec![0u32; 256];
        let mut green = vec![0u32; 256];
        let mut blue = vec![0u32; 256];
        let mut luma = vec![0u32; 256];

        for pixel in rgb_img.pixels() {
            let r = pixel[0] as usize;
            let g = pixel[1] as usize;
            let b = pixel[2] as usize;
            let l = ((0.299 * r as f64 + 0.587 * g as f64 + 0.114 * b as f64).round() as usize)
                .min(255);

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
            red: red
                .into_iter()
                .map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32)
                .collect(),
            green: green
                .into_iter()
                .map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32)
                .collect(),
            blue: blue
                .into_iter()
                .map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32)
                .collect(),
            luma: luma
                .into_iter()
                .map(|v| ((v as f64 / max_val as f64) * 100.0).round() as u32)
                .collect(),
        }
    }

    pub fn calculate_histogram(&self, image_path: &str, photo_id: Option<&str>) -> HistogramData {
        if let Some(pid) = photo_id {
            for ext in ["jpg", "webp"] {
                let thumb_path = self.cache_dir.join(format!("{}_thumb.{}", pid, ext));
                if thumb_path.exists() {
                    if let Ok(img) = image::open(&thumb_path) {
                        return self.calculate_histogram_from_image(&img);
                    }
                }
            }
        }

        if let Some(img) = self.extract_image_or_preview(image_path) {
            return self.calculate_histogram_from_image(&img);
        }

        let zeros = vec![0; 256];
        HistogramData {
            red: zeros.clone(),
            green: zeros.clone(),
            blue: zeros.clone(),
            luma: zeros,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_get_thumbnail_base64_and_valid_jpg_check() {
        let tmp_dir = std::env::temp_dir().join(format!(
            "ai_photo_classifier_test_{}",
            std::process::id()
        ));
        let _ = fs::create_dir_all(&tmp_dir);

        let src_path = tmp_dir.join("sample.jpg");
        let mut img = image::RgbImage::new(800, 600);
        for (x, y, p) in img.enumerate_pixels_mut() {
            *p = image::Rgb([(x % 255) as u8, (y % 255) as u8, ((x + y) % 255) as u8]);
        }
        img.save_with_format(&src_path, ImageFormat::Jpeg).unwrap();

        let pipeline = ImagePipeline {
            cache_dir: tmp_dir.clone(),
            decode_semaphore: Arc::new(DecodeSemaphore::new(2)),
        };

        let data_url = pipeline
            .get_thumbnail_base64(src_path.to_str().unwrap(), "test-photo-1")
            .expect("should produce base64 thumbnail");
        assert!(data_url.starts_with("data:image/jpeg;base64,"));

        let cached = tmp_dir.join("test-photo-1_thumb.jpg");
        assert!(pipeline.is_valid_cached_thumb(&cached));

        // Truncated JPEG should be rejected by is_valid_cached_thumb
        let corrupt = tmp_dir.join("corrupt_thumb.jpg");
        fs::write(&corrupt, vec![0xFFu8; 700]).unwrap();
        assert!(!pipeline.is_valid_cached_thumb(&corrupt));

        let _ = fs::remove_dir_all(&tmp_dir);
    }
}

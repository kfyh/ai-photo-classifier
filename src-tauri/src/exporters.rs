use std::fs;
use std::path::Path;

pub struct Exporters;

impl Exporters {
    /// Exports rating and pick flag to RawTherapee .pp3 sidecar text file
    pub fn export_pp3(photo_path: &str, rating: i32, pick_status: &str) -> Result<String, String> {
        let pp3_path = format!("{}.pp3", photo_path);
        let mut content = if Path::new(&pp3_path).exists() {
            fs::read_to_string(&pp3_path).unwrap_or_else(|_| "[Version]\nAppVersion=5.9\nVersion=101\n\n".to_string())
        } else {
            "[Version]\nAppVersion=5.9\nVersion=101\n\n".to_string()
        };

        // Color Label mapping: 1 = Red (reject), 3 = Green (pick), 0 = None
        let color_label = match pick_status {
            "pick" => 3,
            "reject" => 1,
            _ => 0,
        };

        // Update or insert [Rank] Section
        if content.contains("[Rank]") {
            let re_rank = regex_lite_replace(&content, r"Rank=\d+", &format!("Rank={}", rating));
            content = re_rank;
        } else {
            content.push_str(&format!("[Rank]\nRank={}\n\n", rating));
        }

        // Update or insert [ColorLabel] Section
        if content.contains("[ColorLabel]") {
            let re_color = regex_lite_replace(&content, r"ColorLabel=\d+", &format!("ColorLabel={}", color_label));
            content = re_color;
        } else {
            content.push_str(&format!("[ColorLabel]\nColorLabel={}\n\n", color_label));
        }

        fs::write(&pp3_path, content).map_err(|e| format!("Failed to write PP3 file: {}", e))?;
        println!("[RawTherapeeSync] Wrote PP3 sidecar at: {}", pp3_path);
        Ok(pp3_path)
    }

    /// Exports rating and pick flag to standard XMP sidecar file
    pub fn export_xmp(photo_path: &str, rating: i32, pick_status: &str) -> Result<String, String> {
        let path = Path::new(photo_path);
        let stem = path.file_stem().and_then(|s| s.to_str()).unwrap_or("photo");
        let parent = path.parent().unwrap_or_else(|| Path::new(""));
        let xmp_path = parent.join(format!("{}.xmp", stem));

        let label = match pick_status {
            "pick" => "Green",
            "reject" => "Red",
            _ => "",
        };

        let xmp_content = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
 <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
  <rdf:Description rdf:about=""
    xmlns:xmp="http://ns.adobe.com/xap/1.0/"
    xmp:Rating="{}"
    xmp:Label="{}"/>
 </rdf:RDF>
</x:xmpmeta>"#,
            rating, label
        );

        fs::write(&xmp_path, xmp_content).map_err(|e| format!("Failed to write XMP file: {}", e))?;
        println!("[XMPSync] Wrote XMP sidecar at: {:?}", xmp_path);
        Ok(xmp_path.to_string_lossy().to_string())
    }
}

fn regex_lite_replace(text: &str, pattern: &str, replacement: &str) -> String {
    // Simple line-by-line replacement helper for key=value patterns
    let target_prefix = pattern.split('=').next().unwrap_or("");
    let mut lines: Vec<String> = Vec::new();

    for line in text.lines() {
        if line.starts_with(target_prefix) {
            lines.push(replacement.to_string());
        } else {
            lines.push(line.to_string());
        }
    }
    lines.join("\n")
}

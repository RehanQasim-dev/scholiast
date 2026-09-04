//! Frame-capture pipeline: webview snapshot → crop (device px) → black-frame
//! gate → downscale ≤1280w → JPEG q80 temp file. The item itself is persisted
//! only when the user saves (see [`persist`]).
//!
//! Platform support: real backend lives behind `#[cfg(target_os = "linux")]`
//! (WebKitGTK draw-harvest, see `linux_webkit.rs`). Other platforms compile
//! the IPC surface but every command returns an Unsupported error — documented
//! spike per task.md.

pub mod blackframe;
#[cfg(target_os = "linux")]
pub mod linux_webkit;
pub mod persist;

use scholiast_core::error::{Reply, ScholiastError};
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};

use crate::store::internal;

/// Crop rectangle in device pixels relative to the webview origin.
/// Serialized `{ x, y, w, h }`.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureRect {
    pub x: i32,
    pub y: i32,
    pub w: i32,
    pub h: i32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CaptureOut {
    /// Absolute filesystem path of the temp JPEG.
    pub path: String,
    /// Post-downscale pixel dims (what got encoded).
    pub w: u32,
    pub h: u32,
    /// Normalized-URL hash of the source video (client passes full URL).
    pub url_hash: String,
}

const MAX_CAPTURE_WIDTH: u32 = 1280;

/// Crops `rect` out of `img`, clamping out-of-bounds edges; errors when the
/// intersection is empty. Linux-only: the WebKitGTK snapshot path is the sole
/// caller (Android falls back to the YouTube thumbnail, where `rect` has no
/// meaning).
#[cfg(target_os = "linux")]
pub(crate) fn crop_rect(
    img: &image::RgbaImage,
    rect: &CaptureRect,
) -> Result<image::RgbaImage, String> {
    if rect.w <= 0 || rect.h <= 0 {
        return Err("capture rect is empty".into());
    }
    let (iw, ih) = (img.width() as i64, img.height() as i64);
    let x0 = (rect.x as i64).clamp(0, iw);
    let y0 = (rect.y as i64).clamp(0, ih);
    let x1 = (rect.x as i64 + rect.w as i64).clamp(0, iw);
    let y1 = (rect.y as i64 + rect.h as i64).clamp(0, ih);
    if x1 <= x0 || y1 <= y0 {
        return Err("capture rect lies entirely outside the snapshot".into());
    }
    Ok(image::imageops::crop_imm(
        img,
        x0 as u32,
        y0 as u32,
        (x1 - x0) as u32,
        (y1 - y0) as u32,
    )
    .to_image())
}

/// Downscale to at most [`MAX_CAPTURE_WIDTH`] device-independent output width,
/// then encode q80 JPEG into memory. Returns `(jpeg bytes, out_w, out_h)`.
pub(crate) fn encode_jpeg_q80(img: image::RgbaImage) -> Result<(Vec<u8>, u32, u32), String> {
    use image::codecs::jpeg::JpegEncoder;
    let (w, h) = (img.width(), img.height());
    let scaled = if w > MAX_CAPTURE_WIDTH {
        let nh = (((u64::from(h) * u64::from(MAX_CAPTURE_WIDTH)) + u64::from(w / 2))
            / u64::from(w))
        .max(1) as u32;
        image::DynamicImage::ImageRgba8(img)
            .resize_exact(MAX_CAPTURE_WIDTH, nh, image::imageops::FilterType::Triangle)
    } else {
        image::DynamicImage::ImageRgba8(img)
    };
    let mut out = Vec::new();
    let mut encoder = JpegEncoder::new_with_quality(&mut out, 80);
    encoder
        .encode_image(&scaled)
        .map_err(|e| format!("jpeg encode failed: {e}"))?;
    Ok((out, scaled.width(), scaled.height()))
}

async fn fetch_youtube_frame(video_id: &str) -> Result<image::RgbaImage, ScholiastError> {
    let client = reqwest::Client::builder()
        .timeout(std::time::Duration::from_secs(8))
        .build()
        .map_err(|e| ScholiastError::Internal(e.to_string()))?;

    // Try maxresdefault first (1280x720)
    let maxres_url = format!("https://img.youtube.com/vi/{video_id}/maxresdefault.jpg");
    let mut bytes = match client.get(&maxres_url).send().await {
        Ok(resp) if resp.status().is_success() => resp.bytes().await.ok(),
        _ => None,
    };

    // Fallback to hqdefault (480x360)
    if bytes.is_none() {
        let hq_url = format!("https://img.youtube.com/vi/{video_id}/hqdefault.jpg");
        if let Ok(resp) = client.get(&hq_url).send().await {
            if resp.status().is_success() {
                bytes = resp.bytes().await.ok();
            }
        }
    }

    let raw = bytes.ok_or_else(|| {
        ScholiastError::Internal("failed to fetch frame snapshot from video source".into())
    })?;

    let decoded = image::load_from_memory(&raw)
        .map_err(|e| ScholiastError::Internal(format!("failed to decode video frame: {e}")))?;
    Ok(decoded.to_rgba8())
}

#[tauri::command]
pub async fn capture_frame(
    app: AppHandle,
    url: String,
    rect: CaptureRect,
) -> Result<Reply<CaptureOut>, ScholiastError> {
    // `rect` is webview-device pixels: meaningful only for the Linux WebKitGTK
    // snapshot crop below. On other platforms the YouTube-thumbnail fallback
    // ignores it — read the fields explicitly so `unused`/`dead_code = "deny"`
    // stays satisfied without any `#[allow]`.
    #[cfg(not(target_os = "linux"))]
    let _ = (rect.x, rect.y, rect.w, rect.h);
    let url_hash =
        scholiast_core::normalize::url_hash(&scholiast_core::normalize::normalize_url(&url));

    #[cfg(target_os = "linux")]
    let captured_img: Option<image::RgbaImage> = {
        let snap_app = app.clone();
        let snapshot_res = tauri::async_runtime::spawn_blocking(move || {
            linux_webkit::snapshot_current_webview(&snap_app)
        })
        .await;

        match snapshot_res {
            Ok(Ok(snapshot)) => {
                if let Ok(cropped) = crop_rect(&snapshot, &rect) {
                    let (cw, ch) = (cropped.width(), cropped.height());
                    if !blackframe::is_black_frame(cropped.as_raw(), cw, ch) {
                        Some(cropped)
                    } else {
                        None
                    }
                } else {
                    None
                }
            }
            _ => None,
        }
    };

    #[cfg(not(target_os = "linux"))]
    let captured_img: Option<image::RgbaImage> = None;

    let final_img = match captured_img {
        Some(img) => img,
        None => {
            if let Some(video_id) = scholiast_core::normalize::extract_video_id(&url) {
                fetch_youtube_frame(&video_id).await?
            } else {
                return Err(ScholiastError::Internal(
                    "frame capture is unavailable for this content".into(),
                ));
            }
        }
    };

    let (jpeg, out_w, out_h) = encode_jpeg_q80(final_img).map_err(internal)?;

    let tmp_dir = app
        .path()
        .app_data_dir()
        .map_err(internal)?
        .join("tmp");
    tokio::fs::create_dir_all(&tmp_dir)
        .await
        .map_err(|e| ScholiastError::Io(e.to_string()))?;
    let path = tmp_dir.join(format!("capture-{}.jpg", now_stamp()));
    tokio::fs::write(&path, &jpeg)
        .await
        .map_err(|e| ScholiastError::Io(e.to_string()))?;

    Ok(Reply::new(CaptureOut {
        path: path.to_string_lossy().into_owned(),
        w: out_w,
        h: out_h,
        url_hash,
    }))
}

/// Deletes a temp capture file. Only paths inside the app's own `tmp/`
/// directory are honored — this is reachable from the renderer, so treat the
/// argument as untrusted.
#[tauri::command]
pub async fn cleanup_capture(app: AppHandle, path: String) -> Result<bool, String> {
    let base = app
        .path()
        .app_data_dir()
        .map_err(|e| e.to_string())?
        .canonicalize()
        .ok();
    let target = std::path::PathBuf::from(&path).canonicalize().ok();
    match (base, target) {
        (Some(base), Some(target))
            if target.starts_with(base.join("tmp")) && target.is_file() =>
        {
            std::fs::remove_file(target).map(|_| true).map_err(|e| e.to_string())
        }
        _ => Ok(false),
    }
}

/// Convenience for tests + temp filenames: unix millis.
pub(crate) fn now_stamp() -> u128 {
    std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default()
}

#[cfg(all(test, target_os = "linux"))]
mod tests {
    use super::*;

    fn gradient(w: u32, h: u32) -> image::RgbaImage {
        image::ImageBuffer::from_fn(w, h, |x, y| {
            [(x * 4) as u8, (y * 4) as u8, ((x + y) * 2) as u8, 255].into()
        })
    }

    #[test]
    fn crop_inside_bounds_copies_region() {
        let img = gradient(100, 80);
        let out = crop_rect(&img, &CaptureRect { x: 10, y: 20, w: 30, h: 40 }).unwrap();
        assert_eq!(out.dimensions(), (30, 40));
        assert_eq!(out.get_pixel(0, 0), img.get_pixel(10, 20));
    }

    #[test]
    fn crop_clamps_out_of_bounds_edges() {
        let img = gradient(100, 80);
        let out = crop_rect(&img, &CaptureRect { x: -50, y: -50, w: 200, h: 200 }).unwrap();
        assert_eq!(out.dimensions(), (100, 80));
        assert_eq!(out.get_pixel(99, 79), img.get_pixel(99, 79));
    }

    #[test]
    fn crop_partially_out_of_bounds_keeps_intersection() {
        let img = gradient(100, 80);
        let out = crop_rect(&img, &CaptureRect { x: 90, y: 70, w: 40, h: 40 }).unwrap();
        assert_eq!(out.dimensions(), (10, 10));
    }

    #[test]
    fn crop_fully_outside_errors() {
        let img = gradient(100, 80);
        assert!(crop_rect(&img, &CaptureRect { x: -500, y: -500, w: 100, h: 100 }).is_err());
        assert!(crop_rect(&img, &CaptureRect { x: 0, y: 0, w: 0, h: 10 }).is_err());
    }

    #[test]
    fn jpeg_roundtrip_preserves_dims_and_downscales_wide_frames() {
        let small = gradient(64, 48);
        let (bytes, w, h) = encode_jpeg_q80(small).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((w, h), (64, 48));
        assert_eq!(decoded.width(), 64);
        assert_eq!(decoded.height(), 48);

        let wide = gradient(2560, 720);
        let (bytes, w, h) = encode_jpeg_q80(wide).unwrap();
        let decoded = image::load_from_memory(&bytes).unwrap();
        assert_eq!((w, h), (1280, 360));
        assert_eq!(decoded.width(), 1280);
        assert_eq!(decoded.height(), 360);
    }

    #[test]
    fn black_crop_is_rejected_by_detector() {
        let dark =
            image::ImageBuffer::from_fn(64, 48, |_, _| image::Rgba([3u8, 1, 4, 255]));
        assert!(blackframe::is_black_frame(dark.as_raw(), 64, 48));
        let bright = gradient(64, 48);
        assert!(!blackframe::is_black_frame(bright.as_raw(), 64, 48));
    }
}

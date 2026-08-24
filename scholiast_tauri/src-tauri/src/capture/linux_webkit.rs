//! Linux snapshot backend: renders the live WebKitWebView into a cairo image
//! surface and converts it to straight RGBA.
//!
//! Technique replicated from the proven Flutter harvest
//! (`scholiast_flutter/linux/webkit_view/webkit_view.cc` `harvest_frame()`):
//! allocation-sized `CAIRO_FORMAT_ARGB32` surface → white paint →
//! `gtk_widget_draw(view, cr)` → per-pixel BGRA→RGBA unpremultiply. This only
//! produces real pixels because the scaffold forces
//! `WEBKIT_DISABLE_COMPOSITING_MODE=1` before any webview exists (lib.rs);
//! under accelerated compositing the harvest comes out blank.
//!
//! Quirks (see task LOG.md): tauri 2.11's `Webview::inner()` already hands us
//! the typed `webkit2gtk::WebView`, so no widget-tree descent is required;
//! `gtk_widget_draw` is deprecated-but-present GTK3 API that the bindings do
//! not expose, hence the local `extern "C"` declaration; the draw must run on
//! the GTK main thread, which `with_webview` guarantees.

use std::sync::mpsc;
use std::time::Duration;

use gtk::prelude::*;
use image::RgbaImage;
use tauri::{AppHandle, Manager};
use webkit2gtk::glib::translate::ToGlibPtr;

const SNAPSHOT_TIMEOUT: Duration = Duration::from_secs(5);

extern "C" {
    fn gtk_widget_draw(widget: *mut gtk::ffi::GtkWidget, cr: *mut cairo::ffi::cairo_t);
}

/// Renders the main window's webview into an RGBA buffer on the GTK main
/// thread. Blocking; safe to call from any thread.
pub(crate) fn snapshot_current_webview(app: &AppHandle) -> Result<RgbaImage, String> {
    let window = app
        .get_webview_window("main")
        .ok_or_else(|| "main window not found".to_string())?;
    let (tx, rx) = mpsc::channel();
    let _ = window.with_webview(move |webview| {
        let view = webview.inner();
        let result = harvest(&view);
        let _ = tx.send(result);
    });
    match rx.recv_timeout(SNAPSHOT_TIMEOUT) {
        Ok(result) => result,
        Err(_) => Err("frame capture timed out waiting for the GTK main loop".into()),
    }
}

/// The actual draw + conversion; must run on the main thread.
fn harvest(view: &webkit2gtk::WebView) -> Result<RgbaImage, String> {
    assert!(
        view.upcast_ref::<gtk::Widget>()
            .is::<webkit2gtk::WebView>(),
        "webview handle is not a WebKitWebView"
    );

    // WebKitGTK may report a zero allocation if the widget was never realized.
    let alloc = view.upcast_ref::<gtk::Widget>().allocation();
    let (w, h) = (alloc.width().max(0) as u32, alloc.height().max(0) as u32);
    if w == 0 || h == 0 {
        return Err("webview has zero-size allocation; nothing to capture".into());
    }

    let mut surface = cairo::ImageSurface::create(cairo::Format::ARgb32, w as i32, h as i32)
        .map_err(|e| format!("cairo surface create failed: {e}"))?;
    let cr = cairo::Context::new(&surface)
        .map_err(|e| format!("cairo context create failed: {e}"))?;
    cr.set_source_rgb(1.0, 1.0, 1.0);
    let _ = cr.paint(); // white backdrop: transparent regions read as page paper

    unsafe {
        let widget_ptr = view.upcast_ref::<gtk::Widget>().to_glib_none().0;
        gtk_widget_draw(widget_ptr, cairo::Context::to_raw_none(&cr));
    }
    surface.flush();

    let stride = surface.stride() as usize;
    let data = surface.data().map_err(|e| format!("cairo data unavailable: {e}"))?;
    let mut rgba = vec![0u8; (w as usize) * (h as usize) * 4];
    for y in 0..h as usize {
        let row = &data[y * stride..y * stride + w as usize * 4];
        let dst = &mut rgba[y * w as usize * 4..(y + 1) * w as usize * 4];
        argb_row_to_rgba(row, dst);
    }
    RgbaImage::from_raw(w, h, rgba).ok_or_else(|| "RGBA buffer size mismatch".into())
}

/// One ARGB32 row (BGRA-premultiplied bytes on little-endian) → straight RGBA,
/// byte-for-byte the unpremultiply math of the reference implementation.
fn argb_row_to_rgba(src: &[u8], dst: &mut [u8]) {
    for (s, d) in src.chunks_exact(4).zip(dst.chunks_exact_mut(4)) {
        let (b, g, r, a) = (s[0], s[1], s[2], s[3]);
        let (r, g, b) = if a != 0 && a != 255 {
            (
                ((r as u32 * 255 + a as u32 / 2) / a as u32) as u8,
                ((g as u32 * 255 + a as u32 / 2) / a as u32) as u8,
                ((b as u32 * 255 + a as u32 / 2) / a as u32) as u8,
            )
        } else {
            (r, g, b)
        };
        d[0] = r;
        d[1] = g;
        d[2] = b;
        d[3] = a;
    }
}

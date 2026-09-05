//! Linux-only WebKitGTK microphone/camera grant.
//!
//! WebKitGTK ships `enable-media-stream` off and denies every
//! `permission-request` the embedder doesn't handle, so
//! `navigator.mediaDevices.getUserMedia()` always rejects with
//! `NotAllowedError` ("the request is not allowed by the user agent or the
//! platform") on Linux desktop — while the same code works in a real browser
//! and on macOS/Windows webviews. This reaches the native
//! `webkit2gtk::WebView` (the same `with_webview` pattern as
//! `capture::linux_webkit`), enables the media-stream setting, and
//! auto-allows user-media (mic/camera) plus device-info (mic labels)
//! requests. Any other permission kind keeps WebKit's default deny by
//! returning `false`. wry 0.55.1 registers no permission handler of its own
//! on this backend, so without this nothing can ever grant the request.

use tauri::Manager;
use webkit2gtk::glib::prelude::*;
use webkit2gtk::{
    DeviceInfoPermissionRequest, PermissionRequestExt, SettingsExt, UserMediaPermissionRequest,
    WebViewExt,
};

/// Allow mic/camera capture in the main window's webview. Runs on the GTK
/// main thread inside `with_webview`; a missing window only skips the grant.
pub(crate) fn grant_media_permissions(app: &tauri::AppHandle) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    let _ = window.with_webview(|webview| {
        let view = webview.inner();
        if let Some(settings) = view.settings() {
            settings.set_enable_media_stream(true);
        }
        view.connect_permission_request(|_, request| {
            if request
                .downcast_ref::<UserMediaPermissionRequest>()
                .is_some()
                || request
                    .downcast_ref::<DeviceInfoPermissionRequest>()
                    .is_some()
            {
                request.allow();
                true
            } else {
                false
            }
        });
    });
}

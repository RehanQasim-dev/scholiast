// Native WebKitGTK web view hosted inside a Flutter Linux app.
//
// The Linux Flutter embedding has no platform views, so the WebKitWebView is
// created in a GtkOffscreenWindow and rendered into a Flutter texture
// (FlPixelBufferTexture). Software compositing is forced via the
// WEBKIT_DISABLE_COMPOSITING_MODE env var (see runner main.cc) because the
// accelerated renderer produces black pixels for both gtk_widget_draw and
// canvas readback, which would break frame capture and screenshots.

#ifndef WEBKIT_VIEW_H_
#define WEBKIT_VIEW_H_

#include <flutter_linux/flutter_linux.h>
#include <glib-object.h>
#include <gtk/gtk.h>
#include <webkit2/webkit2.h>

// G_DECLARE_FINAL_TYPE must not be inside extern "C" (it emits C++ helpers).
#define WEBKIT_VIEW_TYPE_VIEW (webkit_view_get_type())
G_DECLARE_FINAL_TYPE(WebKitView, webkit_view, WEBKIT, VIEW, GObject)

G_BEGIN_DECLS

/// Creates a web view bound to method channel `channel` under integer `id`.
/// Ownership transfers to the caller; destroy with g_object_unref() (or via
/// webkit_view_destroy()).
WebKitView* webkit_view_new(FlMethodChannel* channel, FlTextureRegistrar* texture_registrar, int64_t id, int width, int height);

/// Returns the texture id Dart uses to display this view's Texture widget.
int64_t webkit_view_get_texture_id(WebKitView* self);

void webkit_view_load_url(WebKitView* self, const gchar* url);
void webkit_view_load_file(WebKitView* self, const gchar* path);
void webkit_view_eval_js(WebKitView* self, const gchar* script, GCancellable* cancelable,
                         GAsyncReadyCallback callback, gpointer user_data);
/// Returns JSON text of the evaluate_javascript result (transfer full), or
/// NULL. Only valid in the async-finish callback.
gchar* webkit_view_eval_js_finish(WebKitView* self, GAsyncResult* result);
void webkit_view_set_size(WebKitView* self, int width, int height);
void webkit_view_pointer(WebKitView* self, const char* type, double x, double y, int buttons);
void webkit_view_scroll(WebKitView* self, double dx, double dy, double x, double y);
void webkit_view_key(WebKitView* self, gboolean press, guint keyval, const char* text, guint state);
/// Registers a JS handler name so window.flutter_inappwebview.callHandler(name)
/// routes it to the Dart side. Unknown names resolve to null on the JS side.
void webkit_view_add_js_handler(WebKitView* self, const char* name);

void webkit_view_destroy(WebKitView* self);

/// Registers the "scholiast/webkit_view" method channel on the given
/// registrar. Called from the runner after fl_register_plugins().
void webkit_view_plugin_register_with_registrar(FlPluginRegistrar* registrar);

G_END_DECLS

#endif  // WEBKIT_VIEW_H_

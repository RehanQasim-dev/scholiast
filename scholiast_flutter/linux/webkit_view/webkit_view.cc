#include "webkit_view.h"

#include <cairo.h>
#include <jsc/jsc.h>
#include <string.h>

// ---------------------------------------------------------------------------
// Texture: FlPixelBufferTexture subclass backed by an RGBA buffer owned by the
// view. copy_pixels runs on the Flutter render thread, so every access to the
// buffer goes through the view mutex.
// ---------------------------------------------------------------------------

// Full definition up front: the texture's copy_pixels callback (render
// thread) reads straight into this.
typedef struct _WebkitViewTexture WebkitViewTexture;

struct WebKitViewPrivate {
  GMutex buffer_mutex = {0};
  uint8_t* buffer = nullptr;
  int buffer_width = 0;
  int buffer_height = 0;

  WebkitViewTexture* texture = nullptr;
  FlTextureRegistrar* texture_registrar = nullptr;
  FlMethodChannel* channel = nullptr;
  int64_t id = 0;

  GtkWidget* window = nullptr;  // GtkOffscreenWindow
  WebKitWebView* view = nullptr;

  // Set when WebKit painted something we haven't harvested into the texture
  // yet. Our own harvesting draws are flagged so they don't re-set it.
  gboolean dirty = TRUE;
  gboolean harvesting = FALSE;
  guint poll_timer_id = 0;
};

typedef struct {
  FlPixelBufferTextureClass parent_class;
} WebkitViewTextureClass;

struct _WebkitViewTexture {
  FlPixelBufferTexture parent_instance;
  struct WebKitViewPrivate* priv;
};

G_DEFINE_TYPE(WebkitViewTexture, webkit_view_texture,
              fl_pixel_buffer_texture_get_type())

static void webkit_view_texture_init(WebkitViewTexture* self) {
  (void)self;
}

struct BridgeReplyContext;
static void bridge_dart_response_cb(GObject* channel, GAsyncResult* result,
                                    gpointer user_data);

static gboolean webkit_view_texture_copy_pixels(FlPixelBufferTexture* texture,
                                                const uint8_t** out_buffer,
                                                uint32_t* width,
                                                uint32_t* height,
                                                GError** error) {
  WebkitViewTexture* tex = reinterpret_cast<WebkitViewTexture*>(texture);
  WebKitViewPrivate* p = tex->priv;
  g_mutex_lock(&p->buffer_mutex);
  if (p->buffer == nullptr || p->buffer_width <= 0 || p->buffer_height <= 0) {
    g_mutex_unlock(&p->buffer_mutex);
    g_set_error(error, g_quark_from_static_string("webkit-view"), 1,
                "no frame rendered yet");
    return FALSE;
  }
  *out_buffer = p->buffer;
  *width = static_cast<uint32_t>(p->buffer_width);
  *height = static_cast<uint32_t>(p->buffer_height);
  g_mutex_unlock(&p->buffer_mutex);
  return TRUE;
}

static void webkit_view_texture_class_init(WebkitViewTextureClass* klass) {
  FL_PIXEL_BUFFER_TEXTURE_CLASS(klass)->copy_pixels =
      webkit_view_texture_copy_pixels;
}

// ---------------------------------------------------------------------------
// View object
// ---------------------------------------------------------------------------

struct _WebKitView {
  GObject parent_instance;
};

G_DEFINE_TYPE_WITH_CODE(WebKitView, webkit_view, G_TYPE_OBJECT,
                        G_ADD_PRIVATE(WebKitView))

static inline WebKitViewPrivate* priv_of(WebKitView* self) {
  return reinterpret_cast<WebKitViewPrivate*>(
      webkit_view_get_instance_private(self));
}

static void webkit_view_finalize(GObject* object) {
  WebKitView* self = WEBKIT_VIEW(object);
  WebKitViewPrivate* p = priv_of(self);
  if (p->poll_timer_id != 0) g_source_remove(p->poll_timer_id);
  if (p->texture != nullptr && p->texture_registrar != nullptr) {
    fl_texture_registrar_unregister_texture(p->texture_registrar,
                                            FL_TEXTURE(p->texture));
    g_object_unref(p->texture);  // drop our creation ref; registrar held its own until unregister
    p->texture = nullptr;
  }
  g_clear_pointer(&p->window, gtk_widget_destroy);
  g_free(p->buffer);
  g_mutex_clear(&p->buffer_mutex);
  g_clear_object(&p->channel);
  G_OBJECT_CLASS(webkit_view_parent_class)->finalize(object);
}

static void webkit_view_class_init(WebKitViewClass* klass) {
  G_OBJECT_CLASS(klass)->finalize = webkit_view_finalize;
}

static void webkit_view_init(WebKitView* self) {
  (void)self;
}

// --- helpers ---------------------------------------------------------------

static FlValue* make_args_map(int64_t id) {
  FlValue* args = fl_value_new_map();
  fl_value_set_string_take(args, "id", fl_value_new_int(id));
  return args;
}

// invoke_method does not consume the args; always unref after the call.
static void invoke_on_channel(WebKitView* self, const char* method, FlValue* args) {
  if (self != nullptr && priv_of(self)->channel != nullptr) {
    fl_method_channel_invoke_method(priv_of(self)->channel, method, args, nullptr,
                                    nullptr, nullptr);
  }
  fl_value_unref(args);
}

// Converts the ARGB32 cairo surface into the straight-RGBA texture buffer and
// marks the frame available. Takes ownership of the surface.
static void push_surface_to_texture(WebKitView* self, cairo_surface_t* surface) {
  WebKitViewPrivate* p = priv_of(self);
  cairo_surface_flush(surface);
  int width = cairo_image_surface_get_width(surface);
  int height = cairo_image_surface_get_height(surface);
  unsigned char* data = cairo_image_surface_get_data(surface);
  if (width <= 0 || height <= 0 || data == nullptr) {
    cairo_surface_destroy(surface);
    return;
  }

  g_mutex_lock(&p->buffer_mutex);
  if (p->buffer == nullptr || width != p->buffer_width ||
      height != p->buffer_height) {
    g_free(p->buffer);
    p->buffer = static_cast<uint8_t*>(g_malloc(
        static_cast<gsize>(width) * height * 4));
    p->buffer_width = width;
    p->buffer_height = height;
  }
  uint8_t* dst = p->buffer;
  const size_t n = static_cast<size_t>(width) * height;
  for (size_t i = 0; i < n; i++) {
    uint32_t pixel = reinterpret_cast<uint32_t*>(data)[i];
    uint8_t b = static_cast<uint8_t>(pixel & 0xFF);
    uint8_t g = static_cast<uint8_t>((pixel >> 8) & 0xFF);
    uint8_t r = static_cast<uint8_t>((pixel >> 16) & 0xFF);
    uint8_t a = static_cast<uint8_t>((pixel >> 24) & 0xFF);
    if (a != 0 && a != 255) {  // unpremultiply
      r = static_cast<uint8_t>((r * 255 + a / 2) / a);
      g = static_cast<uint8_t>((g * 255 + a / 2) / a);
      b = static_cast<uint8_t>((b * 255 + a / 2) / a);
    }
    dst[i * 4] = r;
    dst[i * 4 + 1] = g;
    dst[i * 4 + 2] = b;
    dst[i * 4 + 3] = a;
  }
  g_mutex_unlock(&p->buffer_mutex);

  fl_texture_registrar_mark_texture_frame_available(p->texture_registrar,
                                                    FL_TEXTURE(p->texture));
  cairo_surface_destroy(surface);
}

// Renders the web view into an image surface and pushes it to the texture.
static void harvest_frame(WebKitView* self) {
  WebKitViewPrivate* p = priv_of(self);
  if (p->harvesting || p->view == nullptr) return;
  GtkAllocation alloc;
  gtk_widget_get_allocation(GTK_WIDGET(p->view), &alloc);
  if (alloc.width <= 0 || alloc.height <= 0) return;

  p->harvesting = TRUE;
  cairo_surface_t* surface = cairo_image_surface_create(
      CAIRO_FORMAT_ARGB32, alloc.width, alloc.height);
  cairo_t* cr = cairo_create(surface);
  cairo_set_source_rgb(cr, 1.0, 1.0, 1.0);
  cairo_paint(cr);
  gtk_widget_draw(GTK_WIDGET(p->view), cr);
  cairo_destroy(cr);
  p->harvesting = FALSE;
  p->dirty = FALSE;

  push_surface_to_texture(self, surface);
}

// Poll: harvest only when WebKit actually repainted since last time. While a
// video plays or content animates, WebKit invalidates continuously; idle
// pages cost nothing beyond a cheap flag check.
static gboolean poll_tick(gpointer user_data) {
  WebKitView* self = WEBKIT_VIEW(user_data);
  if (priv_of(self)->dirty) harvest_frame(self);
  return G_SOURCE_CONTINUE;
}

// --- WebKit signal handlers -------------------------------------------------

static void on_load_changed(WebKitWebView* web_view, WebKitLoadEvent event,
                            gpointer user_data) {
  WebKitView* self = WEBKIT_VIEW(user_data);
  if (event != WEBKIT_LOAD_FINISHED) return;
  priv_of(self)->dirty = TRUE;
  const gchar* uri = webkit_web_view_get_uri(web_view);
  FlValue* args = make_args_map(priv_of(self)->id);
  fl_value_set_string_take(args, "url",
                           uri ? fl_value_new_string(uri) : fl_value_new_null());
  invoke_on_channel(self, "onLoadStop", args);
}

static void on_notify_title(WebKitWebView* web_view, GParamSpec* pspec,
                            gpointer user_data) {
  (void)pspec;
  WebKitView* self = WEBKIT_VIEW(user_data);
  const gchar* title = webkit_web_view_get_title(web_view);
  if (title == nullptr || strlen(title) == 0) return;
  FlValue* args = make_args_map(priv_of(self)->id);
  fl_value_set_string_take(args, "title", fl_value_new_string(title));
  invoke_on_channel(self, "onTitle", args);
}

// Marks dirty whenever WebKit paints for any reason other than our own
// harvest draws.
static void on_view_draw(GtkWidget* widget, cairo_t* cr, gpointer user_data) {
  (void)widget;
  (void)cr;
  WebKitView* self = WEBKIT_VIEW(user_data);
  if (!priv_of(self)->harvesting) priv_of(self)->dirty = TRUE;
}

// --- JS bridge ---------------------------------------------------------------
//
// Injected at document start into the top frame. Mirrors the
// flutter_inappwebview bridge contract our JS assets already use:
//   window.flutter_inappwebview.callHandler(name, ...args) -> Promise<any>
// Arguments travel as one JSON string over the script message handler; the
// Dart side parses it and replies with JSON.

static const char kBridgeShimJs[] =
    "(function(){"
    "if(window.flutter_inappwebview&&window.flutter_inappwebview.__scholiast)return;"
    "window.flutter_inappwebview={__scholiast:true,"
    "callHandler:function(name){"
    "var args=Array.prototype.slice.call(arguments,1);"
    "return window.webkit.messageHandlers.scholiast.postMessage("
    "JSON.stringify({n:name,a:args}));"
    "}};"
    "var fmt=function(a){try{return Array.prototype.map.call(a,function(x){"
    "if(x instanceof Error)return x.stack||String(x);return String(x);}).join(' ');}"
    "catch(e){return '';}};"
    "['log','warn','error','info','debug'].forEach(function(k){"
    "var orig=console[k]?console[k].bind(console):function(){};"
    "console[k]=function(){"
    "try{window.flutter_inappwebview.callHandler('__console__',k+': '+fmt(arguments));}catch(e){}"
    "orig.apply(null,arguments);};});"
    "})();";

struct BridgeReplyContext {
  WebKitScriptMessageReply* reply;
  JSCContext* jsc_context;  // owned ref from the message value
};

static void bridge_dart_response_cb(GObject* object, GAsyncResult* result,
                                    gpointer user_data) {
  auto* ctx = static_cast<BridgeReplyContext*>(user_data);
  GError* error = nullptr;
  FlMethodResponse* response = fl_method_channel_invoke_method_finish(
      FL_METHOD_CHANNEL(object), result, &error);
  gchar* json = nullptr;
  if (error == nullptr && response != nullptr &&
      FL_IS_METHOD_SUCCESS_RESPONSE(response)) {
    FlValue* v =
        fl_method_success_response_get_result(FL_METHOD_SUCCESS_RESPONSE(response));
    if (v != nullptr && fl_value_get_type(v) == FL_VALUE_TYPE_STRING) {
      json = g_strdup(fl_value_get_string(v));
    }
  }
  if (error != nullptr) g_error_free(error);
  if (json == nullptr) json = g_strdup("null");
  JSCValue* value = jsc_value_new_from_json(ctx->jsc_context, json);
  webkit_script_message_reply_return_value(ctx->reply, value);
  g_object_unref(value);
  g_object_unref(ctx->jsc_context);
  g_object_unref(ctx->reply);
  g_free(json);
  g_free(ctx);
}

static gboolean on_script_message_with_reply(WebKitUserContentManager* manager,
                                             WebKitJavascriptResult* message,
                                             WebKitScriptMessageReply* reply,
                                             gpointer user_data) {
  (void)manager;
  WebKitView* self = WEBKIT_VIEW(user_data);
  JSCValue* value = webkit_javascript_result_get_js_value(message);
  const gchar* payload = jsc_value_to_string(value);

  auto* ctx = g_new0(BridgeReplyContext, 1);
  ctx->reply = static_cast<WebKitScriptMessageReply*>(g_object_ref(reply));
  ctx->jsc_context = JSC_CONTEXT(g_object_ref(jsc_value_get_context(value)));

  FlValue* args = make_args_map(priv_of(self)->id);
  fl_value_set_string_take(args, "payload", fl_value_new_string(payload));
  fl_method_channel_invoke_method(priv_of(self)->channel, "callHandler", args,
                                  nullptr, bridge_dart_response_cb, ctx);
  return TRUE;
}

// --- evaluateJavascript ------------------------------------------------------

void webkit_view_eval_js(WebKitView* self, const gchar* script,
                         GCancellable* cancelable, GAsyncReadyCallback callback,
                         gpointer user_data) {
  webkit_web_view_evaluate_javascript(priv_of(self)->view, script, -1, nullptr,
                                      nullptr, cancelable, callback, user_data);
}

gchar* webkit_view_eval_js_finish(WebKitView* self, GAsyncResult* result) {
  GError* error = nullptr;
  JSCValue* value = webkit_web_view_evaluate_javascript_finish(
      priv_of(self)->view, result, &error);
  if (error != nullptr) {
    g_error_free(error);
    return g_strdup("null");
  }
  if (value == nullptr) {
    return g_strdup("null");
  }
  gchar* json = jsc_value_to_json(value, 0);
  g_object_unref(value);
  return json != nullptr ? json : g_strdup("null");
}

// --- input synthesis ---------------------------------------------------------

static GdkWindow* view_gdk_window(WebKitView* self) {
  return gtk_widget_get_window(GTK_WIDGET(priv_of(self)->view));
}

void webkit_view_pointer(WebKitView* self, const char* type, double x, double y,
                         int buttons) {
  if (priv_of(self)->view == nullptr || view_gdk_window(self) == nullptr) return;
  guint state = 0;
  if ((buttons & 0x1) != 0) state |= GDK_BUTTON1_MASK;
  if ((buttons & 0x2) != 0) state |= GDK_BUTTON3_MASK;
  if ((buttons & 0x4) != 0) state |= GDK_BUTTON2_MASK;

  GdkEvent* ev;
  if (strcmp(type, "down") == 0 || strcmp(type, "up") == 0) {
    ev = gdk_event_new(strcmp(type, "down") == 0 ? GDK_BUTTON_PRESS
                                                 : GDK_BUTTON_RELEASE);
    ev->button.window = view_gdk_window(self);
    g_object_ref(ev->button.window);
    ev->button.x = x;
    ev->button.y = y;
    ev->button.button = (buttons & 0x2) != 0 ? 3 : 1;
    ev->button.state = strcmp(type, "up") == 0 ? 0 : state;
    ev->button.time = GDK_CURRENT_TIME;
    ev->button.send_event = TRUE;
  } else {  // move
    ev = gdk_event_new(GDK_MOTION_NOTIFY);
    ev->motion.window = view_gdk_window(self);
    g_object_ref(ev->motion.window);
    ev->motion.x = x;
    ev->motion.y = y;
    ev->motion.state = state;
    ev->motion.time = GDK_CURRENT_TIME;
    ev->motion.send_event = TRUE;
  }
  gtk_widget_event(GTK_WIDGET(priv_of(self)->view), ev);
  gdk_event_free(ev);
  priv_of(self)->dirty = TRUE;
}

void webkit_view_scroll(WebKitView* self, double dx, double dy, double x, double y) {
  if (priv_of(self)->view == nullptr || view_gdk_window(self) == nullptr) return;
  GdkEvent* ev = gdk_event_new(GDK_SCROLL);
  ev->scroll.window = view_gdk_window(self);
  g_object_ref(ev->scroll.window);
  ev->scroll.direction = GDK_SCROLL_SMOOTH;
  ev->scroll.delta_x = dx;
  ev->scroll.delta_y = dy;
  ev->scroll.x = x;
  ev->scroll.y = y;
  ev->scroll.time = GDK_CURRENT_TIME;
  ev->scroll.send_event = TRUE;
  gtk_widget_event(GTK_WIDGET(priv_of(self)->view), ev);
  gdk_event_free(ev);
  priv_of(self)->dirty = TRUE;
}

void webkit_view_key(WebKitView* self, gboolean press, guint keyval,
                     const char* text, guint state) {
  if (priv_of(self)->view == nullptr) return;
  GdkWindow* window = view_gdk_window(self);
  GdkEvent* ev = gdk_event_new(press ? GDK_KEY_PRESS : GDK_KEY_RELEASE);
  ev->key.window = window;
  if (window != nullptr) g_object_ref(window);
  ev->key.keyval = keyval;
  ev->key.state = state;
  ev->key.send_event = TRUE;
  ev->key.time = GDK_CURRENT_TIME;
  ev->key.group = 0;
  ev->key.hardware_keycode = static_cast<guint16>(keyval & 0xFFFF);
  if (text != nullptr && press) {
    strncpy(ev->key.string, text, sizeof(ev->key.string) - 1);
    ev->key.length = static_cast<gint>(strlen(ev->key.string));
  } else {
    ev->key.string[0] = '\0';
    ev->key.length = 0;
  }
  gtk_widget_event(GTK_WIDGET(priv_of(self)->view), ev);
  gdk_event_free(ev);
  priv_of(self)->dirty = TRUE;
}

// --- public API ----------------------------------------------------------------

int64_t webkit_view_get_texture_id(WebKitView* self) {
  return fl_texture_get_id(FL_TEXTURE(priv_of(self)->texture));
}

void webkit_view_load_url(WebKitView* self, const gchar* url) {
  webkit_web_view_load_uri(priv_of(self)->view, url);
}

void webkit_view_load_file(WebKitView* self, const gchar* path) {
  gchar* uri = g_filename_to_uri(path, nullptr, nullptr);
  if (uri == nullptr) return;
  webkit_web_view_load_uri(priv_of(self)->view, uri);
  g_free(uri);
}

void webkit_view_add_js_handler(WebKitView* self, const char* name) {
  // Handlers are routed by name through the single "scholiast" message
  // channel; registration is bookkeeping only.
  (void)self;
  (void)name;
}

void webkit_view_set_size(WebKitView* self, int width, int height) {
  if (width <= 0 || height <= 0) return;
  gtk_widget_set_size_request(GTK_WIDGET(priv_of(self)->view), width, height);
  priv_of(self)->dirty = TRUE;
}

WebKitView* webkit_view_new(FlMethodChannel* channel,
                            FlTextureRegistrar* texture_registrar, int64_t id,
                            int width, int height) {
  auto* self = WEBKIT_VIEW(g_object_new(WEBKIT_VIEW_TYPE_VIEW, nullptr));
  WebKitViewPrivate* p = priv_of(self);
  g_mutex_init(&p->buffer_mutex);
  p->channel = FL_METHOD_CHANNEL(g_object_ref(channel));
  p->texture_registrar = texture_registrar;
  p->id = id;

  p->texture = reinterpret_cast<WebkitViewTexture*>(
      g_object_new(webkit_view_texture_get_type(), nullptr));
  p->texture->priv = p;
  fl_texture_registrar_register_texture(texture_registrar, FL_TEXTURE(p->texture));

  // Offscreen GTK window hosting the real widget tree.
  p->window = gtk_offscreen_window_new();
  WebKitUserContentManager* ucm = webkit_user_content_manager_new();
  webkit_user_content_manager_register_script_message_handler_with_reply(
      ucm, "scholiast", nullptr);
  g_signal_connect(ucm, "script-message-with-reply-received::scholiast",
                   G_CALLBACK(on_script_message_with_reply), self);
  WebKitUserScript* shim = webkit_user_script_new(
      kBridgeShimJs, WEBKIT_USER_CONTENT_INJECT_TOP_FRAME,
      WEBKIT_USER_SCRIPT_INJECT_AT_DOCUMENT_START, nullptr, nullptr);
  webkit_user_content_manager_add_script(ucm, shim);
  webkit_user_script_unref(shim);

  p->view = WEBKIT_WEB_VIEW(webkit_web_view_new_with_user_content_manager(ucm));

  WebKitSettings* settings = webkit_web_view_get_settings(p->view);
  webkit_settings_set_enable_javascript(settings, TRUE);
  // player.html reaches into the YouTube iframe DOM to capture frames; that
  // requires the file:// top page to be treated as same-origin with anything.
  webkit_settings_set_allow_universal_access_from_file_urls(settings, TRUE);
  webkit_settings_set_allow_file_access_from_file_urls(settings, TRUE);
  // Lecture playback must start without a click.
  webkit_settings_set_media_playback_requires_user_gesture(settings, FALSE);
  webkit_settings_set_enable_smooth_scrolling(settings, TRUE);

  g_signal_connect(p->view, "load-changed", G_CALLBACK(on_load_changed), self);
  g_signal_connect(p->view, "notify::title", G_CALLBACK(on_notify_title), self);
  g_signal_connect_after(p->view, "draw", G_CALLBACK(on_view_draw), self);

  gtk_container_add(GTK_CONTAINER(p->window), GTK_WIDGET(p->view));
  gtk_widget_set_size_request(GTK_WIDGET(p->view),
                              width > 0 ? width : 800, height > 0 ? height : 600);
  gtk_widget_show_all(p->window);
  gtk_widget_grab_focus(GTK_WIDGET(p->view));

  // First frame: force one paint so the texture is valid before any load
  // events fire.
  p->dirty = TRUE;
  harvest_frame(self);
  p->poll_timer_id = g_timeout_add(16, poll_tick, self);
  return self;
}

void webkit_view_destroy(WebKitView* self) {
  g_object_unref(self);
}

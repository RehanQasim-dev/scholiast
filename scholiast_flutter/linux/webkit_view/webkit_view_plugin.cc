// Method-channel front end for the WebKitGTK texture web views.
// Channel: "scholiast/webkit_view" — see lib/core/webkit/embedded_webview.dart
// for the Dart-side contract.

#include <flutter_linux/flutter_linux.h>
#include <gtk/gtk.h>

#include "webkit_view.h"

G_DECLARE_FINAL_TYPE(WebkitViewPlugin, webkit_view_plugin, WEBKIT,
                     VIEW_PLUGIN, GObject)

#define WEBKIT_VIEW_PLUGIN_TYPE_PLUGIN (webkit_view_plugin_get_type())

struct _WebkitViewPlugin {
  GObject parent_instance;
  FlMethodChannel* channel;
  FlTextureRegistrar* texture_registrar;
  GHashTable* views;  // int64 id (as gpointer) -> WebKitView*
};

G_DEFINE_TYPE(WebkitViewPlugin, webkit_view_plugin, g_object_get_type())

static WebKitView* plugin_take_view(WebkitViewPlugin* self, int64_t id) {
  return static_cast<WebKitView*>(
      g_hash_table_lookup(self->views, reinterpret_cast<gpointer>(static_cast<intptr_t>(id))));
}

struct EvalJsCtx {
  WebKitView* view;
  FlMethodCall* method_call;
};

static void eval_js_done_cb(GObject* object, GAsyncResult* result, gpointer user_data) {
  auto* ctx = static_cast<EvalJsCtx*>(user_data);
  gchar* json = webkit_view_eval_js_finish(ctx->view, result);
  FlValue* v = fl_value_new_string(json != nullptr ? json : "null");
  fl_method_call_respond(
      ctx->method_call, FL_METHOD_RESPONSE(fl_method_success_response_new(v)), nullptr);
  fl_value_unref(v);
  g_free(json);
  g_object_unref(ctx->view);
  g_object_unref(ctx->method_call);
  delete ctx;
}

static gboolean handle_per_view_method(WebkitViewPlugin* self, WebKitView* view,
                                       const gchar* method, FlValue* args,
                                       FlMethodCall* method_call) {
  (void)self;
  if (strcmp(method, "loadUrl") == 0) {
    FlValue* v = fl_value_lookup_string(args, "url");
    if (v != nullptr && fl_value_get_type(v) == FL_VALUE_TYPE_STRING) {
      webkit_view_load_url(view, fl_value_get_string(v));
    }
  } else if (strcmp(method, "loadFile") == 0) {
    FlValue* v = fl_value_lookup_string(args, "path");
    if (v != nullptr && fl_value_get_type(v) == FL_VALUE_TYPE_STRING) {
      webkit_view_load_file(view, fl_value_get_string(v));
    }
  } else if (strcmp(method, "evalJs") == 0) {
    FlValue* v = fl_value_lookup_string(args, "script");
    if (v != nullptr && fl_value_get_type(v) == FL_VALUE_TYPE_STRING) {
      auto* ctx = new EvalJsCtx{WEBKIT_VIEW(g_object_ref(view)),
                                FL_METHOD_CALL(g_object_ref(method_call))};
      webkit_view_eval_js(view, fl_value_get_string(v), nullptr, eval_js_done_cb, ctx);
    } else {
      return FALSE;
    }
    return TRUE;  // responds asynchronously
  } else if (strcmp(method, "setSize") == 0) {
    FlValue* w = fl_value_lookup_string(args, "width");
    FlValue* h = fl_value_lookup_string(args, "height");
    if (w != nullptr && h != nullptr &&
        fl_value_get_type(w) == FL_VALUE_TYPE_INT &&
        fl_value_get_type(h) == FL_VALUE_TYPE_INT) {
      webkit_view_set_size(view, static_cast<int>(fl_value_get_int(w)),
                           static_cast<int>(fl_value_get_int(h)));
    }
  } else if (strcmp(method, "pointer") == 0) {
    FlValue* t = fl_value_lookup_string(args, "type");
    FlValue* x = fl_value_lookup_string(args, "x");
    FlValue* y = fl_value_lookup_string(args, "y");
    FlValue* b = fl_value_lookup_string(args, "buttons");
    if (t != nullptr && x != nullptr && y != nullptr && b != nullptr &&
        fl_value_get_type(t) == FL_VALUE_TYPE_STRING &&
        fl_value_get_type(x) == FL_VALUE_TYPE_FLOAT &&
        fl_value_get_type(y) == FL_VALUE_TYPE_FLOAT &&
        fl_value_get_type(b) == FL_VALUE_TYPE_INT) {
      webkit_view_pointer(view, fl_value_get_string(t), fl_value_get_float(x),
                          fl_value_get_float(y),
                          static_cast<int>(fl_value_get_int(b)));
    }
  } else if (strcmp(method, "scroll") == 0) {
    FlValue* dx = fl_value_lookup_string(args, "dx");
    FlValue* dy = fl_value_lookup_string(args, "dy");
    FlValue* x = fl_value_lookup_string(args, "x");
    FlValue* y = fl_value_lookup_string(args, "y");
    if (dx != nullptr && dy != nullptr && x != nullptr && y != nullptr &&
        fl_value_get_type(dx) == FL_VALUE_TYPE_FLOAT &&
        fl_value_get_type(dy) == FL_VALUE_TYPE_FLOAT &&
        fl_value_get_type(x) == FL_VALUE_TYPE_FLOAT &&
        fl_value_get_type(y) == FL_VALUE_TYPE_FLOAT) {
      webkit_view_scroll(view, fl_value_get_float(dx), fl_value_get_float(dy),
                         fl_value_get_float(x), fl_value_get_float(y));
    }
  } else if (strcmp(method, "key") == 0) {
    FlValue* press = fl_value_lookup_string(args, "press");
    FlValue* keyval = fl_value_lookup_string(args, "keyval");
    FlValue* text = fl_value_lookup_string(args, "text");
    FlValue* state = fl_value_lookup_string(args, "state");
    if (press != nullptr && keyval != nullptr && state != nullptr &&
        fl_value_get_type(press) == FL_VALUE_TYPE_BOOL &&
        fl_value_get_type(keyval) == FL_VALUE_TYPE_INT &&
        fl_value_get_type(state) == FL_VALUE_TYPE_INT) {
      const gchar* txt =
          (text != nullptr && fl_value_get_type(text) == FL_VALUE_TYPE_STRING)
              ? fl_value_get_string(text)
              : nullptr;
      webkit_view_key(view, fl_value_get_bool(press),
                      static_cast<guint>(fl_value_get_int(keyval)), txt,
                      static_cast<guint>(fl_value_get_int(state)));
    }
  } else {
    return FALSE;
  }
  return TRUE;
}

static void method_call_cb(FlMethodChannel* channel, FlMethodCall* method_call,
                           gpointer user_data) {
  (void)channel;
  auto* self = static_cast<WebkitViewPlugin*>(user_data);
  const gchar* method = fl_method_call_get_name(method_call);
  FlValue* args = fl_method_call_get_args(method_call);
  g_autoptr(FlMethodResponse) response = nullptr;

  if (strcmp(method, "create") == 0) {
    FlValue* id_v = fl_value_lookup_string(args, "id");
    FlValue* w = fl_value_lookup_string(args, "width");
    FlValue* h = fl_value_lookup_string(args, "height");
    if (id_v != nullptr && fl_value_get_type(id_v) == FL_VALUE_TYPE_INT) {
      const int64_t id = fl_value_get_int(id_v);
      const int width = (w != nullptr && fl_value_get_type(w) == FL_VALUE_TYPE_INT)
                            ? static_cast<int>(fl_value_get_int(w))
                            : 800;
      const int height = (h != nullptr && fl_value_get_type(h) == FL_VALUE_TYPE_INT)
                             ? static_cast<int>(fl_value_get_int(h))
                             : 600;
      WebKitView* view = webkit_view_new(self->channel, self->texture_registrar,
                                         id, width, height);
      g_hash_table_insert(self->views,
                          reinterpret_cast<gpointer>(static_cast<intptr_t>(id)),
                          view);
      FlValue* out = fl_value_new_map();
      fl_value_set_string_take(out, "textureId",
                               fl_value_new_int(webkit_view_get_texture_id(view)));
      response = FL_METHOD_RESPONSE(fl_method_success_response_new(out));
      fl_value_unref(out);
    } else {
      response = FL_METHOD_RESPONSE(
          fl_method_error_response_new("args", "create: missing id", nullptr));
    }
  } else if (strcmp(method, "destroy") == 0) {
    FlValue* id_v = fl_value_lookup_string(args, "id");
    if (id_v != nullptr && fl_value_get_type(id_v) == FL_VALUE_TYPE_INT) {
      const int64_t id = fl_value_get_int(id_v);
      WebKitView* view = plugin_take_view(self, id);
      if (view != nullptr) {
        g_hash_table_remove(self->views,
                            reinterpret_cast<gpointer>(static_cast<intptr_t>(id)));
        webkit_view_destroy(view);  // drops the map's ref
      }
      response = FL_METHOD_RESPONSE(fl_method_success_response_new(fl_value_new_bool(TRUE)));
    } else {
      response = FL_METHOD_RESPONSE(
          fl_method_error_response_new("args", "destroy: missing id", nullptr));
    }
  } else {
    FlValue* id_v = fl_value_lookup_string(args, "id");
    if (id_v != nullptr && fl_value_get_type(id_v) == FL_VALUE_TYPE_INT) {
      WebKitView* view = plugin_take_view(self, fl_value_get_int(id_v));
      if (view != nullptr && handle_per_view_method(self, view, method, args, method_call)) {
        if (strcmp(method, "evalJs") != 0) {
          response = FL_METHOD_RESPONSE(
              fl_method_success_response_new(fl_value_new_bool(TRUE)));
        }
        // evalJs responds async via eval_js_done_cb.
      } else {
        response = FL_METHOD_RESPONSE(fl_method_not_implemented_response_new());
      }
    } else {
      response = FL_METHOD_RESPONSE(
          fl_method_error_response_new("args", "missing id", nullptr));
    }
  }

  if (response != nullptr) {
    fl_method_call_respond(method_call, response, nullptr);
  }
}

static void webkit_view_plugin_finalize(GObject* object) {
  auto* self = WEBKIT_VIEW_PLUGIN(object);
  g_clear_pointer(&self->views, g_hash_table_destroy);
  g_clear_object(&self->channel);
  G_OBJECT_CLASS(webkit_view_plugin_parent_class)->finalize(object);
}

static void webkit_view_plugin_class_init(WebkitViewPluginClass* klass) {
  G_OBJECT_CLASS(klass)->finalize = webkit_view_plugin_finalize;
}

static void webkit_view_plugin_init(WebkitViewPlugin* self) {
  self->views = g_hash_table_new_full(g_direct_hash, g_direct_equal, nullptr,
                                      nullptr);
}

void webkit_view_plugin_register_with_registrar(FlPluginRegistrar* registrar);

void webkit_view_plugin_register_with_registrar(FlPluginRegistrar* registrar) {
  auto* self = WEBKIT_VIEW_PLUGIN(
      g_object_new(WEBKIT_VIEW_PLUGIN_TYPE_PLUGIN, nullptr));

  FlBinaryMessenger* messenger = fl_plugin_registrar_get_messenger(registrar);
  self->texture_registrar = fl_plugin_registrar_get_texture_registrar(registrar);
  self->channel = fl_method_channel_new(messenger, "scholiast/webkit_view",
                                        FL_METHOD_CODEC(fl_standard_method_codec_new()));
  fl_method_channel_set_method_call_handler(self->channel, method_call_cb, self,
                                            g_object_unref);
}

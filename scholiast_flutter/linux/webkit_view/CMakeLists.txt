cmake_minimum_required(VERSION 3.13)

# In-tree native plugin: WebKitGTK texture web views (see webkit_view.cc).
pkg_check_modules(WEBKIT REQUIRED IMPORTED_TARGET webkit2gtk-4.1
  javascriptcoregtk-4.1)

add_library(webkit_view_plugin STATIC
  webkit_view.cc
  webkit_view_plugin.cc)

apply_standard_settings(webkit_view_plugin)

target_include_directories(webkit_view_plugin
  PRIVATE "${CMAKE_CURRENT_SOURCE_DIR}")

target_link_libraries(webkit_view_plugin PRIVATE flutter_wrapper_plugin
  PkgConfig::WEBKIT)

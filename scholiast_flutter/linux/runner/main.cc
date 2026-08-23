#include "my_application.h"

int main(int argc, char** argv) {
  // The accelerated (DMA-BUF) renderer produces black pixels for both
  // gtk_widget_draw and canvas readback, which breaks frame capture in the
  // player. Software compositing keeps captures working; measured cost is
  // ~74% of one core during 720p30 playback (gate test, 2026-08).
  setenv("WEBKIT_DISABLE_COMPOSITING_MODE", "1", 1);
  g_autoptr(MyApplication) app = my_application_new();
  return g_application_run(G_APPLICATION(app), argc, argv);
}

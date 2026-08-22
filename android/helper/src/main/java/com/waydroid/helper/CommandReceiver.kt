package com.waydroid.helper

import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.util.Log
import java.io.File

class CommandReceiver : BroadcastReceiver() {
    override fun onReceive(ctx: Context, intent: Intent) {
        val displayId = intent.getIntExtra("displayId", 0)
        val ext = if (intent.action == "com.waydroid.helper.DUMP") "xml" else "png"
        val outPath = intent.getStringExtra("outPath")
            ?: "/sdcard/Android/data/com.waydroid.helper/files/helper_${displayId}.$ext"
        Log.i("WaydroidHelperCR", "recv ${intent.action} display $displayId out $outPath")
        when (intent.action) {
            "com.waydroid.helper.SCREENSHOT" -> {
                val svc = ScreenshotService.instance
                if (svc == null) {
                    Log.e("WaydroidHelperCR", "ScreenshotService not connected — enable in Settings > Accessibility")
                    return
                }
                Thread {
                    val ok = svc.takeScreenshotSync(displayId, File(outPath))
                    Log.i("WaydroidHelperCR", "screenshot $displayId ok=$ok -> $outPath")
                }.start()
            }
            "com.waydroid.helper.DUMP" -> {
                val svc = ScreenshotService.instance
                if (svc == null) {
                    Log.e("WaydroidHelperCR", "DUMP service not connected")
                    return
                }
                // goAsync keeps the broadcast alive while the worker runs. No lock: dumps of
                // different displays are independent reads and must stay parallel.
                val pending = goAsync()
                Thread {
                    try {
                        val xml = svc.dumpWindows(displayId)
                        try {
                            var target = File(outPath)
                            try {
                                target.parentFile?.mkdirs()
                                target.writeText(xml)
                            } catch (e: Exception) {
                                Log.w("WaydroidHelperCR", "write to $target failed, fallback to externalFilesDir", e)
                                val extDir = ctx.getExternalFilesDir(null) ?: ctx.filesDir
                                extDir.mkdirs()
                                target = File(extDir, File(outPath).name)
                                target.writeText(xml)
                                try { target.copyTo(File(outPath), overwrite = true) } catch (_: Exception) {}
                                Log.i("WaydroidHelperCR", "dump fallback saved to ${target.absolutePath} ${xml.length} bytes")
                            }
                        } catch (e: Exception) { Log.e("WaydroidHelperCR", "dump write failed", e) }
                        Log.i("WaydroidHelperCR", "dump $displayId -> $outPath ${xml.length} bytes")
                    } finally { pending.finish() }
                }.start()
            }
            "com.waydroid.helper.RECORD_START" -> {
                val dur = intent.getIntExtra("durationSec", 5)
                val fps = intent.getIntExtra("fps", 1).coerceIn(1, 10)
                // Direct screenshot loop — no foreground service needed, just frames every second
                Thread {
                    val svc = ScreenshotService.instance
                    if (svc == null) { Log.e("WaydroidHelperCR", "ScreenshotService not connected for record"); return@Thread }
                    val dir = File(outPath).parentFile ?: File("/sdcard/Android/data/com.waydroid.helper/files")
                    dir.mkdirs()
                    val base = File(outPath).nameWithoutExtension.ifEmpty { "frame" }
                    for (i in 0 until dur * fps) {
                        val frame = File(dir, "${base}_${String.format("%02d", i+1)}.png")
                        val ok = svc.takeScreenshotSync(displayId, frame, 4000)
                        Log.i("WaydroidHelperCR", "record frame $displayId ${frame.name} ok=$ok")
                        Thread.sleep(1000L / fps)
                    }
                    Log.i("WaydroidHelperCR", "record done display $displayId dur $dur fps $fps")
                }.start()
            }
            "com.waydroid.helper.RECORD_STOP" -> { /* no-op for loop */ }
        }
    }
}

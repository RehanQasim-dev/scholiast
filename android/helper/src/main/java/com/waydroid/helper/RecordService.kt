package com.waydroid.helper

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.Service
import android.content.Context
import android.content.Intent
import android.hardware.display.DisplayManager
import android.hardware.display.VirtualDisplay
import android.media.MediaRecorder
import android.media.projection.MediaProjection
import android.media.projection.MediaProjectionManager
import android.os.Build
import android.os.IBinder
import android.util.DisplayMetrics
import android.util.Log
import android.view.WindowManager

object RecordServiceHolder {
    var mediaProjection: MediaProjection? = null
}

class RecordService : Service() {
    private var recorder: MediaRecorder? = null
    private var virtualDisplay: VirtualDisplay? = null
    private var outPath: String? = null

    companion object {
        fun start(ctx: Context, displayId: Int, outPath: String, durationSec: Int) {
            val i = Intent(ctx, RecordService::class.java)
            i.putExtra("displayId", displayId)
            i.putExtra("outPath", outPath)
            i.putExtra("durationSec", durationSec)
            if (Build.VERSION.SDK_INT >= 26) ctx.startForegroundService(i) else ctx.startService(i)
        }
        fun stop(ctx: Context) { ctx.stopService(Intent(ctx, RecordService::class.java)) }
    }

    override fun onCreate() {
        super.onCreate()
        createChannel()
        startForeground(1, Notification.Builder(this, "helper").setContentTitle("Recording").setSmallIcon(android.R.drawable.ic_media_play).build())
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        val displayId = intent?.getIntExtra("displayId", 0) ?: 0
        outPath = intent?.getStringExtra("outPath") ?: "/sdcard/record.mp4"
        val durationSec = intent?.getIntExtra("durationSec", 5) ?: 5
        Log.i("WaydroidHelperRS", "start display $displayId out $outPath dur $durationSec")
        // For Waydroid overlay displays, we can record via MediaProjection if granted.
        // Fallback: repeated screenshots at 1fps stitched on host via ffmpeg (skill does fps=1 sampling).
        // Here we try MediaProjection if available, otherwise just log and use screenshot loop.
        val mp = RecordServiceHolder.mediaProjection
        if (mp == null) {
            Log.w("WaydroidHelperRS", "No MediaProjection token — fallback to screenshot loop. Grant via MainActivity.")
            // Fallback: take screenshots at 1fps for durationSec
            Thread {
                val svc = ScreenshotService.instance
                val dir = outPath!!.substringBeforeLast("/")
                for (i in 0 until durationSec) {
                    val frame = "$dir/frame_${String.format("%02d", i+1)}.png"
                    svc?.takeScreenshotSync(displayId, java.io.File(frame), 3000)
                    Thread.sleep(1000)
                }
                Log.i("WaydroidHelperRS", "screenshot loop done")
                stopSelf()
            }.start()
            return START_NOT_STICKY
        }
        try {
            val display = (getSystemService(DISPLAY_SERVICE) as DisplayManager).getDisplay(displayId)
            val metrics = DisplayMetrics()
            if (Build.VERSION.SDK_INT >= 30) {
                // WindowMetrics is per-window, for display size use Display.getRealMetrics via compat
                @Suppress("DEPRECATION")
                display?.getRealMetrics(metrics)
                if (metrics.widthPixels == 0) {
                    val wm = getSystemService(WINDOW_SERVICE) as WindowManager
                    val bounds = wm.currentWindowMetrics.bounds
                    metrics.widthPixels = bounds.width()
                    metrics.heightPixels = bounds.height()
                    metrics.densityDpi = resources.displayMetrics.densityDpi
                }
            } else {
                @Suppress("DEPRECATION")
                display?.getRealMetrics(metrics)
            }
            recorder = MediaRecorder().apply {
                setVideoSource(MediaRecorder.VideoSource.SURFACE)
                setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
                setVideoEncoder(MediaRecorder.VideoEncoder.H264)
                setVideoSize(metrics.widthPixels, metrics.heightPixels)
                setVideoFrameRate(30)
                setOutputFile(outPath)
                prepare()
            }
            virtualDisplay = mp.createVirtualDisplay(
                "HelperRecord-$displayId", metrics.widthPixels, metrics.heightPixels, metrics.densityDpi,
                DisplayManager.VIRTUAL_DISPLAY_FLAG_AUTO_MIRROR, recorder!!.surface, null, null
            )
            recorder!!.start()
            // Stop after duration
            android.os.Handler(mainLooper).postDelayed({
                try { recorder?.stop(); recorder?.release() } catch (_: Exception) {}
                virtualDisplay?.release()
                stopSelf()
            }, durationSec * 1000L)
        } catch (e: Exception) { Log.e("WaydroidHelperRS", "record failed", e); stopSelf() }
        return START_NOT_STICKY
    }

    private fun createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            val nm = getSystemService(NotificationManager::class.java)
            nm.createNotificationChannel(NotificationChannel("helper", "Helper", NotificationManager.IMPORTANCE_LOW))
        }
    }

    override fun onDestroy() {
        try { recorder?.release() } catch (_: Exception) {}
        virtualDisplay?.release()
        super.onDestroy()
    }

    override fun onBind(intent: Intent?): IBinder? = null
}

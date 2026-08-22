package com.waydroid.helper

import android.accessibilityservice.AccessibilityService
import android.graphics.Bitmap
import android.graphics.PixelFormat
import android.hardware.display.DisplayManager
import android.os.Build
import android.util.Log
import android.view.Display
import android.view.accessibility.AccessibilityEvent
import android.view.accessibility.AccessibilityWindowInfo
import java.io.File
import java.io.FileOutputStream
import java.util.concurrent.CountDownLatch
import java.util.concurrent.TimeUnit

class ScreenshotService : AccessibilityService() {
    companion object {
        var instance: ScreenshotService? = null
        const val TAG = "WaydroidHelperSS"
        // Matches AccessibilityService.ACCESSIBILITY_TAKE_SCREENSHOT_REQUEST_INTERVAL_TIMES_MS
        const val SCREENSHOT_INTERVAL_MS = 1000L
    }

    override fun onServiceConnected() {
        super.onServiceConnected()
        instance = this
        Log.i(TAG, "connected")
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) {}
    override fun onInterrupt() {}

    override fun onUnbind(intent: android.content.Intent?): Boolean {
        instance = null
        return super.onUnbind(intent)
    }

    private val screenshotLock = Any()
    // AccessibilityService rate-limits takeScreenshot to one per ACCESSIBILITY_TAKE_SCREENSHOT_
    // REQUEST_INTERVAL_TIMES_MS (1000ms) process-wide, failing with ERROR_TAKE_SCREENSHOT_
    // INTERVAL_TIME_SHORT (3). Serializing alone is not enough — two agents capturing different
    // displays back to back still trip it — so also wait out the interval and retry on error 3.
    private var lastScreenshotAt = 0L

    fun takeScreenshotSync(displayId: Int, outFile: File, timeoutMs: Long = 5000): Boolean {
        synchronized(screenshotLock) {
            for (attempt in 0 until 3) {
                val since = android.os.SystemClock.uptimeMillis() - lastScreenshotAt
                if (since < SCREENSHOT_INTERVAL_MS) {
                    try { Thread.sleep(SCREENSHOT_INTERVAL_MS - since + 50) } catch (_: InterruptedException) {}
                }
                lastScreenshotAt = android.os.SystemClock.uptimeMillis()
                when (captureOnce(displayId, outFile, timeoutMs)) {
                    CaptureResult.OK -> return true
                    CaptureResult.RETRY -> Log.w(TAG, "screenshot display $displayId rate-limited, retry ${attempt + 1}/3")
                    CaptureResult.FAIL -> return false
                }
            }
            Log.e(TAG, "screenshot display $displayId gave up after 3 attempts")
            return false
        }
    }

    private enum class CaptureResult { OK, RETRY, FAIL }

    private fun captureOnce(displayId: Int, outFile: File, timeoutMs: Long): CaptureResult {
        val latch = CountDownLatch(1)
        var ok = false
        var errorCode = -1
        try {
            (getSystemService(DISPLAY_SERVICE) as DisplayManager).getDisplay(displayId)
                ?: run { Log.e(TAG, "display $displayId not found"); return CaptureResult.FAIL }
            if (Build.VERSION.SDK_INT >= 30) {
                takeScreenshot(displayId, mainExecutor, object : TakeScreenshotCallback {
                    override fun onSuccess(result: ScreenshotResult) {
                        try {
                            val bmp = Bitmap.wrapHardwareBuffer(result.hardwareBuffer, result.colorSpace)
                            if (bmp != null) {
                                val out = Bitmap.createBitmap(bmp)
                                // Try requested path, fallback to app files dir on EACCES/EPERM (scoped storage)
                                var target = outFile
                                try {
                                    FileOutputStream(target).use { outStream ->
                                        out.compress(Bitmap.CompressFormat.PNG, 100, outStream)
                                    }
                                } catch (e: Exception) {
                                    Log.w(TAG, "write to $target failed, fallback to externalFilesDir", e)
                                    val extDir = getExternalFilesDir(null) ?: filesDir
                                    extDir.mkdirs()
                                    target = File(extDir, target.name)
                                    FileOutputStream(target).use { outStream ->
                                        out.compress(Bitmap.CompressFormat.PNG, 100, outStream)
                                    }
                                    Log.i(TAG, "saved fallback to ${target.absolutePath}")
                                    // Also try to copy to original requested path for convenience
                                    try { target.copyTo(outFile, overwrite = true) } catch (_: Exception) {}
                                }
                                bmp.recycle()
                                out.recycle()
                                result.hardwareBuffer.close()
                                ok = true
                            } else Log.e(TAG, "wrapHardwareBuffer null")
                        } catch (e: Exception) { Log.e(TAG, "save failed", e) }
                        latch.countDown()
                    }
                    override fun onFailure(code: Int) {
                        errorCode = code
                        Log.e(TAG, "takeScreenshot failed $code for display $displayId")
                        latch.countDown()
                    }
                })
            } else {
                // Fallback: use DisplayManager path (not implemented)
                Log.e(TAG, "API <30 not supported")
                return CaptureResult.FAIL
            }
            latch.await(timeoutMs, TimeUnit.MILLISECONDS)
        } catch (e: Exception) { Log.e(TAG, "takeScreenshotSync error", e) }
        return when {
            ok -> CaptureResult.OK
            errorCode == ERROR_TAKE_SCREENSHOT_INTERVAL_TIME_SHORT -> CaptureResult.RETRY
            else -> CaptureResult.FAIL
        }
    }

    /**
     * Windows the framework is tracking for [displayId].
     *
     * getWindowsOnAllDisplays() returns SparseArray<List<AccessibilityWindowInfo>> keyed by
     * displayId — NOT a List. Casting it to List silently yields null, and the old fallback to
     * getWindows() only ever returned default-display windows, which is why every dump on a
     * secondary display came back as ids=[0,0]. Read the SparseArray properly and any display the
     * WindowsForAccessibilityObserver tracks is visible here, focused or not.
     *
     * Requires the display to be PUBLIC (VIRTUAL_DISPLAY_FLAG_PUBLIC) — a private/own-content-only
     * virtual display is never registered with accessibility at all. See scripts/VirtualDisplayHelper.java.
     */
    private fun windowsForDisplay(displayId: Int): List<AccessibilityWindowInfo> {
        val all = try {
            windowsOnAllDisplays
        } catch (e: Exception) {
            Log.w(TAG, "getWindowsOnAllDisplays failed", e)
            null
        }
        if (all != null) {
            val ids = (0 until all.size()).map { all.keyAt(it) }
            Log.i(TAG, "windowsOnAllDisplays displays=$ids counts=${ids.map { all.get(it)?.size ?: 0 }}")
            all.get(displayId)?.let { return it }
        }
        // Default display also answers via getWindows(); secondary displays never do.
        return if (displayId == Display.DEFAULT_DISPLAY) (windows ?: emptyList()) else emptyList()
    }

    /**
     * Nudge [displayId] so the framework starts tracking its windows. Only used when the display
     * has no windows yet — normal dumps of an already-tracked display never touch this, so two
     * agents on two displays stay fully parallel.
     */
    private val focusLock = Any()
    private fun tryFocusDisplay(displayId: Int, w: Int, h: Int): Boolean {
        return synchronized(focusLock) {
            try {
                val path = android.graphics.Path().apply {
                    moveTo((w / 2f).coerceAtLeast(1f), (h / 2f).coerceAtLeast(1f))
                }
                val gesture = android.accessibilityservice.GestureDescription.Builder()
                    .setDisplayId(displayId)
                    .addStroke(
                        android.accessibilityservice.GestureDescription.StrokeDescription(path, 0, 50)
                    )
                    .build()
                val latch = CountDownLatch(1)
                var ok = false
                val dispatched = dispatchGesture(
                    gesture,
                    object : GestureResultCallback() {
                        override fun onCompleted(d: android.accessibilityservice.GestureDescription?) {
                            ok = true; latch.countDown()
                        }
                        override fun onCancelled(d: android.accessibilityservice.GestureDescription?) {
                            latch.countDown()
                        }
                    },
                    null
                )
                if (!dispatched) {
                    Log.w(TAG, "dispatchGesture rejected for display $displayId")
                    return@synchronized false
                }
                latch.await(1500, TimeUnit.MILLISECONDS)
                // Give WindowsForAccessibilityObserver time to publish the new window set.
                Thread.sleep(300)
                Log.i(TAG, "focus gesture on display $displayId completed=$ok")
                ok
            } catch (e: Exception) {
                Log.w(TAG, "tryFocusDisplay($displayId) failed", e)
                false
            }
        }
    }

    fun dumpWindows(displayId: Int): String {
        return try {
            val dm = getSystemService(DISPLAY_SERVICE) as DisplayManager
            val display = dm.getDisplay(displayId)
            if (display == null) {
                Log.e(TAG, "display $displayId not found")
                return "<error code=\"no_such_display\">display $displayId does not exist. " +
                    "Known: ${dm.displays.joinToString(",") { it.displayId.toString() }}</error>"
            }
            val metrics = android.util.DisplayMetrics()
            @Suppress("DEPRECATION")
            display.getRealMetrics(metrics)

            var windows = windowsForDisplay(displayId)
            // Nothing tracked yet (display just created, or app not drawn) — nudge it once, then retry.
            if (windows.isEmpty()) {
                Log.w(TAG, "no a11y windows on display $displayId, attempting focus")
                tryFocusDisplay(displayId, metrics.widthPixels, metrics.heightPixels)
                windows = windowsForDisplay(displayId)
            }

            val sb = StringBuilder()
            sb.append("<?xml version='1.0' encoding='UTF-8'?>")
            sb.append("<hierarchy display=\"$displayId\" rotation=\"${display.rotation}\"")
            sb.append(" width=\"${metrics.widthPixels}\" height=\"${metrics.heightPixels}\"")
            sb.append(" windows=\"${windows.size}\">")

            var roots = 0
            for (w in windows) {
                val node = w.root
                sb.append("<window id=\"${w.id}\" type=\"${w.type}\" layer=\"${w.layer}\"")
                sb.append(" title=\"${escapeXml(w.title?.toString() ?: "")}\"")
                sb.append(" focused=\"${w.isFocused}\" active=\"${w.isActive}\"")
                sb.append(" hasRoot=\"${node != null}\">")
                if (node != null) {
                    roots++
                    sb.append(nodeToXml(node, 0, 0))
                    @Suppress("DEPRECATION") node.recycle()
                }
                sb.append("</window>")
            }

            // Last resort: the display is real and tracked but no window exposed a root
            // (can happen mid-transition). Fall back to the active window only if it is ours.
            if (roots == 0) {
                try {
                    val root = rootInActiveWindow
                    if (root != null) {
                        val rootDisplay = root.window?.displayId ?: -1
                        Log.i(TAG, "fallback rootInActiveWindow pkg=${root.packageName} display=$rootDisplay")
                        if (rootDisplay == displayId) {
                            roots++
                            sb.append("<window id=\"-1\" source=\"rootInActiveWindow\" hasRoot=\"true\">")
                            sb.append(nodeToXml(root, 0, 0))
                            sb.append("</window>")
                        }
                        @Suppress("DEPRECATION") root.recycle()
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "rootInActiveWindow fallback failed", e)
                }
            }

            if (roots == 0) {
                sb.append("<error code=\"no_window_content\">display $displayId exists (")
                sb.append("${metrics.widthPixels}x${metrics.heightPixels}, state=${display.state}) and ")
                sb.append("accessibility tracks ${windows.size} window(s), but none exposed a root node. ")
                sb.append("If windows=0 the display is not registered with accessibility — it was ")
                sb.append("probably created private; recreate it with VIRTUAL_DISPLAY_FLAG_PUBLIC ")
                sb.append("(scripts/create-virtual-display.sh). Otherwise no activity has been ")
                sb.append("launched on it yet: am start --display $displayId -n &lt;pkg&gt;/&lt;activity&gt;")
                sb.append("</error>")
            }

            sb.append("</hierarchy>")
            val xml = sb.toString()
            Log.i(TAG, "dump display=$displayId -> ${xml.length} bytes windows=${windows.size} roots=$roots")
            xml
        } catch (e: Exception) { Log.e(TAG, "dump failed", e); "<error>${escapeXml(e.toString())}</error>" }
    }

    private fun escapeXml(s: String): String {
        return s.replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace("\"", "&quot;")
    }

    private fun attr(name: String, value: Any?): String =
        " $name=\"${escapeXml(value?.toString() ?: "")}\""

    private fun nodeToXml(
        node: android.view.accessibility.AccessibilityNodeInfo?,
        index: Int,
        depth: Int
    ): String {
        if (node == null || depth > 60) return ""
        val rect = android.graphics.Rect()
        node.getBoundsInScreen(rect)
        val sb = StringBuilder()
        sb.append("<node")
        sb.append(attr("index", index))
        sb.append(attr("text", node.text))
        sb.append(attr("resource-id", node.viewIdResourceName))
        sb.append(attr("class", node.className))
        sb.append(attr("package", node.packageName))
        sb.append(attr("content-desc", node.contentDescription))
        sb.append(attr("checkable", node.isCheckable))
        sb.append(attr("checked", node.isChecked))
        sb.append(attr("clickable", node.isClickable))
        sb.append(attr("enabled", node.isEnabled))
        sb.append(attr("focusable", node.isFocusable))
        sb.append(attr("focused", node.isFocused))
        sb.append(attr("scrollable", node.isScrollable))
        sb.append(attr("long-clickable", node.isLongClickable))
        sb.append(attr("password", node.isPassword))
        sb.append(attr("selected", node.isSelected))
        sb.append(" bounds=\"[${rect.left},${rect.top}][${rect.right},${rect.bottom}]\">")
        for (i in 0 until node.childCount) {
            val child = node.getChild(i)
            sb.append(nodeToXml(child, i, depth + 1))
            @Suppress("DEPRECATION") child?.recycle()
        }
        return sb.toString() + "</node>"
    }
}

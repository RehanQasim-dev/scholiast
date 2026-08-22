package com.waydroid.helper

import android.app.Activity
import android.content.Intent
import android.media.projection.MediaProjectionManager
import android.os.Bundle
import android.provider.Settings
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast

class MainActivity : Activity() {
    private val REQ_MP = 1001
    private val REQ_ACCESS = 1002

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val layout = LinearLayout(this).apply { orientation = LinearLayout.VERTICAL; setPadding(40,40,40,40) }
        val tv = TextView(this).apply { text = "WaydroidHelper\nEnable Accessibility + Grant MediaProjection for per-display screenshot/record" }
        val btnAcc = Button(this).apply { text = "Enable Accessibility Service"; setOnClickListener {
            startActivity(Intent(Settings.ACTION_ACCESSIBILITY_SETTINGS))
        }}
        val btnMp = Button(this).apply { text = "Grant MediaProjection (for recording)"; setOnClickListener {
            val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            startActivityForResult(mpm.createScreenCaptureIntent(), REQ_MP)
        }}
        val btnTest = Button(this).apply { text = "Test screenshot display 0"; setOnClickListener {
            sendBroadcast(Intent("com.waydroid.helper.SCREENSHOT").apply {
                putExtra("displayId", 0); putExtra("outPath", "/sdcard/helper_test.png")
            })
            Toast.makeText(this@MainActivity, "broadcast sent — check /sdcard/helper_test.png", Toast.LENGTH_SHORT).show()
        }}
        layout.addView(tv); layout.addView(btnAcc); layout.addView(btnMp); layout.addView(btnTest)
        setContentView(layout)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == REQ_MP && resultCode == RESULT_OK && data != null) {
            val mpm = getSystemService(MEDIA_PROJECTION_SERVICE) as MediaProjectionManager
            RecordServiceHolder.mediaProjection = mpm.getMediaProjection(resultCode, data)
            Toast.makeText(this, "MediaProjection granted", Toast.LENGTH_SHORT).show()
        }
    }
}

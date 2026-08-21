---
name: waydroid-inspect
description: Inspect, debug, interact with, and verify Android applications running in Waydroid via ADB. Use when troubleshooting Android app behavior, viewing real-time logcat / Chromium console logs, capturing lossless screenshots for visual inspection, recording short screen clips and sampling keyframes with ffmpeg, dumping and clicking UI elements, sending Intents, and executing the rapid build-install-verify loop.
---

# Waydroid Android Inspection & Debugging

A complete workflow guide for inspecting, debugging, automating, and verifying Android applications running inside **Waydroid** using **ADB (Android Debug Bridge)** and the Linux host toolchain.

---

## 1. Connection & Pre-Flight Check

Always verify the ADB connection to Waydroid before attempting any commands.

### Check Device Status
```bash
adb devices
```

### Handling Connection States

1. **State: `device` (Ready)**:
   ```text
   List of devices attached
   192.168.240.112:5555    device
   ```
   Proceed directly to debugging.

2. **State: `unauthorized`**:
   The Android system inside Waydroid has not accepted the host RSA key yet.
   **Action**: Instruct the user:
   > "Please check your Waydroid window for an Android system prompt: **'Allow USB debugging?'**. Check **'Always allow from this computer'** and tap **'Allow' / 'OK'**."

3. **State: `offline` or Not Listed**:
   - Restart ADB server and reconnect to the Waydroid virtual bridge IP:
     ```bash
     adb kill-server
     adb connect 192.168.240.112:5555
     ```
   - If the IP differs, find the Waydroid IP via:
     ```bash
     ip route | grep waydroid
     ```

---

## 2. Real-Time Diagnostics & Logs (`logcat`)

Android's `logcat` is the primary diagnostic stream for native exceptions, lifecycle transitions, and embedded Chromium WebView console output.

### The Clean Inspection Workflow
Always clear the buffer immediately before triggering an action to avoid reading stale logs:
```bash
# 1. Clear stale logs
adb logcat -c

# 2. Trigger the action / Intent / Tap
adb shell am start -n com.scholiast.android.dev/com.scholiast.android.MainActivity

# 3. Read only the new events
adb logcat -d -s chromium WebConsole ScholiastPlayer AndroidRuntime | tail -n 50
```

### Essential Logcat Filter Commands

| Target | Command |
|---|---|
| **App + WebView + Crashes** | `adb logcat -d -s chromium WebConsole ScholiastPlayer AndroidRuntime` |
| **All JavaScript Console Logs** | `adb logcat -d -s chromium WebConsole \| grep -E "CONSOLE\|Scholiast"` |
| **Fatal Java/Kotlin Crashes** | `adb logcat -d -s AndroidRuntime:E AndroidApp:E` |
| **Recent 100 Log Lines** | `adb logcat -d -t 100` |

### Diagnosing WebViews & JavaScript Bridges
When the app contains a `WebView` (e.g. `assets/player.html`):
- Enable WebContents debugging in Kotlin: `WebView.setWebContentsDebuggingEnabled(true)`.
- Use `console.log('[Tag] ...')` and `console.error('[Tag] ...')` inside JS.
- Chromium logs all JS console output, uncaught errors, network CORS rejections, and DOM promise rejections directly into `logcat` under `I chromium: [INFO:CONSOLE...]`.

---

## 3. Visual UI Inspection via Screenshots

When troubleshooting layout bugs, button alignments, colors, or visual glitches, use lossless PNG screenshots.

### Capture Screenshot
```bash
# Save directly to workspace scratch directory
mkdir -p <workspace>/scratch
adb exec-out screencap -p > <workspace>/scratch/screenshot.png
```

### Inspecting the Screenshot
Use the `view_file` tool on `<workspace>/scratch/screenshot.png` to visually analyze:
- Element placement and text legibility.
- Progress spinners or empty-state banners.
- Active tabs and highlighted items.

---

## 4. UI Hierarchy Dump & Exact Coordinate Calculation

Do not guess tap coordinates. Dump Android's UI Automator accessibility tree to get exact bounding boxes.

### 1. Get Screen Resolution
```bash
adb shell wm size
# Example Output: Physical size: 1920x1048
```

### 2. Dump UI Accessibility Tree
```bash
adb shell uiautomator dump /sdcard/window_dump.xml
adb shell cat /sdcard/window_dump.xml
```

### 3. Extract Element Bounds
Find the target text or content-description:
```bash
adb shell cat /sdcard/window_dump.xml | grep -o 'text="[^"]*"[^>]*bounds="[^"]*"'
```

### 4. Calculate Center Point
Given `bounds="[x1, y1][x2, y2]"`:
$$\text{Target } X = \frac{x1 + x2}{2}, \quad \text{Target } Y = \frac{y1 + y2}{2}$$

*Example*: For `bounds="[1555, 0][1920, 54]"`:
$$\text{Center } X = \frac{1555 + 1920}{2} = 1737, \quad \text{Center } Y = \frac{0 + 54}{2} = 27$$

### 5. Simulate Input Actions
```bash
# Tap
adb shell input tap 1737 27

# Long Press (swipe from/to same point with duration)
adb shell input swipe 1737 27 1737 27 800

# Drag / Swipe (e.g. scroll down)
adb shell input swipe 960 800 960 200 300

# Type text (spaces must be %s or escaped)
adb shell input text "https://www.youtube.com/watch?v=dQw4w9WgXcQ"

# Key Events
adb shell input keyevent 62   # Spacebar (Play/Pause)
adb shell input keyevent 4    # Back button
adb shell input keyevent 66   # Enter
adb shell input keyevent 3    # Home button
```

---

## 5. Motion & Dynamic Inspection (Screen Recording + Keyframe Sampling)

When debugging video playback, animations, transitions, or intermittent glitches, static screenshots are insufficient. Use short video recordings converted into lightweight keyframes.

### Rules for Screen Recording:
1. **Keep it short**: Record a minimum of 4–5 seconds and **at most 10 seconds** to avoid giant files.
2. **Sample at 1 fps**: When inspecting the video, **never** process full 60fps frames. Sample at **1 frame per second** (or 0.5 fps) using `ffmpeg` so the agent can inspect 4 to 10 clean images without context bloat.

### Execution Workflow

```bash
# 1. Record 5 seconds of video
adb shell screenrecord --time-limit 5 /sdcard/debug_clip.mp4

# 2. Pull the MP4 to the host
adb pull /sdcard/debug_clip.mp4 <workspace>/scratch/debug_clip.mp4

# 3. Extract 1 frame per second using ffmpeg
ffmpeg -y -i <workspace>/scratch/debug_clip.mp4 -vf "fps=1" <workspace>/scratch/frame_%02d.png

# 4. (Alternative) Sample 1 frame every 2 seconds (0.5 fps) for longer clips:
ffmpeg -y -i <workspace>/scratch/debug_clip.mp4 -vf "fps=0.5" <workspace>/scratch/frame_%02d.png
```

### Inspecting Extracted Frames
Use `view_file` sequentially on `<workspace>/scratch/frame_01.png`, `frame_02.png`, etc., to trace:
- Did the video progress (timestamp change / progress slider move)?
- Did the animation complete smoothly?
- Did an overlay dismiss as expected?

---

## 6. System Intents & App Lifecycle

Simulate real user actions such as sharing links or deep-linking without touching the UI:

```bash
# Launch app directly
adb shell am start -n com.scholiast.android.dev/com.scholiast.android.MainActivity

# Send text / URL via ACTION_SEND (Simulate share from YouTube / Browser)
adb shell am start -a android.intent.action.SEND \
    -t text/plain \
    -e android.intent.extra.TEXT "https://www.youtube.com/watch?v=M7lc1UVf-VE" \
    -n com.scholiast.android.dev/com.scholiast.android.MainActivity

# Force stop the app process
adb shell am force-stop com.scholiast.android.dev
```

---

## 7. The Rapid Build-Install-Verify Loop

When fixing bugs in the Android codebase, follow this strict, non-blocking iteration cycle:

```
[1. Diagnose] ---> [2. Edit Code] ---> [3. Build Dev APK] ---> [4. Install Waydroid] ---> [5. Launch & Verify]
  (logs/frames)                          (assembleDevDebug)        (waydroid app install)       (logcat/screencap)
```

### Fast Terminal Recipe
```bash
# 1. Compile development build
JAVA_HOME=/usr/lib/jvm/java-21-openjdk-amd64 ./gradlew assembleDevDebug

# 2. Auto-install into Waydroid
waydroid app install app/build/outputs/apk/dev/debug/app-dev-debug.apk

# 3. Clear logs & launch target intent
adb logcat -c
adb shell am start -a android.intent.action.SEND \
    -t text/plain \
    -e android.intent.extra.TEXT "https://www.youtube.com/watch?v=M7lc1UVf-VE" \
    -n com.scholiast.android.dev/com.scholiast.android.MainActivity

# 4. Verify in logcat and capture screenshot
adb logcat -d -s chromium WebConsole ScholiastPlayer | grep -E "Scholiast|CONSOLE"
adb exec-out screencap -p > <workspace>/scratch/verify.png
```

## 11. Scholiast Tauri Mobile, Tablet & Desktop Architecture (`scholiast_tauri`)

The standalone cross-platform application (Android, iOS, macOS, Linux, Windows) engineered in Rust + Tauri v2 + React 18 + Tailwind.

### 11.1 Navigation & Information Architecture
- **Primary Navigation**: `Home` (`/home`), `Library` (`/library`), and `Settings` (`/settings`) in `Sidebar.tsx` (tablet/desktop) and `BottomTabs.tsx` (mobile). Study sessions (`/player`, `/reader`, `/frame`) operate in distraction-free full-screen views without persistent tab bars.
- **Back Navigation**: On Android/iOS touch devices, system edge-swipes pop history natively via `MainActivity.kt` (`handleBackNavigation = true`). On desktop, explicit on-screen back chevrons provide mouse navigation.
- **Home Screen (`Home.tsx`)**:
  - Top search & paste bar for launching YouTube URLs or web links.
  - Minimal `CloudSyncIndicator` in the header replaces the bulky sync card.
  - **Unified Chronological Recents Feed**: Merges both recent YouTube videos and saved web articles into a single stream sorted strictly newest-first (`updatedAt DESC`), badged with creator/domain, progress, and note/highlight counts.

### 11.2 The Unified Library Hub (`Library.tsx` & `CollectionDetail.tsx`)
- **Unified Overview (`/library`)**: Single glanceable view containing two sections:
  1. **YouTube Channels**: Displays channel cards with avatars and **only video counts** (`X videos`), omitting note clutter from the header.
  2. **Websites**: Displays domain cards with site icons and **only article counts** (`X articles`).
- **Channel Name Resolution (`channelStore.ts`)**: Automatically resolves YouTube channel/author names using YouTube's free public oEmbed endpoint, cached in local storage without requiring API keys.
- **Dedicated Collection View (`/library/:type/:id`)**: Tapping any channel or domain opens its dedicated collection page with `Back to Library`, displaying all videos from that creator (with thumbnails, resume timestamps, and note badges `📝 X notes`) or all articles from that domain (with highlight counts `📑 X highlights`). Tapping opens directly into `/player` or `/reader`.

### 11.3 Mandatory Release Target Architectures (ONLY THESE 4)
In any release or distribution build for the application, **always compile ONLY these 4 targets**:
1. **`arm64-v8a`** (ARMv8 64-bit Android APK, target `aarch64-linux-android`): For modern Android phones and tablets (Google Pixel 6 Pro, Samsung Galaxy Tab S7+, etc.).
2. **`armeabi-v7a`** (ARMv7 32-bit Android APK, target `armv7-linux-androideabi`): For legacy 32-bit ARM Android devices.
3. **`x86_64`** (x86 64-bit Android APK, target `x86_64-linux-android`): For Waydroid containers and Android emulators.
4. **`.deb`** (x86_64 Linux desktop package, target `x86_64-unknown-linux-gnu`): For Linux laptops and desktop PCs.

### 11.4 Whisper STT Compilation & Hardware Acceleration
- **`-O3` Compiler Optimization**: Whisper C/C++ matrix code is built via `whisper-rs-sys` using CMake in `Release` mode (`-O3 -DNDEBUG`). Additionally, `scholiast_tauri/Cargo.toml` specifies `[profile.dev.package.whisper-rs]` and `[profile.dev.package.whisper-rs-sys]` at `opt-level = 3` so debug/development runs are never penalized with unoptimized matrix loops.
- **Hardware Acceleration Units**:
  - **ARMv8 / Android (Pixel 6 Pro, Galaxy Tab S7+)**: ARM NEON SIMD vectorization is mandatory and enabled by default on `arm64-v8a`. FP16 half-precision tensor arithmetic is active on ARMv8.2-A architectures (Cortex-X1, Kryo 585).
  - **x86_64 (Linux Laptop & Desktop)**: High-throughput AVX, AVX2, FMA, and F16C vector extensions are compiled for Intel/AMD CPUs.

### 11.5 Shipped Touch, Voice, Cloud & Drawing Features
- **Cloud Backup Centered Modal & Background Scheduler**:
  - Tapping the `[ ☁️ ]` cloud icon when Google Drive is unconfigured triggers a centered glassmorphic setup modal (`CloudSyncModal.tsx`) with 1-tap OAuth and automated backup preference switches.
  - Background scheduler (`useAutoSyncScheduler.ts`) checks for dirty highlights and drawings on a 5-minute periodic interval, upon exiting any study session (`/player` or `/reader`), and when the app is minimized (`document.visibilityState === 'hidden'`).
- **Dynamic Aura Voice Pill & Highlight Selection Swatch**:
  - Swatch popup features exactly 3 extension highlight colors (`yellow` `#d29600`, `red` `#dc3c5a`, `green` `#2da05f`) and 3 custom SVG actions: Text Comment (`CommentTextIcon`), Voice Note (`CommentMicIcon`), and Excalidraw Diagram (`ShapesDiagramIcon`).
  - Tapping Voice Note launches the `DynamicAuraPill.tsx`: 4 vertical glowing green frequency bars bounce to live voice amplitude via Web Audio API (`AnalyserNode`), 2.0s silence VAD auto-commits without confirmation dialog, transcribes at `-O3`, and saves directly to SQLite with a 2-second Undo toast.
- **Reader Display Themes**:
  - Reader top bar formatting popover (`ReaderTopBar.tsx`) provides 4 instant themes: OLED Pitch Black (`#000000`), Warm Sepia Paper (`#1c1815`), Soft Slate Navy (`#0f172a`), and Clean Light Paper (`#fbfbfa`), saved in `reader.theme` preferences.
- **Dedicated Excalidraw & Stylus Settings**:
  - Embedded inside `Settings.tsx` (`ExcalidrawSettingsSection.tsx`) exposing stroke roughness (Architect/Artist/Cartoonist), S-Pen & stylus pressure sensitivity curves (Linear/Soft/Firm), background grid styles (Blank/Dots/Crosshatch), and high-DPI export resolution (1x/2x Retina/3x).




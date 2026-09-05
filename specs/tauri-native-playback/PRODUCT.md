# Product Spec: Tauri Native YouTube Playback

## Summary

Replace the YouTube iframe embed with first-party native playback: the app
resolves stream URLs itself (InnerTube, same engine concept as NewPipe /
youtubei.js) and plays them in a plain `<video>` element. No YouTube chrome
ever renders — no title bar, channel avatar, watermark, endscreens, related
videos, or "Watch on YouTube" links — on desktop, tablet, or phone. Proven by
spike (`/tmp/opencode/yt-spike/spike.mjs`): VISIONOS streams + captions byte
verified 2026-09-05.

## Behavior

1. **Zero YouTube chrome**: playing, paused, buffering, or ended, the stage
   shows only video pixels plus the app's own Chrome (controls, title bar,
   shields). No avatar, title, watermark, endscreen grid, or related videos.
2. **Instant start, HD when available**: playback begins on the muxed
   progressive stream where offered; HD (separate audio+video) engages via the
   app's adaptive engine without restarting the session.
3. **Captions in sync**: caption tracks listed from the same response render
   as native `<track>` cues; the transcript panel keeps highlighting the
   active cue from the existing transcript pipeline.
4. **Today's controls keep working**: play/pause, seek bar, arrow-key step
   seeks (`playback.seek_step`), speed, volume, fullscreen, resume-at,
   sleep-timer behavior — all unchanged from the user's perspective.
5. **Study flows keep working**: timestamped notes, voice notes, frame
   capture, diagrams, transcript tap-to-seek — all unchanged.
6. **Honest failure states**: private / paid / region-blocked / login-gated /
   DRM content surfaces a specific message naming the cause, never a spinner
   or generic error. Age-restricted plays anonymously (VISIONOS bypass).
7. **Live & upcoming**: upcoming videos show the scheduled state with no
   player; live plays through the HLS manifest; ended live (DVR) seeks.
8. **Graceful fallback**: if extraction fails (cipher rotation, unknown itag,
   network), the session automatically falls back to the legacy iframe
   (with shields) and reports the failure class for triage — playback is
   never a dead stage.
9. **Fresh URLs per session**: stream URLs are resolved at play time and never
   persisted; a stale/expired URL re-resolves transparently on retry.
10. **Offline**: unchanged — streaming requires connectivity; saved notes,
    frames, and transcripts remain available offline as today.

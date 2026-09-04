# Product Spec: Tauri Voice Notes & Speech-to-Text

## Summary
Voice-first note capture featuring the real-time Dynamic Aura visualizer, silence Voice Activity Detection (VAD), local hardware-accelerated Whisper STT, and cloud AI voice editing.

## Behavior

1. **Tapping the voice icon triggers the Dynamic Aura Pill**: 4 vertical glowing purple frequency bars bounce in real time to live microphone amplitude.
2. **Voice Activity Detection (VAD)** monitors speech; detecting 2.0 seconds of silence (or a manual tap) terminates recording automatically without dialog prompts.
3. **Transcriptions execute locally via `-O3` compiled Whisper STT** or via configured cloud providers (Groq/Gemini), committing directly to SQLite upon completion.
4. **Upon saving a voice note**, a 2-second non-blocking toast displays: `Saved: "[transcribed text]..." [ Undo ]`.
5. **When Gemini is configured**, users can use speech-directed voice edits to revise existing notes.

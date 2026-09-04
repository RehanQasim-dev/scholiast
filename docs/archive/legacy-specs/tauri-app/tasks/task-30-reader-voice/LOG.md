# LOG — task-30 reader voice

## 2026-08-24 — IN PROGRESS

Read: plan §6.5/§6.11, task-09 `useVoiceRecorder`, `MicButton`, task-07
`CommentEditorSheet` (dead `onVoiceDraft` mic slot at L398 — never supplied by any
caller today), task-10 `VoiceEditSheet` (+ its `toErrorInfo` dual-shape error
convention), Rust STT commands (`stt_transcribe {wavPath, language}`,
`stt_edit_text {wavPath, original, promptOverride}`, `stt_local_transcribe
{wavPath, language, modelPath}`, `list_stt_models → {models:[{installed,id,…}]}`
plain Result — raw rejection, NOT enveloped), `get_secret_status {name} →
{configured}`, prefs facade (`prompt.edit_comment`, `speech.language`,
`stt.local_model`).

Plan: new owned file `src/voice/useVoiceComment.ts` exporting `useVoiceComment()`
(wraps `useVoiceRecorder` + transcribe routing + offline/local-model gating,
cached probes) and `useVoiceEdit()` (task-31 helper). Minimal additive wiring in
`CommentEditorSheet` replacing the dead `<MicButton>` slot with a hook-driven
fixed-height mic cluster (elapsed beside the button → no layout shift). No
ThreadPanel exists yet (task-31 wave-sibling); ReaderVoiceBar not needed this
task — the hook is the handoff surface.

## 2026-08-24 — DONE

### Files
- `src/voice/useVoiceComment.ts` (NEW, owned) — `useVoiceComment()` + `useVoiceEdit()`
  + availability probe + `formatElapsedMs` + `resetVoiceAvailabilityForTests`.
- `src/voice/useVoiceComment.test.tsx` (NEW, owned) — 7 hook tests.
- `src/components/CommentEditorSheet.tsx` (additive wiring) — dead `<MicButton>`
  slot replaced by a hook-driven mic cluster; Esc-cancels-recording; insert-at-caret;
  footer spinner. No other component files touched.
- `src/components/CommentEditorSheet.test.tsx` (additive) — 5 new tests (8 total).

### Gates (from scholiast_tauri/)
- `pnpm typecheck` ✅ · `pnpm lint` ✅ · `pnpm vitest run` ✅ 30 files / 206 tests.
  (One transient ThreadPanel.tsx unused-var failure observed mid-run — task-31's file,
  attributed + untouched; sibling fixed it while this task ran.)

### Hook API for task-31 (ThreadPanel)
Add-flow reply/composer inputs:
```ts
import { useVoiceComment, formatElapsedMs } from "../voice/useVoiceComment";
const voice = useVoiceComment({ kind: "add", enabled: Boolean(showMic) });
// voice.state: "idle" | "recording" | "transcribing" | "error"
// voice.disabledReason: string | null → render mic disabled with this hint text
// voice.elapsedMs / formatElapsedMs(voice.elapsedMs) → elapsed label (beside the button,
//   inside a FIXED-height row so recording never shifts panel layout)
// await voice.start()          // throws if disabledReason set
// const text = await voice.stop()  // resolves transcribed draft; rejects w/ message
// await voice.cancel()         // Esc path; restores prior text trivially (never touches input)
```
Edit-existing-comment flow (plan §6.5.3, Gemini-only):
```ts
import { useVoiceEdit } from "../voice/useVoiceComment";
const edit = useVoiceEdit();
<VoiceEditSheet original={note} initialPrompt={edit.initialPrompt}
  micDisabledReason={edit.micDisabledReason}   // "Needs internet" | "Set up Gemini in Settings"
  onAccept={(t) => save(edit.stampEdited(t))}  // stamps <!--edited:N--> (task-08 parses it)
  onDiscard={...} />
```
Error toasts: provider-agnostic `Speech failed: <message>` via `toast()` (task-10 convention).

### Behavior notes / deviations
1. **ReaderVoiceBar.tsx not created** — not needed: the sheet covers inline capture and
   ThreadPanel should consume the hook directly (above). Less surface, same capability.
2. **MicButton reused visually but not structurally**: MicButton owns its own
   `useVoiceRecorder` instance and exposes no external start/stop control, so driving it
   externally was impossible without editing it (forbidden). The sheet renders an identical
   48px mic (same classes/icons/spinner); MicButton itself remains for VoiceEditSheet.
3. **pausePlayer option is a typed no-op** — verified task-09's recorder has NO player
   coupling at all, so reader passes nothing and nothing pauses. Option documented in-code
   for future video-context callers.
4. Offline gating implements plan §6.11 + §6.5.2 fully: offline & no installed local model →
   "Needs internet"; online but neither Groq nor Gemini key → "Set up speech in Settings";
   offline WITH an installed model routes `stt_local_transcribe` (language pref, modelPath
   from `stt.local_model` or Rust's first-installed fallback). Probes (`list_stt_models`,
   `get_secret_status`) are session-cached module-level per the spec's "cache result".
5. Esc while recording cancels the recording (stays open, draft intact); second Esc still
   runs the existing keep/discard flow — matches §6.5.1 "Esc cancels".
6. Acceptance criterion "record→draft insertion in thread box; cancel restores prior text":
   covered by sheet tests (insertion at caret with prior text preserved; Esc-cancel keeps
   draft). The THREAD box itself is task-31's surface — the hook API above is the seam.
7. **Manual gate NOT executed** ("speak a comment offline via local model end-to-end"):
   requires a built desktop app with a real microphone; cannot run in this environment.
   Left as a human verification step — code path is unit-covered (offline+local routing test).

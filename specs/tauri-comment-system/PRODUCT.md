# Product Spec: Tauri Comment Editor & Rendering

## Summary
Non-intrusive floating comment composer and bottom sheet with markdown formatting, `#tag` autocomplete, and side-by-side voice/keyboard trigger.

## Behavior

1. **Authoring a note captures the exact current timestamp** and opens a lightweight composer with markdown support (bold, italic, code, bullets) and `#tag` autocomplete.
2. **Typing comments never triggers full-screen modal takeovers**; composers remain non-intrusive floating cards or bottom sheets.
3. **Both voice (`[mic]`) and keyboard (`[keyboard]`) input buttons sit side-by-side**; on desktop/tablets, keyboard focus does not obscure the video viewport.
4. **Anti-nesting flat card hierarchy**: Comment threads strictly adhere to a maximum 2-layer hierarchy (`bg-base` canvas -> `bg-surface` card) with zero card-inside-card nesting.
5. **Clean iconography**: Type indicators and actions utilize understated SVG vector icons rather than raw emojis (`📝`, `🎞`, `🖍`).
6. **Non-blocking dismissal**: Tapping outside or pressing Escape cleanly closes draft composers without blocking multi-step confirmation dialogs.

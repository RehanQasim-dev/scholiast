# Technical Spec: Tauri Android Architecture

## Context
Platform adaptations and packaging configurations targeting Android devices and Waydroid emulation.

Key files:
- `scholiast_tauri/src-tauri/gen/android/` @ fed294b
- `scholiast_tauri/src/App.tsx` @ fed294b

## Proposed Changes & Module Seams
- **Safe Area Insets**: Status bar padding and virtual keyboard event handlers.
- **Responsive Layout**: Breakpoint checks switching between desktop sidebar and mobile bottom navigation.
- **Packaging Pipeline**: Gradle scripts and release APK signing configurations.

## Testing and Validation
- **Test 1 (Responsive breakpoint layout tests)**: Validates Behavior Invariant 1.
- **Test 2 (Status bar safe area insets)**: Validates Behavior Invariant 2.
- **Test 3 (Android 4 mandatory target builds & exclusion check)**: Validates Behavior Invariants 3, 4.
- **Test 4 (Native Android onBackPressedDispatcher integration)**: Validates Behavior Invariant 5.

## Execution Slicing (Batches)
- Batch 1: Task 01 (Scaffold), Task 02 (Platform services), Task 03 (Mobile UI adaptation).

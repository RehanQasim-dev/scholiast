import { load, type Store } from "@tauri-apps/plugin-store";

/**
 * Typed facade over the settings store.
 *
 * The file name and dotted key names mirror the Rust side exactly
 * (`app.store("settings.json")` + the `PREF_*` consts in `stt/cloud.rs`) so
 * both sides read/write the same records. Values persist via the plugin; no
 * change events are emitted from here.
 */

export const SETTINGS_FILE = "settings.json";

export const PREF_KEYS = {
  groqModel: "stt.groq_model",
  geminiModel: "stt.gemini_model",
  addCommentPrompt: "prompt.add_comment",
  editCommentPrompt: "prompt.edit_comment",
  speechLanguage: "speech.language",
  localModel: "stt.local_model",
  defaultSpeed: "playback.default_speed",
  seekStep: "playback.seek_step",
  density: "appearance.density",
  readerFontStep: "reader.font_step",
  readerSerif: "reader.serif",
  readerColumnWidth: "reader.column_width",
} as const;

export const PREF_DEFAULTS = {
  [PREF_KEYS.groqModel]: "whisper-large-v3-turbo",
  [PREF_KEYS.geminiModel]: "gemini-flash-latest",
  [PREF_KEYS.speechLanguage]: "en",
  [PREF_KEYS.defaultSpeed]: 1,
  [PREF_KEYS.seekStep]: 10,
  [PREF_KEYS.density]: "comfortable",
  [PREF_KEYS.readerColumnWidth]: 736,
} as Record<string, string | number>;

type StoreLoader = () => Promise<Store>;

let loader: StoreLoader = () => load(SETTINGS_FILE, { autoSave: false });
let storePromise: Promise<Store> | null = null;

function openStore(): Promise<Store> {
  if (!storePromise) storePromise = loader();
  return storePromise;
}

/** Test seam: swap the backing store and drop any cached instance. */
export function setPrefsStoreForTests(
  backend: {
    get: (key: string) => Promise<unknown>;
    set: (key: string, value: unknown) => Promise<void>;
  },
) {
  loader = () => Promise.resolve(backend as unknown as Store);
  storePromise = null;
}

export async function getPref<T>(key: string, fallback: T): Promise<T> {
  const value = await openStore().then((store) => store.get<T>(key));
  return value ?? fallback;
}

export async function setPref(
  key: string,
  value: string | number | boolean,
): Promise<void> {
  await openStore().then((store) => store.set(key, value));
}

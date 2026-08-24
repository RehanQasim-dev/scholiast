import { beforeEach, describe, expect, test } from "vitest";
import {
  PREF_DEFAULTS,
  PREF_KEYS,
  getPref,
  setPref,
  setPrefsStoreForTests,
} from "./store";

interface FakeStore {
  data: Map<string, unknown>;
}

function fakeStore(): FakeStore & {
  get: <T>(key: string) => Promise<T | undefined>;
  set: (key: string, value: unknown) => Promise<void>;
} {
  const data = new Map<string, unknown>();
  return {
    data,
    get: async <T,>(key: string) =>
      data.has(key) ? (data.get(key) as T) : undefined,
    set: async (key: string, value: unknown) => {
      data.set(key, value);
    },
  };
}

describe("prefs facade", () => {
  let store: ReturnType<typeof fakeStore>;

  beforeEach(() => {
    store = fakeStore();
    setPrefsStoreForTests(store);
  });

  test("get returns the fallback when the key is unset", async () => {
    await expect(
      getPref(PREF_KEYS.groqModel, "fallback-model"),
    ).resolves.toBe("fallback-model");
  });

  test("get falls back to the shared defaults table", async () => {
    expect(PREF_DEFAULTS[PREF_KEYS.speechLanguage]).toBe("en");
    expect(PREF_DEFAULTS[PREF_KEYS.seekStep]).toBe(10);
  });

  test("set writes through and get reads it back under the dotted key", async () => {
    await setPref(PREF_KEYS.addCommentPrompt, "custom prompt");
    expect(store.data.get("prompt.add_comment")).toBe("custom prompt");
    await expect(getPref("prompt.add_comment", "default")).resolves.toBe(
      "custom prompt",
    );
  });

  test("set overwrites a previous value", async () => {
    await setPref(PREF_KEYS.defaultSpeed, 1.5);
    await setPref(PREF_KEYS.defaultSpeed, 2);
    await expect(getPref(PREF_KEYS.defaultSpeed, 1)).resolves.toBe(2);
  });
});

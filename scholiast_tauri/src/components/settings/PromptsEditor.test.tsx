import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, test, vi } from "vitest";
import PromptsEditor from "./PromptsEditor";
import { PREF_KEYS, setPrefsStoreForTests } from "../../lib/store";

const DEFAULTS = {
  addComment: "add default",
  editComment: "edit default",
};

function backend() {
  const data = new Map<string, string>();
  return {
    data,
    get: async (key: string) => data.get(key),
    set: async (key: string, value: unknown) => {
      data.set(key, String(value));
    },
  };
}

describe("PromptsEditor", () => {
  let store: ReturnType<typeof backend>;

  beforeEach(() => {
    vi.clearAllMocks();
    store = backend();
    setPrefsStoreForTests(store);
  });

  test("editing a prompt persists it under its dotted pref key", async () => {
    render(<PromptsEditor fetchDefaults={async () => DEFAULTS} />);
    const addBox = await screen.findByTestId("prompt-add-comment");
    expect(addBox).toHaveValue("");

    fireEvent.change(addBox, { target: { value: "my custom add prompt" } });

    await waitFor(() =>
      expect(store.data.get(PREF_KEYS.addCommentPrompt)).toBe(
        "my custom add prompt",
      ),
    );
  });

  test("restore default loads the Rust default and saves it", async () => {
    const fetchDefaults = vi.fn(async () => DEFAULTS);
    render(<PromptsEditor fetchDefaults={fetchDefaults} />);

    fireEvent.click(await screen.findByTestId("restore-edit-comment"));

    const editBox = screen.getByTestId("prompt-edit-comment");
    await waitFor(() => expect(editBox).toHaveValue("edit default"));
    await waitFor(() =>
      expect(store.data.get(PREF_KEYS.editCommentPrompt)).toBe(
        "edit default",
      ),
    );
    expect(fetchDefaults).toHaveBeenCalledOnce();
  });
});

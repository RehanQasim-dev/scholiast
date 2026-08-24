import { useEffect, useState } from "react";
import { invokeCommand } from "../../lib/ipc";
import { PREF_KEYS, getPref, setPref } from "../../lib/store";

interface PromptDefaults {
  addComment: string;
  editComment: string;
}

interface PromptsEditorProps {
  /** Injectable for tests; defaults to the real IPC command. */
  fetchDefaults?: () => Promise<PromptDefaults>;
}

export default function PromptsEditor({ fetchDefaults }: PromptsEditorProps) {
  const loadDefaults =
    fetchDefaults ??
    (() => invokeCommand<PromptDefaults>("get_prompt_defaults"));

  const [addPrompt, setAddPrompt] = useState("");
  const [editPrompt, setEditPrompt] = useState("");
  const [restoring, setRestoring] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      getPref(PREF_KEYS.addCommentPrompt, ""),
      getPref(PREF_KEYS.editCommentPrompt, ""),
    ])
      .then(([add, edit]) => {
        if (!cancelled) {
          setAddPrompt(add);
          setEditPrompt(edit);
        }
      })
      .catch(() => {
        if (!cancelled) setLoadFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function restore(which: "add" | "edit") {
    setRestoring(true);
    try {
      const defaults = await loadDefaults();
      const value =
        which === "add"
          ? (defaults.addComment ?? "")
          : (defaults.editComment ?? "");
      if (which === "add") {
        setAddPrompt(value);
        await setPref(PREF_KEYS.addCommentPrompt, value);
      } else {
        setEditPrompt(value);
        await setPref(PREF_KEYS.editCommentPrompt, value);
      }
    } finally {
      setRestoring(false);
    }
  }

  async function save(which: "add" | "edit", value: string) {
    if (which === "add") {
      setAddPrompt(value);
      await setPref(PREF_KEYS.addCommentPrompt, value);
    } else {
      setEditPrompt(value);
      await setPref(PREF_KEYS.editCommentPrompt, value);
    }
  }

  if (loadFailed) {
    return (
      <p className="text-sm text-text-2">Prompts could not be loaded.</p>
    );
  }

  return (
    <div className="space-y-4">
      <label className="block text-sm">
        Add-comment prompt
        <textarea
          data-testid="prompt-add-comment"
          rows={3}
          value={addPrompt}
          onChange={(event) => void save("add", event.target.value)}
          disabled={restoring}
          className="mt-1 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void restore("add")}
          disabled={restoring}
          data-testid="restore-add-comment"
          className="mt-1 rounded-sm border border-hairline px-2 py-1 text-xs text-text-2 hover:text-text disabled:opacity-50"
        >
          Restore default
        </button>
      </label>

      <label className="block text-sm">
        Edit-comment prompt
        <textarea
          data-testid="prompt-edit-comment"
          rows={3}
          value={editPrompt}
          onChange={(event) => void save("edit", event.target.value)}
          disabled={restoring}
          className="mt-1 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={() => void restore("edit")}
          disabled={restoring}
          data-testid="restore-edit-comment"
          className="mt-1 rounded-sm border border-hairline px-2 py-1 text-xs text-text-2 hover:text-text disabled:opacity-50"
        >
          Restore default
        </button>
      </label>
    </div>
  );
}

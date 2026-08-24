import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { IpcCommandError, invokeCommand } from "../../lib/ipc";
import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { usePref } from "./usePref";

interface SecretStatus {
  configured: boolean;
}

interface TestResult {
  ok: boolean;
  detail: string;
}

interface TestOutcome {
  ok: boolean | "error";
  detail: string;
}

const LANGUAGES: Array<[string, string]> = [
  ["en", "English"],
  ["de", "German"],
  ["fr", "French"],
  ["es", "Spanish"],
  ["it", "Italian"],
  ["pt", "Portuguese"],
  ["ru", "Russian"],
  ["ja", "Japanese"],
  ["ko", "Korean"],
  ["zh", "Chinese"],
  ["hi", "Hindi"],
  ["ar", "Arabic"],
];

interface ProviderRowProps {
  name: string;
  label: string;
  testCommand: string;
}

function ProviderRow({ name, label, testCommand }: ProviderRowProps) {
  const queryClient = useQueryClient();
  const status = useQuery({
    queryKey: ["secret", name],
    queryFn: () => invokeCommand<SecretStatus>("get_secret_status", { name }),
    retry: false,
  });
  const [value, setValue] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [test, setTest] = useState<TestOutcome | null>(null);
  const [testing, setTesting] = useState(false);

  async function save() {
    if (!value.trim()) return;
    setSaving(true);
    setSaveError(null);
    try {
      await invokeCommand("set_secret", { name, value: value.trim() });
      setValue("");
      await queryClient.invalidateQueries({ queryKey: ["secret", name] });
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function runTest() {
    setTesting(true);
    setTest(null);
    try {
      const result = await invokeCommand<TestResult>(testCommand);
      setTest({ ok: result.ok, detail: result.detail });
    } catch (err) {
      setTest({
        ok: "error",
        detail:
          err instanceof IpcCommandError
            ? err.message
            : "Test could not be run.",
      });
    } finally {
      setTesting(false);
    }
  }

  return (
    <div className="rounded-sm border border-hairline bg-elevated p-3">
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium">{label} API key</h4>
        <span
          data-testid={`${name}-key-status`}
          className={
            status.data?.configured
              ? "text-xs text-[var(--sc-accent)]"
              : "text-xs text-text-2"
          }
        >
          {status.data?.configured ? "configured ✓" : "not set"}
        </span>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <input
          type="password"
          value={value}
          placeholder={status.data?.configured ? "Replace key…" : "Paste key…"}
          onChange={(event) => setValue(event.target.value)}
          className="min-w-0 flex-1 rounded-sm border border-hairline bg-surface px-2 py-1.5 text-sm"
        />
        <button
          type="button"
          onClick={save}
          disabled={saving || !value.trim()}
          className="rounded-sm bg-accent px-3 py-1.5 text-sm font-medium text-black disabled:opacity-50"
        >
          {saving ? "Saving…" : "Save"}
        </button>
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="rounded-sm border border-hairline px-3 py-1.5 text-sm text-text-2 hover:text-text disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test"}
        </button>
      </div>
      {saveError && (
        <p role="alert" className="mt-2 text-xs text-[var(--sc-danger)]">
          {saveError}
        </p>
      )}
      {test && (
        <p
          data-testid={`${name}-test-result`}
          className={`mt-2 text-xs ${test.ok === true ? "text-[var(--sc-accent)]" : "text-[var(--sc-danger)]"}`}
          role="status"
        >
          {test.ok === true ? "✓ " : test.ok === false ? "✗ " : ""}
          {test.detail}
        </p>
      )}
    </div>
  );
}

export default function SpeechSection() {
  const [groqModel, setGroqModel] = usePref(PREF_KEYS.groqModel, String(PREF_DEFAULTS[PREF_KEYS.groqModel]));
  const [geminiModel, setGeminiModel] = usePref(PREF_KEYS.geminiModel, String(PREF_DEFAULTS[PREF_KEYS.geminiModel]));
  const [language, setLanguage] = usePref(PREF_KEYS.speechLanguage, String(PREF_DEFAULTS[PREF_KEYS.speechLanguage]));

  return (
    <section aria-label="Speech" className="space-y-3">
      <ProviderRow name="groq" label="Groq" testCommand="stt_test_groq" />
      <ProviderRow name="gemini" label="Gemini" testCommand="stt_test_gemini" />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm">
          Groq model id
          <input
            value={groqModel}
            onChange={(event) => setGroqModel(event.target.value)}
            data-testid="pref-stt.groq_model"
            className="mt-1 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="block text-sm">
          Gemini model id
          <input
            value={geminiModel}
            onChange={(event) => setGeminiModel(event.target.value)}
            data-testid="pref-stt.gemini_model"
            className="mt-1 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5 font-mono text-xs"
          />
        </label>
        <label className="block text-sm">
          Speech language
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            data-testid="pref-speech.language"
            className="mt-1 w-full rounded-sm border border-hairline bg-surface px-2 py-1.5"
          >
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </section>
  );
}

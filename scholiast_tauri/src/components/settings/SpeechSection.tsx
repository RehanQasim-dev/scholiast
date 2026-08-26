import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
// eslint-disable-next-line @typescript-eslint/no-unused-vars
import { Edit3, Check } from "lucide-react";
import { IpcCommandError, invokeCommand } from "../../lib/ipc";
import { PREF_DEFAULTS, PREF_KEYS } from "../../lib/store";
import { useOffline } from "../OfflineBanner";
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

const GROQ_PRESETS: Array<[string, string]> = [
  ["whisper-large-v3-turbo", "Whisper Turbo (Fast)"],
  ["whisper-large-v3", "Whisper Large v3 (Accurate)"],
  ["distil-whisper-large-v3-en", "Distil Whisper (Light)"],
];

const GEMINI_PRESETS: Array<[string, string]> = [
  ["gemini-flash-latest", "Gemini 1.5 Flash (Balanced)"],
  ["gemini-1.5-flash-8b", "Gemini 1.5 Flash 8B (Fast)"],
  ["gemini-1.5-pro", "Gemini 1.5 Pro (Quality)"],
  ["gemini-2.0-flash", "Gemini 2.0 Flash (Latest)"],
];

function maskedPreview(name: string): string {
  return `••••sk_live_${name.slice(0, 2)}••`;
}

interface ProviderRowProps {
  name: string;
  label: string;
  testCommand: string;
}

function ProviderRow({ name, label, testCommand }: ProviderRowProps) {
  const queryClient = useQueryClient();
  const offline = useOffline();
  const status = useQuery({
    queryKey: ["secret", name],
    queryFn: () => invokeCommand<SecretStatus>("get_secret_status", { name }),
    retry: false,
  });
  const [editing, setEditing] = useState(false);
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
      setEditing(false);
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

  const configured = status.data?.configured ?? false;

  return (
    <div
      className={`rounded-lg border border-hairline bg-surface p-3 ${offline ? "opacity-60" : ""}`}
    >
      <div className="flex items-center gap-2">
        <h4 className="text-sm font-medium text-text">{label} API key</h4>
        <span
          data-testid={`${name}-key-status`}
          className="inline-flex items-center gap-1.5 text-xs"
        >
          <span
            aria-hidden
            className={`h-2 w-2 rounded-full ${configured ? "bg-[var(--sc-success)]" : "bg-text-3"}`}
          />
          <span className={configured ? "text-[var(--sc-success)]" : "text-text-2"}>
            {configured ? "Connected" : "Not connected"}
          </span>
        </span>
        {configured && !editing && (
          <button
            type="button"
            aria-label={`Edit ${label} key`}
            onClick={() => setEditing(true)}
            className="ml-auto flex h-8 w-8 items-center justify-center rounded-md text-text-3 hover:bg-elevated hover:text-text"
            style={{ minWidth: 32, minHeight: 32 }}
          >
            <Edit3 size={16} strokeWidth={2} />
          </button>
        )}
      </div>
      {configured && !editing ? (
        <div className="mt-2 flex items-center gap-2 rounded-md border border-hairline bg-elevated px-3 py-2">
          <span className="font-mono text-sm tracking-widest text-text-2">{maskedPreview(name)}</span>
          <Check size={14} strokeWidth={2} className="ml-auto text-[var(--sc-success)]" />
        </div>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <input
            type="password"
            value={value}
            placeholder={configured ? "Replace key…" : "Paste key…"}
            onChange={(event) => setValue(event.target.value)}
            className="min-w-0 flex-1 h-14 rounded-md border border-hairline bg-elevated px-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !value.trim()}
            className="h-12 min-h-[48px] rounded-md bg-accent px-4 text-sm font-medium text-white transition-opacity disabled:opacity-50"
          >
            {saving ? "Saving…" : "Save"}
          </button>
          {editing && (
            <button
              type="button"
              onClick={() => { setEditing(false); setValue(""); setSaveError(null); }}
              className="h-12 min-h-[48px] rounded-md border border-hairline px-4 text-sm text-text-2 hover:text-text"
            >
              Cancel
            </button>
          )}
        </div>
      )}
      {!editing && (
        <button
          type="button"
          onClick={runTest}
          disabled={testing}
          className="mt-2 h-8 rounded-md border border-hairline px-3 text-xs text-text-2 hover:text-text disabled:opacity-50"
        >
          {testing ? "Testing…" : "Test connection"}
        </button>
      )}
      {saveError && (
        <p role="alert" className="mt-2 text-xs text-[var(--sc-danger)]">
          {saveError}
        </p>
      )}
      {test && (
        <p
          data-testid={`${name}-test-result`}
          className={`mt-2 text-xs ${test.ok === true ? "text-[var(--sc-success)]" : "text-[var(--sc-danger)]"}`}
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
    <section aria-label="Speech" className="space-y-3 rounded-lg border border-hairline bg-surface p-4">
      <ProviderRow name="groq" label="Groq" testCommand="stt_test_groq" />
      <ProviderRow name="gemini" label="Gemini" testCommand="stt_test_gemini" />

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block text-sm text-text-2">
          Groq model
          <select
            value={GROQ_PRESETS.some(([v]) => v === groqModel) ? groqModel : GROQ_PRESETS[0]![0]}
            onChange={(event) => setGroqModel(event.target.value)}
            data-testid="pref-stt.groq_model"
            className="mt-1 h-14 w-full rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
          >
            {GROQ_PRESETS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {!GROQ_PRESETS.some(([v]) => v === groqModel) && groqModel ? (
              <option value={groqModel}>Custom: {groqModel}</option>
            ) : null}
          </select>
        </label>
        <label className="block text-sm text-text-2">
          Gemini model
          <select
            value={GEMINI_PRESETS.some(([v]) => v === geminiModel) ? geminiModel : GEMINI_PRESETS[0]![0]}
            onChange={(event) => setGeminiModel(event.target.value)}
            data-testid="pref-stt.gemini_model"
            className="mt-1 h-14 w-full rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
          >
            {GEMINI_PRESETS.map(([value, label]) => (
              <option key={value} value={value}>{label}</option>
            ))}
            {!GEMINI_PRESETS.some(([v]) => v === geminiModel) && geminiModel ? (
              <option value={geminiModel}>Custom: {geminiModel}</option>
            ) : null}
          </select>
        </label>
        <label className="block text-sm text-text-2">
          Speech language
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            data-testid="pref-speech.language"
            className="mt-1 h-14 w-full rounded-md border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
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

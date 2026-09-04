import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronDown, Cloud, Cpu, Edit3, Search, Sparkles, X } from "lucide-react";
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
    <div className={`space-y-2 ${offline ? "opacity-60" : ""}`}>
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
            className="min-w-0 flex-1 h-12 min-h-[48px] rounded-md border border-hairline bg-elevated px-3 text-sm outline-none focus:border-accent"
          />
          <button
            type="button"
            onClick={save}
            disabled={saving || !value.trim()}
            className="btn-emerald h-12 min-h-[48px] px-5 text-sm"
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

interface CatalogEntry {
  id: string;
  label: string;
  fileName?: string;
  sizeBytes: number;
  isDefault: boolean;
  installed: boolean;
}

interface ModelListResponse {
  models: CatalogEntry[];
}

interface ModelOption {
  key: string;
  provider: "local" | "groq" | "gemini";
  label: string;
  sublabel: string;
  badge: string;
}

export default function SpeechSection() {
  const [activeModel, setActiveModel] = usePref(
    PREF_KEYS.activeModel,
    String(PREF_DEFAULTS[PREF_KEYS.activeModel]),
  );
  const [groqModel, setGroqModel] = usePref(
    PREF_KEYS.groqModel,
    String(PREF_DEFAULTS[PREF_KEYS.groqModel]),
  );
  const [geminiModel, setGeminiModel] = usePref(
    PREF_KEYS.geminiModel,
    String(PREF_DEFAULTS[PREF_KEYS.geminiModel]),
  );
  const [, setLocalModel] = usePref(
    PREF_KEYS.localModel,
    String(PREF_DEFAULTS[PREF_KEYS.localModel]),
  );
  const [language, setLanguage] = usePref(
    PREF_KEYS.speechLanguage,
    String(PREF_DEFAULTS[PREF_KEYS.speechLanguage]),
  );

  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [search, setSearch] = useState("");
  const dropdownRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const [panelGeom, setPanelGeom] = useState<{
    top?: number;
    bottom?: number;
    left: number;
    width: number;
    maxListH: number;
  } | null>(null);

  // The panel is portaled to document.body (it would otherwise be clipped by
  // the settings card's overflow-hidden), so anchor it to the trigger button
  // with fixed positioning and flip upward when room below runs out.
  const updatePanelGeom = useCallback(() => {
    const el = buttonRef.current;
    if (!el || typeof window === "undefined") return;
    const rect = el.getBoundingClientRect();
    const MARGIN = 8;
    const CHROME_H = 72; // search bar + borders + breathing room
    const MIN_LIST_H = 120;
    const viewH = window.innerHeight;
    const viewW = window.innerWidth;
    const spaceBelow = viewH - rect.bottom;
    const spaceAbove = rect.top;
    const openUp = spaceBelow < 240 && spaceAbove > spaceBelow;
    const width = Math.max(rect.width || 0, 200);
    const left = Math.max(MARGIN, Math.min(rect.left, viewW - width - MARGIN));
    const avail = openUp ? spaceAbove : spaceBelow;
    const maxListH = Math.max(
      MIN_LIST_H,
      Math.min(avail - CHROME_H - MARGIN, viewH * 0.5),
    );
    setPanelGeom(
      openUp
        ? { bottom: viewH - rect.top + 6, left, width, maxListH }
        : { top: rect.bottom + 6, left, width, maxListH },
    );
  }, []);

  useLayoutEffect(() => {
    if (!dropdownOpen) {
      setPanelGeom(null);
      return;
    }
    updatePanelGeom();
    window.addEventListener("resize", updatePanelGeom);
    window.addEventListener("scroll", updatePanelGeom, true);
    return () => {
      window.removeEventListener("resize", updatePanelGeom);
      window.removeEventListener("scroll", updatePanelGeom, true);
    };
  }, [dropdownOpen, updatePanelGeom]);

  const localModelsQuery = useQuery({
    queryKey: ["stt", "models"],
    queryFn: () => invokeCommand<ModelListResponse>("list_stt_models"),
    retry: false,
  });

  const installedLocalModels = useMemo(
    () => (localModelsQuery.data?.models ?? []).filter((m) => m.installed),
    [localModelsQuery.data?.models],
  );

  useEffect(() => {
    if (!dropdownOpen) return;
    const onMouseDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (dropdownRef.current?.contains(target)) return;
      if (panelRef.current?.contains(target)) return;
      setDropdownOpen(false);
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setDropdownOpen(false);
      }
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [dropdownOpen]);

  const allOptions = useMemo<ModelOption[]>(() => {
    const list: ModelOption[] = [];

    // 1. Local STT Models (On top)
    for (const m of installedLocalModels) {
      list.push({
        key: `local:${m.id}`,
        provider: "local",
        label: m.label || m.fileName || m.id,
        sublabel: m.fileName || m.id,
        badge: "Local",
      });
    }

    // 2. Groq Models (After local)
    for (const [val, label] of GROQ_PRESETS) {
      list.push({
        key: `groq:${val}`,
        provider: "groq",
        label,
        sublabel: val,
        badge: "Groq",
      });
    }
    if (!GROQ_PRESETS.some(([v]) => v === groqModel) && groqModel) {
      list.push({
        key: `groq:${groqModel}`,
        provider: "groq",
        label: `Custom: ${groqModel}`,
        sublabel: groqModel,
        badge: "Groq",
      });
    }

    // 3. Gemini Models (After groq)
    for (const [val, label] of GEMINI_PRESETS) {
      list.push({
        key: `gemini:${val}`,
        provider: "gemini",
        label,
        sublabel: val,
        badge: "Gemini",
      });
    }
    if (!GEMINI_PRESETS.some(([v]) => v === geminiModel) && geminiModel) {
      list.push({
        key: `gemini:${geminiModel}`,
        provider: "gemini",
        label: `Custom: ${geminiModel}`,
        sublabel: geminiModel,
        badge: "Gemini",
      });
    }

    return list;
  }, [installedLocalModels, groqModel, geminiModel]);

  const currentSelection = useMemo<ModelOption>(() => {
    if (activeModel && activeModel !== "auto") {
      const found = allOptions.find((o) => o.key === activeModel);
      if (found) return found;
      if (activeModel.startsWith("local:")) {
        return {
          key: activeModel,
          provider: "local",
          label: activeModel.slice(6),
          sublabel: "Local GGML",
          badge: "Local",
        };
      }
      if (activeModel.startsWith("groq:")) {
        return {
          key: activeModel,
          provider: "groq",
          label: activeModel.slice(5),
          sublabel: "Groq Whisper",
          badge: "Groq",
        };
      }
      if (activeModel.startsWith("gemini:")) {
        return {
          key: activeModel,
          provider: "gemini",
          label: activeModel.slice(7),
          sublabel: "Gemini",
          badge: "Gemini",
        };
      }
    }

    // Auto resolution: prioritize local if installed, else groq, else first available
    if (installedLocalModels.length > 0) {
      return allOptions.find((o) => o.provider === "local") || allOptions[0]!;
    }
    return (
      allOptions.find((o) => o.key === `groq:${groqModel}`) ||
      allOptions[0] || {
        key: "groq:whisper-large-v3-turbo",
        provider: "groq",
        label: "Whisper Turbo (Fast)",
        sublabel: "whisper-large-v3-turbo",
        badge: "Groq",
      }
    );
  }, [activeModel, allOptions, installedLocalModels, groqModel]);

  const handleSelectOption = (opt: ModelOption) => {
    setActiveModel(opt.key);
    if (opt.provider === "local") {
      setLocalModel(opt.key.slice("local:".length));
    } else if (opt.provider === "groq") {
      setGroqModel(opt.key.slice("groq:".length));
    } else if (opt.provider === "gemini") {
      setGeminiModel(opt.key.slice("gemini:".length));
    }
    setDropdownOpen(false);
    setSearch("");
  };

  const query = search.trim().toLowerCase();

  const filteredLocal = useMemo(() => {
    const opts = allOptions.filter((o) => o.provider === "local");
    if (!query) return opts;
    return opts.filter(
      (o) =>
        o.label.toLowerCase().includes(query) ||
        o.sublabel.toLowerCase().includes(query) ||
        "local offline stt".includes(query),
    );
  }, [allOptions, query]);

  const filteredGroq = useMemo(() => {
    const opts = allOptions.filter((o) => o.provider === "groq");
    if (!query) return opts;
    return opts.filter(
      (o) =>
        o.label.toLowerCase().includes(query) ||
        o.sublabel.toLowerCase().includes(query) ||
        "groq cloud whisper".includes(query),
    );
  }, [allOptions, query]);

  const filteredGemini = useMemo(() => {
    const opts = allOptions.filter((o) => o.provider === "gemini");
    if (!query) return opts;
    return opts.filter(
      (o) =>
        o.label.toLowerCase().includes(query) ||
        o.sublabel.toLowerCase().includes(query) ||
        "gemini cloud google".includes(query),
    );
  }, [allOptions, query]);

  const totalFilteredCount =
    filteredLocal.length + filteredGroq.length + filteredGemini.length;

  return (
    <div aria-label="Speech" className="divide-y divide-hairline">
      <div className="pb-5">
        <ProviderRow name="groq" label="Groq" testCommand="stt_test_groq" />
      </div>
      <div className="py-5">
        <ProviderRow name="gemini" label="Gemini" testCommand="stt_test_gemini" />
      </div>

      <div className="pt-5 flex flex-col gap-4">
        {/* Unified Searchable STT Model Selector */}
        <div className="relative flex flex-col gap-1.5" ref={dropdownRef}>
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-text-2">Speech-to-Text Model</span>
            <span className="text-xs text-text-3">Local models prioritized</span>
          </div>

          <button
            type="button"
            ref={buttonRef}
            data-testid="pref-stt.active_model"
            onClick={() => setDropdownOpen((open) => !open)}
            className="flex h-12 min-h-[48px] w-full items-center justify-between rounded-lg border border-hairline bg-elevated px-3 text-sm text-text outline-none transition-colors hover:border-accent/40 focus:border-accent focus:ring-1 focus:ring-accent/20"
            aria-expanded={dropdownOpen}
            aria-haspopup="listbox"
          >
            <div className="flex items-center gap-2.5 min-w-0">
              {currentSelection.provider === "local" ? (
                <Cpu size={16} className="text-accent shrink-0" />
              ) : currentSelection.provider === "groq" ? (
                <Cloud size={16} className="text-sky-400 shrink-0" />
              ) : (
                <Sparkles size={16} className="text-amber-400 shrink-0" />
              )}
              <span
                className={`rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider shrink-0 ${
                  currentSelection.provider === "local"
                    ? "bg-accent/15 text-accent border border-accent/30"
                    : currentSelection.provider === "groq"
                      ? "bg-sky-500/15 text-sky-400 border border-sky-500/30"
                      : "bg-amber-500/15 text-amber-400 border border-amber-500/30"
                }`}
              >
                {currentSelection.badge}
              </span>
              <span className="font-medium truncate text-text">{currentSelection.label}</span>
            </div>
            <ChevronDown
              size={16}
              className={`text-text-3 shrink-0 ml-2 transition-transform duration-150 ${
                dropdownOpen ? "rotate-180 text-text" : ""
              }`}
            />
          </button>

          {dropdownOpen &&
            createPortal(
              <div
                ref={panelRef}
                className="fixed z-[100] rounded-xl border border-hairline bg-surface shadow-2xl overflow-hidden"
                style={{
                  top: panelGeom?.top,
                  bottom: panelGeom?.bottom,
                  left: panelGeom?.left ?? 8,
                  width: panelGeom?.width ?? 200,
                }}
                data-testid="stt-model-dropdown"
              >
              {/* Search Bar */}
              <div className="p-2 border-b border-hairline bg-elevated/50">
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg border border-hairline bg-base focus-within:border-accent">
                  <Search size={14} className="text-text-3 shrink-0" />
                  <input
                    type="text"
                    data-testid="stt-model-search"
                    autoFocus
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    placeholder="Search speech models (local, groq, gemini)..."
                    className="w-full bg-transparent text-xs text-text outline-none placeholder:text-text-3"
                  />
                  {search && (
                    <button
                      type="button"
                      onClick={() => setSearch("")}
                      className="text-text-3 hover:text-text"
                    >
                      <X size={13} />
                    </button>
                  )}
                </div>
              </div>

              {/* Grouped Model List */}
              <div
                className="overflow-y-auto divide-y divide-hairline/30"
                style={{ maxHeight: panelGeom?.maxListH ?? 320 }}
              >
                {/* 1. LOCAL MODELS (ON TOP) */}
                {(filteredLocal.length > 0 || installedLocalModels.length === 0) && (
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-3 flex items-center gap-1.5">
                      <Cpu size={13} className="text-accent" />
                      <span>Local Models (On-Device)</span>
                    </div>

                    {installedLocalModels.length === 0 ? (
                      <div className="px-3 py-2 text-xs text-text-3 italic">
                        No local models installed. Import GGML models below in Local Models.
                      </div>
                    ) : (
                      filteredLocal.map((opt) => {
                        const isSelected = currentSelection.key === opt.key;
                        return (
                          <button
                            key={opt.key}
                            type="button"
                            data-testid={`stt-model-option-${opt.key}`}
                            onClick={() => handleSelectOption(opt)}
                            className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-elevated ${
                              isSelected
                                ? "bg-accent/15 border-l-2 border-accent text-accent font-medium"
                                : "text-text"
                            }`}
                          >
                            <div className="min-w-0 pr-2">
                              <div className="font-medium truncate">{opt.label}</div>
                              <div className="text-[10px] text-text-3 font-mono truncate">
                                {opt.sublabel}
                              </div>
                            </div>
                            {isSelected && <Check size={14} className="text-accent shrink-0" />}
                          </button>
                        );
                      })
                    )}
                  </div>
                )}

                {/* 2. GROQ MODELS */}
                {filteredGroq.length > 0 && (
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-3 flex items-center gap-1.5">
                      <Cloud size={13} className="text-sky-400" />
                      <span>Groq (Cloud Whisper)</span>
                    </div>
                    {filteredGroq.map((opt) => {
                      const isSelected = currentSelection.key === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          data-testid={`stt-model-option-${opt.key}`}
                          onClick={() => handleSelectOption(opt)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-elevated ${
                            isSelected
                              ? "bg-accent/15 border-l-2 border-accent text-accent font-medium"
                              : "text-text"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-medium truncate">{opt.label}</div>
                            <div className="text-[10px] text-text-3 font-mono truncate">
                              {opt.sublabel}
                            </div>
                          </div>
                          {isSelected && <Check size={14} className="text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {/* 3. GEMINI MODELS */}
                {filteredGemini.length > 0 && (
                  <div className="py-1">
                    <div className="px-3 py-1.5 text-[11px] font-bold uppercase tracking-wider text-text-3 flex items-center gap-1.5">
                      <Sparkles size={13} className="text-amber-400" />
                      <span>Gemini (Cloud Multimodal)</span>
                    </div>
                    {filteredGemini.map((opt) => {
                      const isSelected = currentSelection.key === opt.key;
                      return (
                        <button
                          key={opt.key}
                          type="button"
                          data-testid={`stt-model-option-${opt.key}`}
                          onClick={() => handleSelectOption(opt)}
                          className={`w-full flex items-center justify-between px-3 py-2 text-left text-xs transition-colors hover:bg-elevated ${
                            isSelected
                              ? "bg-accent/15 border-l-2 border-accent text-accent font-medium"
                              : "text-text"
                          }`}
                        >
                          <div className="min-w-0 pr-2">
                            <div className="font-medium truncate">{opt.label}</div>
                            <div className="text-[10px] text-text-3 font-mono truncate">
                              {opt.sublabel}
                            </div>
                          </div>
                          {isSelected && <Check size={14} className="text-accent shrink-0" />}
                        </button>
                      );
                    })}
                  </div>
                )}

                {totalFilteredCount === 0 && (
                  <div className="p-4 text-center text-xs text-text-3">
                    No models found matching &ldquo;{search}&rdquo;
                  </div>
                )}
              </div>
              </div>,
              document.body,
            )}
        </div>

        {/* Speech Language Selector */}
        <label className="flex flex-col gap-1.5 text-sm font-medium text-text-2">
          <span>Speech language</span>
          <select
            value={language}
            onChange={(event) => setLanguage(event.target.value)}
            data-testid="pref-speech.language"
            className="h-12 min-h-[48px] w-full rounded-lg border border-hairline bg-elevated px-3 text-sm text-text outline-none focus:border-accent"
          >
            {LANGUAGES.map(([code, label]) => (
              <option key={code} value={code}>
                {label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}

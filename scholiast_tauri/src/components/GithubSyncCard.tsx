import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";
import { openUrl } from "@tauri-apps/plugin-opener";
import { GitBranch } from "lucide-react";
import { IpcCommandError } from "../lib/ipc";
import {
  githubComplete,
  githubConnect,
  githubDisconnect,
  githubSecretStatus,
  githubStatus,
  listGithubRepos,
  setGithubSecret,
  type GithubRepo,
} from "../lib/githubIpc";
import { consumeGithubOAuth, listenGithubOAuth } from "../lib/githubOAuth";
import { getPref, PREF_KEYS, setPref } from "../lib/store";
import ThemedSelect from "./settings/ThemedSelect";

const STATUS_KEY = ["github", "status"] as const;
const REPOS_KEY = ["github", "repos"] as const;

export default function GithubSyncCard() {
  const queryClient = useQueryClient();
  const statusQuery = useQuery({ queryKey: STATUS_KEY, queryFn: githubStatus });
  const reposQuery = useQuery({
    queryKey: REPOS_KEY,
    queryFn: listGithubRepos,
    enabled: statusQuery.data?.connected === true,
    retry: false,
  });

  const [clientId, setClientId] = useState("");
  const [clientSecret, setClientSecret] = useState("");
  const [idSaved, setIdSaved] = useState(false);
  const [secretSaved, setSecretSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [completing, setCompleting] = useState(false);
  const [account, setAccount] = useState<string | null>(null);
  const [repo, setRepo] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [confirmingDisconnect, setConfirmingDisconnect] = useState(false);

  useEffect(() => {
    void githubSecretStatus("github.client_id").then((s) => setIdSaved(s.configured)).catch(() => {});
    void githubSecretStatus("github.client_secret").then((s) => setSecretSaved(s.configured)).catch(() => {});
    void getPref<string>(PREF_KEYS.githubRepo, "").then(setRepo).catch(() => {});
    void getPref<string>(PREF_KEYS.githubLogin, "").then((v) => {
      if (v) setAccount(v);
    }).catch(() => {});
  }, []);

  useEffect(() => {
    const finish = (code: string, state: string) => {
      setCompleting(true);
      setError(null);
      githubComplete({ code, state })
        .then((acc) => {
          setAccount(acc.login);
          void setPref(PREF_KEYS.githubLogin, acc.login).catch(() => {});
          void queryClient.invalidateQueries({ queryKey: STATUS_KEY });
          void queryClient.invalidateQueries({ queryKey: REPOS_KEY });
        })
        .catch((err: unknown) => {
          setError(err instanceof Error ? err.message : String(err));
        })
        .finally(() => {
          setCompleting(false);
          setConnecting(false);
        });
    };
    const pending = consumeGithubOAuth();
    if (pending) finish(pending.code, pending.state);
    return listenGithubOAuth((payload) => finish(payload.code, payload.state));
  }, [queryClient]);

  async function saveClient() {
    setSaving(true);
    setError(null);
    try {
      if (clientId.trim()) await setGithubSecret("github.client_id", clientId.trim());
      if (clientSecret.trim()) await setGithubSecret("github.client_secret", clientSecret.trim());
      setClientId("");
      setClientSecret("");
      setIdSaved(true);
      setSecretSaved(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  }

  async function connect() {
    setConnecting(true);
    setError(null);
    try {
      const start = await githubConnect();
      await openUrl(start.url);
    } catch (err) {
      if (err instanceof IpcCommandError && err.kind === "oauth_not_configured") {
        setError("Enter the Client ID and secret first.");
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
      setConnecting(false);
    }
  }

  async function disconnect() {
    if (!confirmingDisconnect) {
      setConfirmingDisconnect(true);
      window.setTimeout(() => setConfirmingDisconnect(false), 4000);
      return;
    }
    setConfirmingDisconnect(false);
    setError(null);
    try {
      await githubDisconnect();
      setAccount(null);
      void setPref(PREF_KEYS.githubLogin, "").catch(() => {});
      await queryClient.invalidateQueries({ queryKey: STATUS_KEY });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  async function pickRepo(fullName: string) {
    setRepo(fullName);
    await setPref(PREF_KEYS.githubRepo, fullName).catch(() => {});
  }

  const connected = statusQuery.data?.connected ?? false;
  const repos: GithubRepo[] = reposQuery.data ?? [];
  const repoOptions = repos.map(
    (r) => [r.full_name, `${r.full_name}${r.private ? "" : " (public)"}`] as const,
  );

  return (
    <div aria-label="GitHub sync" data-testid="github-sync-card" className="space-y-4">
      <div className="flex items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-accent/25 bg-accent/15 text-accent">
            <GitBranch size={18} strokeWidth={2.2} />
          </div>
          <div className="min-w-0">
            <h3 className="flex min-w-0 items-center gap-2 text-sm font-semibold tracking-tight text-text">
              <span className="whitespace-nowrap">GitHub</span>
              <span
                data-testid="github-status-badge"
                className={`inline-flex shrink-0 items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-[10px] font-medium ${
                  connected
                    ? "border-accent/25 bg-accent/15 text-accent"
                    : "border-hairline bg-elevated text-text-3"
                }`}
              >
                <span
                  className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-accent" : "bg-text-3"}`}
                  aria-hidden
                />
                <span>{connected ? "Connected" : "Not connected"}</span>
              </span>
            </h3>
            <p className="mt-0.5 truncate text-xs text-text-3" data-testid="github-status-line">
              {statusQuery.isPending
                ? "Checking connection…"
                : connecting || completing
                  ? "Waiting for GitHub sign-in…"
                  : connected
                    ? `Connected${account ? ` as ${account}` : ""}${repo ? ` • ${repo}` : ""}`
                    : "Not Connected • Enter credentials, then Connect"}
            </p>
          </div>
        </div>
        <div className="shrink-0">
          {!connected ? (
            <button
              type="button"
              onClick={connect}
              disabled={connecting || !(idSaved && secretSaved)}
              data-testid="github-connect-btn"
              className="btn-emerald h-8 px-3.5 text-xs font-medium"
            >
              {connecting || completing ? "Connecting…" : "Connect"}
            </button>
          ) : confirmingDisconnect ? (
            <button
              type="button"
              onClick={disconnect}
              className="h-8 rounded-lg border border-[var(--sc-danger)] px-3 text-xs font-medium text-[var(--sc-danger)] transition-colors hover:bg-[var(--sc-danger)]/10"
            >
              Confirm disconnect?
            </button>
          ) : (
            <button
              type="button"
              onClick={disconnect}
              data-testid="github-disconnect-btn"
              className="h-8 rounded-lg border border-hairline px-3 text-xs font-medium text-text-3 transition-colors hover:bg-elevated hover:text-text"
            >
              Disconnect
            </button>
          )}
        </div>
      </div>

      {!connected && (
        <div className="grid gap-3">
          <label className="flex flex-col gap-1.5 text-xs font-medium text-text-2">
            <span>Client ID</span>
            <input
              type="text"
              value={clientId}
              onChange={(e) => setClientId(e.target.value)}
              placeholder={idSaved ? "Saved ✓ — enter to replace" : "Iv23…"}
              autoComplete="off"
              spellCheck={false}
              data-testid="github-client-id"
              className="h-10 w-full rounded-lg border border-hairline bg-elevated px-3 text-sm text-text outline-none placeholder:text-text-3/60 focus:border-accent"
            />
          </label>
          <label className="flex flex-col gap-1.5 text-xs font-medium text-text-2">
            <span>Client secret</span>
            <input
              type="password"
              value={clientSecret}
              onChange={(e) => setClientSecret(e.target.value)}
              placeholder={secretSaved ? "Saved ✓ — enter to replace" : "Paste secret"}
              autoComplete="off"
              spellCheck={false}
              data-testid="github-client-secret"
              className="h-10 w-full rounded-lg border border-hairline bg-elevated px-3 text-sm text-text outline-none placeholder:text-text-3/60 focus:border-accent"
            />
          </label>
          <div>
            <button
              type="button"
              onClick={saveClient}
              disabled={saving || (!clientId.trim() && !clientSecret.trim())}
              data-testid="github-save-client-btn"
              className="h-9 rounded-lg border border-hairline px-4 text-xs font-medium text-text-2 transition-colors hover:bg-elevated hover:text-text disabled:opacity-50"
            >
              {saving ? "Saving…" : "Save credentials"}
            </button>
          </div>
          <p className="text-[11px] leading-relaxed text-text-3">
            From your GitHub App. Stored only on this device — never in the build. After Connect,
            sign in on github.com and the app finishes by itself.
          </p>
        </div>
      )}

      {connected && (
        <div className="flex flex-col gap-1.5">
          <span className="text-xs font-medium text-text-2">Sync repo</span>
          {reposQuery.isPending ? (
            <p className="text-xs text-text-3">Loading repos…</p>
          ) : repos.length === 0 ? (
            <div className="rounded-lg border border-hairline bg-elevated/40 p-3 text-xs leading-relaxed text-text-2">
              <p>No repos covered. Create an empty private repo on github.com, then add it to the
              App installation (App settings → Install → Configure → Repository access), then:</p>
              <button
                type="button"
                onClick={() => void reposQuery.refetch()}
                className="mt-2 h-8 rounded-lg border border-hairline px-3 text-xs font-medium text-text-2 transition-colors hover:bg-elevated hover:text-text"
              >
                Refresh list
              </button>
            </div>
          ) : (
            <ThemedSelect
              value={repo}
              onChange={(next) => void pickRepo(next)}
              options={repoOptions}
              testId="github-repo"
              ariaLabel="Sync repo"
            />
          )}
        </div>
      )}

      {error && (
        <p className="text-xs text-[var(--sc-danger)]" role="alert">
          {error}
        </p>
      )}
    </div>
  );
}

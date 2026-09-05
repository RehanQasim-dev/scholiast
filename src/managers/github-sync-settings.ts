import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import { initializeIcons } from '../icons/icons';

// Settings UI for GitHub sync — mirrors sync-settings.ts for Drive.
// All work happens in background (sync-engine / github); this only reflects status.

interface SyncProgress {
	phase: 'discovering' | 'page';
	done: number;
	total: number;
	title?: string;
	url?: string;
}
interface SyncStatus {
	connected: boolean;
	lastSyncedAt?: number;
	lastError?: string;
	syncing?: boolean;
	progress?: SyncProgress;
}
interface GitHubSyncResponse {
	success: boolean;
	error?: string;
	status: SyncStatus;
	configured: boolean;
	redirectUrl: string;
	repo?: string;
	url?: string;
	account?: { login: string };
	repos?: Array<{ owner: string; repo: string; fullName: string; private: boolean }>;
}

const STATUS_KEY = 'github_sync_status';

async function send(action: string, extra?: Record<string, unknown>): Promise<GitHubSyncResponse> {
	return (await browser.runtime.sendMessage({ action, ...(extra || {}) })) as GitHubSyncResponse;
}

function formatLastSynced(ts?: number): string {
	if (!ts) return '';
	const d = new Date(ts);
	return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

function pageLabel(p: SyncProgress): string {
	if (p.title) return p.title;
	if (!p.url) return '';
	try { const u = new URL(p.url); return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`; } catch { return p.url; }
}

export async function initializeGithubSyncSettings(): Promise<void> {
	const connectBtn = document.getElementById('github-sync-connect-btn') as HTMLButtonElement | null;
	const disconnectBtn = document.getElementById('github-sync-disconnect-btn') as HTMLButtonElement | null;
	const syncNowBtn = document.getElementById('github-sync-now-btn') as HTMLButtonElement | null;
	const statusEl = document.getElementById('github-sync-status');
	const setupNote = document.getElementById('github-sync-setup-note');
	const redirectEl = document.getElementById('github-sync-redirect-uri');
	const repoEl = document.getElementById('github-sync-repo');
	if (!connectBtn || !disconnectBtn || !syncNowBtn || !statusEl) return;

	const clientIdEl = document.getElementById('github-client-id') as HTMLInputElement | null;
	const clientSecretEl = document.getElementById('github-client-secret') as HTMLInputElement | null;
	const saveClientBtn = document.getElementById('github-save-client-btn') as HTMLButtonElement | null;
	const clientNote = document.getElementById('github-client-saved-note');
	const codeItem = document.getElementById('github-code-item');
	const codeEl = document.getElementById('github-auth-code') as HTMLInputElement | null;
	const completeBtn = document.getElementById('github-complete-btn') as HTMLButtonElement | null;
	const repoItem = document.getElementById('github-repo-item');
	const repoSelect = document.getElementById('github-repo-select') as HTMLSelectElement | null;
	const refreshReposBtn = document.getElementById('github-refresh-repos-btn') as HTMLButtonElement | null;

	const progressItem = document.getElementById('github-sync-progress-item');
	const progressCard = document.getElementById('github-sync-progress-card');
	const progressPhase = document.getElementById('github-sync-progress-phase');
	const progressPercent = document.getElementById('github-sync-progress-percent');
	const progressFill = document.getElementById('github-sync-progress-fill');
	const progressPage = document.getElementById('github-sync-progress-page');
	const progressCount = document.getElementById('github-sync-progress-count');

	let lastResponse: GitHubSyncResponse | null = null;

	function renderProgress(status: SyncStatus, error?: string): void {
		if (!progressItem || !progressCard || !progressPhase || !progressPercent || !progressFill || !progressPage || !progressCount) return;
		const failed = !!(error || status.lastError);
		if (!status.syncing && !failed) { progressItem.style.display = 'none'; return; }
		progressItem.style.display = '';
		if (failed && !status.syncing) {
			progressCard.classList.remove('is-running','is-indeterminate');
			progressCard.classList.add('is-error');
			progressPhase.textContent = getMessage('syncError') || 'Sync failed';
			progressPercent.textContent = '';
			progressFill.style.width = '0';
			progressPage.textContent = error || status.lastError || '';
			progressCount.textContent = '';
			return;
		}
		progressCard.classList.remove('is-error');
		progressCard.classList.add('is-running');
		const p = status.progress;
		const total = p?.total ?? 0;
		if (!p || p.phase === 'discovering' || total === 0) {
			progressCard.classList.add('is-indeterminate');
			progressPhase.textContent = getMessage('syncDiscovering') || 'Looking for changes…';
			progressPercent.textContent = '';
			progressFill.style.width = '';
			progressPage.textContent = '';
			progressCount.textContent = '';
			return;
		}
		progressCard.classList.remove('is-indeterminate');
		const pct = Math.min(100, Math.round((p.done/total)*100));
		progressPhase.textContent = getMessage('syncInProgress') || 'Syncing…';
		progressPercent.textContent = `${pct}%`;
		progressFill.style.width = `${pct}%`;
		progressPage.textContent = pageLabel(p);
		progressCount.textContent = `${p.done+1} / ${total}`;
	}

	function render(res: GitHubSyncResponse): void {
		lastResponse = res;
		const { status, configured, redirectUrl, repo } = res;
		if (setupNote) setupNote.style.display = configured ? 'none' : '';
		if (redirectEl) redirectEl.textContent = redirectUrl || '';
		if (repoEl) repoEl.textContent = repo ? `Repo: ${repo}` : '';
		if (connectBtn) { connectBtn.disabled = !configured; connectBtn.style.display = status.connected ? 'none' : ''; }
		if (disconnectBtn) disconnectBtn.style.display = status.connected ? '' : 'none';
		if (syncNowBtn) syncNowBtn.style.display = status.connected ? '' : 'none';
		if (repoItem) repoItem.style.display = status.connected ? '' : 'none';
		if (clientNote) clientNote.textContent = configured ? 'Client saved in this browser.' : '';
		if (!configured) {
			statusEl!.textContent = getMessage('syncNotConfigured') || 'Enter the Client ID and secret, then Connect.';
			renderProgress({connected:false});
			return;
		}
		if (res.error) statusEl!.textContent = `${getMessage('syncError')||'Sync error'}: ${res.error}`;
		else if (status.syncing) statusEl!.textContent = getMessage('syncInProgress')||'Syncing…';
		else if (status.connected) {
			const when = formatLastSynced(status.lastSyncedAt);
			statusEl!.textContent = when ? `${getMessage('syncLastSynced')||'Last synced'}: ${when}` : (getMessage('syncConnected')||'Connected.');
		} else statusEl!.textContent = getMessage('syncNotConnected')||'Not connected.';
		renderProgress(status, res.error);
	}

	async function refresh(): Promise<void> {
		try { render(await send('githubSyncStatus')); } catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
	}

	function withBusy(btn: HTMLButtonElement, action: string, onResponse?: (res: GitHubSyncResponse) => void | Promise<void>): void {
		btn.addEventListener('click', async () => {
			const orig = btn.textContent;
			btn.disabled = true;
			btn.textContent = getMessage('syncInProgress')||'Working…';
			try {
				const res = await send(action);
				render(res);
				await onResponse?.(res);
			} catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
			finally { btn.textContent = orig; btn.disabled = false; }
		});
	}

	withBusy(connectBtn, 'githubAuthUrl', async (res) => {
		if (res.url) {
			try { await browser.tabs.create({ url: res.url }); } catch { window.open(res.url, '_blank'); }
			if (codeItem) codeItem.style.display = '';
			if (codeEl) codeEl.focus();
		}
	});
	withBusy(disconnectBtn, 'githubSyncDisconnect');
	withBusy(syncNowBtn, 'githubSyncNow');

	if (saveClientBtn) {
		saveClientBtn.addEventListener('click', async () => {
			saveClientBtn.disabled = true;
			try {
				render(await send('githubSaveClient', {
					clientId: clientIdEl?.value ?? '',
					clientSecret: clientSecretEl?.value ?? '',
				}));
				if (clientSecretEl) clientSecretEl.value = '';
			} catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
			finally { saveClientBtn.disabled = false; }
		});
	}

	if (completeBtn) {
		completeBtn.addEventListener('click', async () => {
			completeBtn.disabled = true;
			try {
				const res = await send('githubComplete', { code: codeEl?.value ?? '' });
				render(res);
				if (res.success) {
					if (codeItem) codeItem.style.display = 'none';
					if (codeEl) codeEl.value = '';
					await loadRepos();
				}
			} catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
			finally { completeBtn.disabled = false; }
		});
	}

	async function loadRepos(): Promise<void> {
		if (!repoSelect) return;
		repoSelect.innerHTML = '';
		try {
			const res = await send('githubRepos');
			const repos = res.repos ?? [];
			const current = (lastResponse?.repo || '').toLowerCase();
			if (!repos.length) {
				const opt = document.createElement('option');
				opt.value = '';
				opt.textContent = 'No repos covered — create one and add it to the installation';
				repoSelect.appendChild(opt);
				return;
			}
			for (const r of repos) {
				const opt = document.createElement('option');
				opt.value = r.fullName;
				opt.textContent = `${r.fullName}${r.private ? '' : ' (public)'}`;
				if (r.fullName.toLowerCase() === current) opt.selected = true;
				repoSelect.appendChild(opt);
			}
		} catch (e) {
			const opt = document.createElement('option');
			opt.value = '';
			opt.textContent = e instanceof Error ? e.message : String(e);
			repoSelect.appendChild(opt);
		}
	}

	if (refreshReposBtn) {
		refreshReposBtn.addEventListener('click', async () => {
			refreshReposBtn.disabled = true;
			try { await loadRepos(); } finally { refreshReposBtn.disabled = false; }
		});
	}

	if (repoSelect) {
		repoSelect.addEventListener('change', async () => {
			if (!repoSelect.value) return;
			try {
				render(await send('githubPickRepo', { fullName: repoSelect.value }));
			} catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
		});
	}

	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !changes[STATUS_KEY]) return;
		const status = (changes[STATUS_KEY].newValue || {}) as SyncStatus;
		if (lastResponse) render({ ...lastResponse, status, error: undefined });
		else renderProgress(status);
	});

	initializeIcons();
	await refresh();
	if (lastResponse?.status.connected) await loadRepos().catch(() => {});
}

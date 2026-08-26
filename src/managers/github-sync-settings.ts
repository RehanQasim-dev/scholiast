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
}

const STATUS_KEY = 'github_sync_status';

async function send(action: string): Promise<GitHubSyncResponse> {
	return (await browser.runtime.sendMessage({ action })) as GitHubSyncResponse;
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
		if (!configured) {
			statusEl!.textContent = getMessage('syncNotConfigured') || 'GitHub sync not configured in this build.';
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

	function withBusy(btn: HTMLButtonElement, action: string): void {
		btn.addEventListener('click', async () => {
			const orig = btn.textContent;
			btn.disabled = true;
			btn.textContent = getMessage('syncInProgress')||'Working…';
			try { render(await send(action)); } catch (e) { if (statusEl) statusEl.textContent = e instanceof Error ? e.message : String(e); }
			finally { btn.textContent = orig; btn.disabled = false; }
		});
	}

	withBusy(connectBtn, 'githubSyncConnect');
	withBusy(disconnectBtn, 'githubSyncDisconnect');
	withBusy(syncNowBtn, 'githubSyncNow');

	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !changes[STATUS_KEY]) return;
		const status = (changes[STATUS_KEY].newValue || {}) as SyncStatus;
		if (lastResponse) render({ ...lastResponse, status, error: undefined });
		else renderProgress(status);
	});

	initializeIcons();
	await refresh();
}

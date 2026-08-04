import browser from '../utils/browser-polyfill';
import { getMessage } from '../utils/i18n';
import { initializeIcons } from '../icons/icons';

// Settings UI for Google Drive annotation sync. All real work happens in the
// background service worker (sync-engine / google-drive); this module only sends
// it messages and reflects status in the DOM.

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
interface SyncResponse {
	success: boolean;
	error?: string;
	status: SyncStatus;
	configured: boolean;
	redirectUrl: string;
}

// The background writes its live status here as it works, so the panel follows a
// sync in progress instead of only updating when a button is clicked.
const STATUS_KEY = 'sync_status';

async function send(action: string): Promise<SyncResponse> {
	return (await browser.runtime.sendMessage({ action })) as SyncResponse;
}

function formatLastSynced(ts?: number): string {
	if (!ts) return '';
	const d = new Date(ts);
	return `${d.toLocaleDateString()} ${d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`;
}

// A page's display name: its recorded title, else a readable form of the url.
function pageLabel(progress: SyncProgress): string {
	if (progress.title) return progress.title;
	if (!progress.url) return '';
	try {
		const u = new URL(progress.url);
		return `${u.hostname}${u.pathname === '/' ? '' : u.pathname}`;
	} catch {
		return progress.url;
	}
}

export async function initializeSyncSettings(): Promise<void> {
	const connectBtn = document.getElementById('sync-connect-btn') as HTMLButtonElement | null;
	const disconnectBtn = document.getElementById('sync-disconnect-btn') as HTMLButtonElement | null;
	const syncNowBtn = document.getElementById('sync-now-btn') as HTMLButtonElement | null;
	const statusEl = document.getElementById('sync-status');
	const setupNote = document.getElementById('sync-setup-note');
	const redirectEl = document.getElementById('sync-redirect-uri');
	if (!connectBtn || !disconnectBtn || !syncNowBtn || !statusEl) return;

	const progressItem = document.getElementById('sync-progress-item');
	const progressCard = document.getElementById('sync-progress-card');
	const progressPhase = document.getElementById('sync-progress-phase');
	const progressPercent = document.getElementById('sync-progress-percent');
	const progressFill = document.getElementById('sync-progress-fill');
	const progressPage = document.getElementById('sync-progress-page');
	const progressCount = document.getElementById('sync-progress-count');

	// Last response from the background, so a storage-driven status update can be
	// rendered without another round trip.
	let lastResponse: SyncResponse | null = null;

	function renderProgress(status: SyncStatus, error?: string): void {
		if (!progressItem || !progressCard || !progressPhase || !progressPercent
			|| !progressFill || !progressPage || !progressCount) return;

		const failed = !!(error || status.lastError);
		// The panel is for work in flight and for the failure that ended it; a clean
		// idle state is already covered by the Status line above.
		if (!status.syncing && !failed) {
			progressItem.style.display = 'none';
			return;
		}
		progressItem.style.display = '';

		if (failed && !status.syncing) {
			progressCard.classList.remove('is-running', 'is-indeterminate');
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

		const progress = status.progress;
		const total = progress?.total ?? 0;
		// Discovery has no total yet: sweep the bar rather than show a fake number.
		if (!progress || progress.phase === 'discovering' || total === 0) {
			progressCard.classList.add('is-indeterminate');
			progressPhase.textContent = getMessage('syncDiscovering') || 'Looking for changes…';
			progressPercent.textContent = '';
			progressFill.style.width = '';
			progressPage.textContent = '';
			progressCount.textContent = '';
			return;
		}

		progressCard.classList.remove('is-indeterminate');
		const percent = Math.min(100, Math.round((progress.done / total) * 100));
		progressPhase.textContent = getMessage('syncInProgress') || 'Syncing…';
		progressPercent.textContent = `${percent}%`;
		progressFill.style.width = `${percent}%`;
		progressPage.textContent = pageLabel(progress);
		progressCount.textContent = `${progress.done + 1} / ${total}`;
	}

	function render(res: SyncResponse): void {
		lastResponse = res;
		const { status, configured, redirectUrl } = res;

		if (setupNote) setupNote.style.display = configured ? 'none' : '';
		if (redirectEl) redirectEl.textContent = redirectUrl || '';

		connectBtn!.disabled = !configured;
		connectBtn!.style.display = status.connected ? 'none' : '';
		disconnectBtn!.style.display = status.connected ? '' : 'none';
		syncNowBtn!.style.display = status.connected ? '' : 'none';

		if (!configured) {
			statusEl!.textContent = getMessage('syncNotConfigured') || 'Sync is not configured in this build.';
			renderProgress({ connected: false });
			return;
		}
		if (res.error) {
			statusEl!.textContent = `${getMessage('syncError') || 'Sync error'}: ${res.error}`;
		} else if (status.syncing) {
			statusEl!.textContent = getMessage('syncInProgress') || 'Syncing…';
		} else if (status.connected) {
			const when = formatLastSynced(status.lastSyncedAt);
			statusEl!.textContent = when
				? `${getMessage('syncLastSynced') || 'Last synced'}: ${when}`
				: getMessage('syncConnected') || 'Connected.';
		} else {
			statusEl!.textContent = getMessage('syncNotConnected') || 'Not connected.';
		}
		renderProgress(status, res.error);
	}

	async function refresh(): Promise<void> {
		try {
			render(await send('syncStatus'));
		} catch (err) {
			statusEl!.textContent = err instanceof Error ? err.message : String(err);
		}
	}

	function withBusy(btn: HTMLButtonElement, action: string): void {
		btn.addEventListener('click', async () => {
			const original = btn.textContent;
			btn.disabled = true;
			btn.textContent = getMessage('syncInProgress') || 'Working…';
			try {
				render(await send(action));
			} catch (err) {
				statusEl!.textContent = err instanceof Error ? err.message : String(err);
			} finally {
				btn.textContent = original;
				btn.disabled = false;
			}
		});
	}

	withBusy(connectBtn, 'syncConnect');
	withBusy(disconnectBtn, 'syncDisconnect');
	withBusy(syncNowBtn, 'syncNow');

	// Follow the run live: every page the engine finishes rewrites this record.
	browser.storage.onChanged.addListener((changes, area) => {
		if (area !== 'local' || !changes[STATUS_KEY]) return;
		const status = (changes[STATUS_KEY].newValue || {}) as SyncStatus;
		if (lastResponse) {
			render({ ...lastResponse, status, error: undefined });
		} else {
			renderProgress(status);
		}
	});

	initializeIcons();
	await refresh();
}

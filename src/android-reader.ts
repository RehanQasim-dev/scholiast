// Android reader bundle entry.
//
// Loaded by the Android WebView after Kotlin injects the raw page HTML via
// loadDataWithBaseURL (with a <script src=".../android-reader.js"> tag). It:
//   1. runs Mozilla Readability on a clone of the raw document,
//   2. swaps the body for the cleaned article DOM (div.reader-article),
//   3. boots the annotation kernel (./android/annotation-kernel),
//   4. exposes window.ReaderAndroid for Kotlin (evaluateJavascript) and calls
//      guarded AndroidBridge callbacks back into Kotlin.
//
// Every AndroidBridge access is typeof-guarded so the same bundle also runs
// standalone in a desktop browser (src/android/test/test.html smoke page).

import { Readability } from '@mozilla/readability';
import './android/reader.css';
import {
	AnnotationKernel,
	type KernelHost,
	type ReaderTextHighlight,
	type HlColor,
} from './android/annotation-kernel';

declare global {
	interface Window {
		ReaderAndroid?: ReaderAndroidApi;
		AndroidBridge?: Partial<AndroidBridgeApi>;
		__scholiastReaderLoaded?: boolean;
	}
}

/** JS → Kotlin surface (@JavascriptInterface on the Kotlin side). */
export interface AndroidBridgeApi {
	onReady(): void;
	onHighlightCreated(json: string): void;
	onHighlightUpdated(json: string): void;
	onHighlightDeleted(id: string): void;
	onLinkTap(url: string): void;
	onScrollPct(pct: number): void;
	onSelectionState(json: string | null): void;
}

/** K → JS surface (Kotlin calls these via evaluateJavascript). */
export interface ReaderAndroidApi {
	ready(): boolean;
	paintHighlights(jsonArrayString: string): number;
	revealHighlight(id: string): boolean;
	setReaderTheme(opts: { dark?: boolean; fontPx?: number; serif?: boolean; wide?: boolean }): void;
	getArticleText(): Promise<string>;
	commitPending(color?: HlColor): string | null;
}

const COLORS: HlColor[] = ['yellow', 'red', 'green'];

function bridge<K extends keyof AndroidBridgeApi>(
	fn: K,
	...args: Parameters<AndroidBridgeApi[K]>
): boolean {
	const target = window.AndroidBridge;
	if (!target || typeof target[fn] !== 'function') return false;
	try {
		// Must call as a member expression: extracting the function into a
		// variable detaches `this` and Chromium then throws
		// "Java bridge method can't be invoked on a non-injected object".
		(target[fn] as (...a: unknown[]) => void).apply(target, args);
		return true;
	} catch (err) {
		console.warn(`[reader] AndroidBridge.${fn} failed`, err);
		return false;
	}
}

// ---------------------------------------------------------------------------
// Readability swap
// ---------------------------------------------------------------------------

const STRIP_TAGS = 'script, style, noscript, iframe, object, embed, link, meta, base, form, button, input, select, textarea';

function sanitize(container: Element): void {
	container.querySelectorAll(STRIP_TAGS).forEach((el) => el.remove());
	container.querySelectorAll('*').forEach((el) => {
		for (const attr of Array.from(el.attributes)) {
			const name = attr.name.toLowerCase();
			if (name.startsWith('on')) el.removeAttribute(attr.name);
			else if ((name === 'href' || name === 'src') && /^\s*javascript:/i.test(attr.value)) {
				el.removeAttribute(attr.name);
			}
		}
	});
}

interface SwapResult {
	article: HTMLDivElement;
	title: string;
	text: string;
}

function swapToReaderArticle(doc: Document): SwapResult {
	const article = doc.createElement('div');
	article.className = 'reader-article';
	article.id = 'sch-reader-article';
	article.setAttribute('data-annot-ui-root', '');

	let title = doc.title || '';
	let parsed: ReturnType<Readability['parse']> = null;
	try {
		const clone = doc.cloneNode(true) as Document;
		parsed = new Readability(clone).parse();
	} catch (err) {
		console.warn('[reader] Readability parse failed — falling back to raw body', err);
	}

	let text = '';
	if (parsed && parsed.content) {
		title = parsed.title || title;
		const holder = doc.createElement('div');
		holder.innerHTML = parsed.content;
		sanitize(holder);
		while (holder.firstChild) article.appendChild(holder.firstChild);
		text = (parsed.textContent || '').trim();
	} else {
		// Fallback: keep the raw body so annotation still works un-cleaned.
		const body = doc.body.cloneNode(true) as HTMLElement;
		sanitize(body);
		while (body.firstChild) article.appendChild(body.firstChild);
		text = article.textContent?.trim() ?? '';
	}

	// Header block (title + byline/site meta line).
	const header = doc.createElement('header');
	header.className = 'reader-header';
	const h1 = doc.createElement('h1');
	h1.className = 'reader-title';
	h1.textContent = title || 'Untitled';
	header.appendChild(h1);
	const byline = [parsed?.byline, parsed?.siteName].filter(Boolean).join(' · ');
	if (byline) {
		const meta = doc.createElement('p');
		meta.className = 'reader-byline';
		meta.textContent = byline;
		header.appendChild(meta);
	}
	article.insertBefore(header, article.firstChild);

	doc.title = title;
	return { article, title, text };
}

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

let kernel: AnnotationKernel | null = null;

function makeHost(): KernelHost {
	return {
		onHighlightCreated: (hl) => bridge('onHighlightCreated', JSON.stringify(hl)),
		onHighlightUpdated: (hl) => bridge('onHighlightUpdated', JSON.stringify(hl)),
		onHighlightDeleted: (id) => bridge('onHighlightDeleted', id),
		onSelectionState: (json) => bridge('onSelectionState', json),
	};
}

function wireLinks(article: HTMLElement): void {
	document.addEventListener('click', (e) => {
		const target = e.target as Element | null;
		const anchorEl = target?.closest('a[href]');
		if (!anchorEl || !article.contains(anchorEl)) return;
		const href = anchorEl.getAttribute('href') ?? '';
		e.preventDefault();
		e.stopPropagation();
		let abs = href;
		try {
			const url = new URL(href, document.baseURI);
			const sameDoc = url.hash
				&& url.pathname === location.pathname
				&& url.search === location.search;
			if (sameDoc) {
				const id = decodeURIComponent(url.hash.slice(1));
				const dest = document.getElementById(id)
					?? article.querySelector(`[name="${CSS.escape(id)}"]`);
				if (dest) {
					const top = dest.getBoundingClientRect().top + window.scrollY - window.innerHeight / 4;
					window.scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
					return;
				}
			}
			abs = url.href;
		} catch {
			/* not resolvable as a URL — hand it to Kotlin untouched */
		}
		bridge('onLinkTap', abs);
	}, true);
}

function wireScroll(): void {
	let pending = false;
	let last = -1;
	const report = () => {
		pending = false;
		const max = document.documentElement.scrollHeight - window.innerHeight;
		const pct = max > 0 ? Math.min(100, Math.max(0, Math.round((window.scrollY / max) * 100))) : 0;
		if (pct !== last) {
			last = pct;
			bridge('onScrollPct', pct);
		}
	};
	window.addEventListener('scroll', () => {
		if (pending) return;
		pending = true;
		requestAnimationFrame(report);
	}, { passive: true });
	report(); // initial position
}

let readyFired = false;

function boot(): void {
	if (window.__scholiastReaderLoaded) return;
	window.__scholiastReaderLoaded = true;

	const { article } = swapToReaderArticle(document);
	document.body.replaceChildren(article);
	document.documentElement.classList.add('reader-dark');

	kernel = new AnnotationKernel(article, makeHost());
	wireLinks(article);
	wireScroll();

	const api: ReaderAndroidApi = {
		ready(): boolean {
			if (!readyFired) {
				readyFired = true;
				bridge('onReady');
			}
			return true;
		},

		paintHighlights(jsonArrayString: string): number {
			if (!kernel) return 0;
			let parsedList: unknown;
			try {
				parsedList = JSON.parse(jsonArrayString);
			} catch {
				console.warn('[reader] paintHighlights: invalid JSON');
				return 0;
			}
			if (!Array.isArray(parsedList)) return 0;
			const valid = parsedList.filter(isTextHighlight);
			kernel.paintAll(valid);
			return valid.length;
		},

		revealHighlight(id: string): boolean {
			return kernel ? kernel.reveal(id) : false;
		},

		setReaderTheme(opts): void {
			const root = document.documentElement;
			const o = opts ?? {};
			root.classList.toggle('reader-light', o.dark === false);
			root.classList.toggle('reader-dark', o.dark !== false);
			root.classList.toggle('reader-serif', !!o.serif);
			root.classList.toggle('reader-wide', !!o.wide);
			if (typeof o.fontPx === 'number' && o.fontPx >= 10 && o.fontPx <= 40) {
				root.style.setProperty('--reader-font-px', `${Math.round(o.fontPx)}px`);
			}
		},

		getArticleText(): Promise<string> {
			return Promise.resolve(
				document.querySelector('.reader-article')?.textContent?.trim() ?? '',
			);
		},

		/**
		 * Commits whatever selection is live right now as highlight(s) of `color`
		 * (defaults to last-used). Returns the JSON array of created/updated
		 * members, or null when there is no usable selection. Kotlin uses this to
		 * finalize an annotation from its own UI (e.g. after a voice flow).
		 */
		commitPending(color?: HlColor): string | null {
			if (!kernel) return null;
			const c = color && COLORS.includes(color) ? color : undefined;
			const members = kernel.createFromSelection(c ?? 'yellow');
			if (members.length === 0) return null;
			return JSON.stringify(members);
		},
	};

	window.ReaderAndroid = api;
	api.ready(); // DOM swapped + painted → tell Kotlin
}

function isTextHighlight(v: unknown): v is ReaderTextHighlight {
	if (!v || typeof v !== 'object') return false;
	const h = v as Record<string, unknown>;
	return h.type === 'text'
		&& typeof h.id === 'string'
		&& typeof h.xpath === 'string'
		&& typeof h.startOffset === 'number'
		&& typeof h.endOffset === 'number'
		&& (h.color === 'yellow' || h.color === 'red' || h.color === 'green');
}

if (document.readyState === 'loading') {
	document.addEventListener('DOMContentLoaded', boot, { once: true });
} else {
	boot();
}

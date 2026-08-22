// Headless boot-sanity for the android-reader bundle (no browser needed):
// loads test.html's cluttered DOM in linkedom, evals the IIFE, and asserts the
// swap + API surface. Not a unit-test suite — the kernel math is covered by
// shared/anchor.test.ts; this only proves the bundle boots and swaps.
import { parseHTML } from 'linkedom';
import { readFileSync } from 'node:fs';

const html = readFileSync(new URL('../src/android/test/test.html', import.meta.url), 'utf8')
	// strip the asset-loader + bridge-stub scripts; we drive those ourselves
	.replace(/<script>[\s\S]*?<\/script>/g, '');

const { window, document } = parseHTML(html);
window.__scholiastReaderLoaded = false;
globalThis.window = window;
globalThis.document = document;
globalThis.CSS = { highlights: new Map() };
globalThis.Node = window.Node;
globalThis.NodeFilter = window.NodeFilter;
globalThis.requestAnimationFrame = (fn) => setTimeout(fn, 0);
globalThis.location = window.location || { pathname: '/test.html' };

const calls = [];
const noop = (...a) => calls.push(a);
window.AndroidBridge = {
	onReady: () => calls.push(['onReady']),
	onHighlightCreated: noop,
	onHighlightUpdated: noop,
	onHighlightDeleted: noop,
	onLinkTap: noop,
	onScrollPct: noop,
	onSelectionState: noop,
};

const bundle = readFileSync(new URL('../dist-android/android-reader.js', import.meta.url), 'utf8');
new Function(bundle)();

const article = document.querySelector('.reader-article');
const ok = [];
ok.push(['article swapped in', !!article]);
ok.push(['clutter removed', !article.querySelector('.cookie-banner') && !document.querySelector('.ad-slot')]);
ok.push(['title header present', !!article.querySelector('h1.reader-title')]);
ok.push(['ReaderAndroid exposed', !!window.ReaderAndroid]);
ok.push([
	'API surface complete',
	['ready', 'paintHighlights', 'revealHighlight', 'setReaderTheme', 'getArticleText', 'commitPending']
		.every((k) => typeof window.ReaderAndroid[k] === 'function'),
]);
ok.push(['onReady fired', calls.some((c) => c[0] === 'onReady')]);
ok.push(['getArticleText resolves', typeof window.ReaderAndroid.getArticleText().then === 'function']);
window.ReaderAndroid.setReaderTheme({ dark: true, fontPx: 21, serif: true });
ok.push(['setReaderTheme applies vars', document.documentElement.style.getPropertyValue('--reader-font-px') === '21px'
	&& document.documentElement.classList.contains('reader-serif')]);

let failed = 0;
for (const [name, pass] of ok) {
	console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}`);
	if (!pass) failed++;
}
process.exit(failed ? 1 : 0);

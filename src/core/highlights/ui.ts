/**
 * The dashboard's own UI primitives: buttons, tooltips, menus, toasts, dialogs.
 *
 * Everything here replaces a browser default the page used to lean on — native
 * `title` tooltips and `confirm()` dialogs — so feedback looks and behaves like
 * part of the app, is keyboard operable, and can be undone.
 */

const REDUCED = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

// --- DOM helpers -----------------------------------------------------------

export function el<K extends keyof HTMLElementTagNameMap>(
	tag: K, className = '', text?: string
): HTMLElementTagNameMap[K] {
	const node = document.createElement(tag);
	if (className) node.className = className;
	if (text !== undefined) node.textContent = text;
	return node;
}

export function icon(name: string, className = ''): HTMLSpanElement {
	const s = el('span', `material-symbols-outlined sc-i${className ? ' ' + className : ''}`);
	s.textContent = name;
	s.setAttribute('aria-hidden', 'true');
	return s;
}

export function $(id: string): HTMLElement {
	const node = document.getElementById(id);
	if (!node) throw new Error(`Missing element #${id}`);
	return node;
}

/** A tooltip that is also the accessible name, since these buttons are icon-only. */
export function tip(node: HTMLElement, text: string): void {
	node.dataset.tip = text;
	if (!node.getAttribute('aria-label')) node.setAttribute('aria-label', text);
}

export interface ButtonOpts {
	label?: string;
	iconName?: string;
	/** Trailing icon, e.g. a menu chevron. */
	iconAfter?: string;
	variant?: 'ghost' | 'quiet' | 'solid' | 'danger';
	tooltip?: string;
	onClick?: (e: MouseEvent) => void;
}

export function button(opts: ButtonOpts): HTMLButtonElement {
	const b = el('button', `sc-btn sc-btn--${opts.variant || 'ghost'}${opts.label ? '' : ' sc-btn--icon'}`);
	b.type = 'button';
	if (opts.iconName) b.appendChild(icon(opts.iconName));
	if (opts.label) b.appendChild(el('span', 'sc-btn__label', opts.label));
	if (opts.iconAfter) b.appendChild(icon(opts.iconAfter, 'sc-i--after'));
	if (opts.tooltip) tip(b, opts.tooltip);
	else if (opts.label) b.setAttribute('aria-label', opts.label);
	if (opts.onClick) b.addEventListener('click', opts.onClick);
	return b;
}

/**
 * A site's favicon at an exact box size. The fallback is an icon *font* glyph, so
 * it's sized with `font-size` — width/height utilities don't apply to it, which is
 * why the old fallback rendered oversized and knocked rows out of alignment.
 */
export function favicon(src: string | undefined, size = 16): HTMLElement {
	const globe = () => {
		const s = icon('language', 'sc-favicon sc-favicon--fallback');
		s.style.setProperty('--sc-favicon-size', `${size}px`);
		return s;
	};
	if (!src) return globe();
	const img = el('img', 'sc-favicon');
	img.style.setProperty('--sc-favicon-size', `${size}px`);
	img.src = src;
	img.alt = '';
	img.referrerPolicy = 'no-referrer';
	img.addEventListener('error', () => img.replaceWith(globe()), { once: true });
	return img;
}

// --- Tooltip ---------------------------------------------------------------

let tipNode: HTMLElement | null = null;
let tipTimer = 0;
let tipLastHidden = 0;

function ensureTip(): HTMLElement {
	if (!tipNode) {
		tipNode = el('div', 'sc-tip');
		tipNode.setAttribute('role', 'tooltip');
		document.body.appendChild(tipNode);
	}
	return tipNode;
}

function showTip(target: HTMLElement, instant: boolean): void {
	const text = target.dataset.tip;
	if (!text) return;
	const node = ensureTip();
	node.textContent = text;
	node.classList.toggle('sc-tip--instant', instant);
	node.classList.add('sc-tip--on');
	// Measure after the text is in, then clamp to the viewport.
	const r = target.getBoundingClientRect();
	const t = node.getBoundingClientRect();
	const above = r.top > t.height + 12;
	node.style.top = `${above ? r.top - t.height - 6 : r.bottom + 6}px`;
	node.style.left = `${Math.min(
		Math.max(8, r.left + r.width / 2 - t.width / 2),
		window.innerWidth - t.width - 8,
	)}px`;
}

function hideTip(): void {
	window.clearTimeout(tipTimer);
	if (tipNode?.classList.contains('sc-tip--on')) tipLastHidden = Date.now();
	tipNode?.classList.remove('sc-tip--on');
}

function installTooltips(): void {
	const enter = (e: Event) => {
		const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
		if (!target) return;
		window.clearTimeout(tipTimer);
		// Once one tooltip has been up, neighbours open instantly — the delay only
		// exists to stop accidental flashes on the way to somewhere else.
		const instant = Date.now() - tipLastHidden < 400;
		if (instant) showTip(target, true);
		else tipTimer = window.setTimeout(() => showTip(target, false), 380);
	};
	document.addEventListener('mouseover', enter);
	document.addEventListener('focusin', (e) => {
		const target = (e.target as HTMLElement | null)?.closest<HTMLElement>('[data-tip]');
		if (target?.matches(':focus-visible')) showTip(target, true);
	});
	document.addEventListener('mouseout', hideTip);
	document.addEventListener('focusout', hideTip);
	document.addEventListener('click', hideTip);
	window.addEventListener('scroll', hideTip, true);
}

// --- Menu ------------------------------------------------------------------

export type MenuItem =
	| { type: 'sep' }
	| { type: 'label'; text: string }
	| {
		type: 'item'; label: string; iconName?: string; hint?: string;
		danger?: boolean; disabled?: boolean; checked?: boolean; onSelect: () => void;
	}
	| { type: 'submenu'; label: string; iconName?: string; items: () => MenuItem[] }
	| {
		type: 'swatches'; label: string;
		options: { value: string; name: string; active: boolean }[];
		onSelect: (value: string) => void;
	};

let openMenuNode: HTMLElement | null = null;
let menuCloser: (() => void) | null = null;

export function closeMenu(): void { menuCloser?.(); }

export function openMenu(anchor: HTMLElement, items: MenuItem[], align: 'start' | 'end' = 'end'): void {
	closeMenu();
	const panel = el('div', 'sc-menu');
	panel.setAttribute('role', 'menu');
	const stack: { items: MenuItem[]; title?: string }[] = [{ items }];

	const close = () => {
		if (openMenuNode !== panel) return;
		openMenuNode = null;
		menuCloser = null;
		panel.classList.remove('sc-menu--on');
		anchor.setAttribute('aria-expanded', 'false');
		document.removeEventListener('mousedown', onOutside, true);
		document.removeEventListener('keydown', onKey, true);
		window.removeEventListener('resize', close);
		window.removeEventListener('scroll', close, true);
		const done = () => panel.remove();
		if (REDUCED()) done();
		else panel.addEventListener('transitionend', done, { once: true });
		window.setTimeout(done, 220);
		(anchor as HTMLElement).focus({ preventScroll: true });
	};

	const onOutside = (e: Event) => {
		if (!panel.contains(e.target as Node) && !anchor.contains(e.target as Node)) close();
	};

	const focusables = () => Array.from(panel.querySelectorAll<HTMLElement>('.sc-menu__item:not([aria-disabled="true"]), .sc-swatch'));

	const onKey = (e: KeyboardEvent) => {
		const list = focusables();
		const at = list.indexOf(document.activeElement as HTMLElement);
		if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
		else if (e.key === 'ArrowDown') { e.preventDefault(); list[(at + 1) % list.length]?.focus(); }
		else if (e.key === 'ArrowUp') { e.preventDefault(); list[(at - 1 + list.length) % list.length]?.focus(); }
		else if (e.key === 'Home') { e.preventDefault(); list[0]?.focus(); }
		else if (e.key === 'End') { e.preventDefault(); list[list.length - 1]?.focus(); }
		else if (e.key === 'ArrowLeft' && stack.length > 1) { e.preventDefault(); stack.pop(); paint(); }
	};

	function paint(): void {
		panel.replaceChildren();
		const level = stack[stack.length - 1];
		if (stack.length > 1) {
			const back = el('button', 'sc-menu__back');
			back.type = 'button';
			back.appendChild(icon('chevron_left'));
			back.appendChild(el('span', '', level.title || 'Back'));
			back.addEventListener('click', () => { stack.pop(); paint(); });
			panel.appendChild(back);
		}
		for (const item of level.items) {
			if (item.type === 'sep') { panel.appendChild(el('div', 'sc-menu__sep')); continue; }
			if (item.type === 'label') { panel.appendChild(el('div', 'sc-menu__label', item.text)); continue; }
			if (item.type === 'swatches') {
				const row = el('div', 'sc-menu__swatches');
				row.appendChild(el('span', 'sc-menu__label', item.label));
				const group = el('div', 'sc-swatches');
				for (const opt of item.options) {
					const sw = el('button', `sc-swatch${opt.active ? ' is-active' : ''}`);
					sw.type = 'button';
					sw.style.setProperty('--sw', opt.value);
					tip(sw, opt.name);
					sw.addEventListener('click', () => { close(); item.onSelect(opt.value); });
					group.appendChild(sw);
				}
				row.appendChild(group);
				panel.appendChild(row);
				continue;
			}
			const row = el('button', `sc-menu__item${item.type === 'item' && item.danger ? ' is-danger' : ''}`);
			row.type = 'button';
			row.setAttribute('role', 'menuitem');
			row.appendChild(item.iconName ? icon(item.iconName) : el('span', 'sc-i sc-i--blank'));
			row.appendChild(el('span', 'sc-menu__text', item.label));
			if (item.type === 'item') {
				if (item.checked) row.appendChild(icon('check', 'sc-menu__check'));
				else if (item.hint) row.appendChild(el('span', 'sc-menu__hint', item.hint));
				if (item.disabled) row.setAttribute('aria-disabled', 'true');
				else row.addEventListener('click', () => { close(); item.onSelect(); });
			} else {
				row.appendChild(icon('chevron_right', 'sc-menu__more'));
				row.addEventListener('click', () => {
					stack.push({ items: item.items(), title: item.label });
					paint();
					focusables()[0]?.focus();
				});
			}
			panel.appendChild(row);
		}
	}

	paint();
	document.body.appendChild(panel);

	// Place under the trigger, flipped up when there isn't room, and scaled from
	// the corner it grows out of.
	const r = anchor.getBoundingClientRect();
	const size = panel.getBoundingClientRect();
	const below = window.innerHeight - r.bottom > size.height + 16 || r.top < size.height + 16;
	const left = align === 'end'
		? Math.max(8, Math.min(r.right - size.width, window.innerWidth - size.width - 8))
		: Math.max(8, Math.min(r.left, window.innerWidth - size.width - 8));
	panel.style.left = `${left}px`;
	panel.style.top = `${below ? r.bottom + 6 : r.top - size.height - 6}px`;
	panel.style.transformOrigin = `${align === 'end' ? 'right' : 'left'} ${below ? 'top' : 'bottom'}`;

	openMenuNode = panel;
	menuCloser = close;
	anchor.setAttribute('aria-expanded', 'true');
	requestAnimationFrame(() => panel.classList.add('sc-menu--on'));
	focusables()[0]?.focus({ preventScroll: true });
	document.addEventListener('mousedown', onOutside, true);
	document.addEventListener('keydown', onKey, true);
	window.addEventListener('resize', close);
	window.addEventListener('scroll', close, true);
}

/** Wire a button so it opens a menu built fresh on each click. */
export function menuButton(b: HTMLButtonElement, items: () => MenuItem[], align: 'start' | 'end' = 'end'): HTMLButtonElement {
	b.setAttribute('aria-haspopup', 'menu');
	b.setAttribute('aria-expanded', 'false');
	b.addEventListener('click', (e) => {
		e.stopPropagation();
		if (b.getAttribute('aria-expanded') === 'true') { closeMenu(); return; }
		openMenu(b, items(), align);
	});
	return b;
}

// --- Toast ----------------------------------------------------------------

let toastHost: HTMLElement | null = null;

export interface ToastOpts {
	message: string;
	actionLabel?: string;
	onAction?: () => void;
	/** ms; 0 keeps it until dismissed. */
	duration?: number;
}

export function toast(opts: ToastOpts): void {
	if (!toastHost) {
		toastHost = el('div', 'sc-toasts');
		toastHost.setAttribute('aria-live', 'polite');
		document.body.appendChild(toastHost);
	}
	const node = el('div', 'sc-toast');
	node.appendChild(el('span', 'sc-toast__msg', opts.message));
	let timer = 0;
	const dismiss = () => {
		window.clearTimeout(timer);
		node.classList.remove('sc-toast--on');
		const done = () => node.remove();
		if (REDUCED()) done();
		else node.addEventListener('transitionend', done, { once: true });
		window.setTimeout(done, 300);
	};
	if (opts.actionLabel && opts.onAction) {
		const act = el('button', 'sc-toast__action', opts.actionLabel);
		act.type = 'button';
		act.addEventListener('click', () => { dismiss(); opts.onAction!(); });
		node.appendChild(act);
	}
	const x = button({ iconName: 'close', tooltip: 'Dismiss', onClick: dismiss });
	x.classList.add('sc-toast__close');
	node.appendChild(x);

	toastHost.appendChild(node);
	requestAnimationFrame(() => node.classList.add('sc-toast--on'));

	const duration = opts.duration ?? 6000;
	if (duration > 0) {
		const start = () => { timer = window.setTimeout(dismiss, duration); };
		// Reaching for Undo shouldn't be a race.
		node.addEventListener('mouseenter', () => window.clearTimeout(timer));
		node.addEventListener('mouseleave', start);
		start();
	}
}

// --- Dialog ---------------------------------------------------------------

export interface ConfirmOpts {
	title: string;
	body?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	danger?: boolean;
	/** Require typing this exact word — for irreversible, wide-scope deletes. */
	requireWord?: string;
}

export function confirmDialog(opts: ConfirmOpts): Promise<boolean> {
	return new Promise((resolve) => {
		const previous = document.activeElement as HTMLElement | null;
		const backdrop = el('div', 'sc-backdrop');
		const panel = el('div', 'sc-dialog');
		panel.setAttribute('role', 'dialog');
		panel.setAttribute('aria-modal', 'true');

		const heading = el('h2', 'sc-dialog__title', opts.title);
		heading.id = 'sc-dialog-title';
		panel.setAttribute('aria-labelledby', heading.id);
		panel.appendChild(heading);
		if (opts.body) panel.appendChild(el('p', 'sc-dialog__body', opts.body));

		let field: HTMLInputElement | null = null;
		if (opts.requireWord) {
			const label = el('label', 'sc-dialog__field');
			label.appendChild(el('span', '', `Type ${opts.requireWord} to confirm`));
			field = el('input', 'sc-input');
			field.type = 'text';
			field.autocomplete = 'off';
			field.spellcheck = false;
			label.appendChild(field);
			panel.appendChild(label);
		}

		const row = el('div', 'sc-dialog__actions');
		const cancel = button({ label: opts.cancelLabel || 'Cancel', variant: 'quiet' });
		const ok = button({
			label: opts.confirmLabel || 'Confirm',
			variant: opts.danger ? 'danger' : 'solid',
		});
		row.append(cancel, ok);
		panel.appendChild(row);

		const finish = (value: boolean) => {
			document.removeEventListener('keydown', onKey, true);
			backdrop.classList.remove('sc-backdrop--on');
			const done = () => backdrop.remove();
			if (REDUCED()) done();
			else backdrop.addEventListener('transitionend', done, { once: true });
			window.setTimeout(done, 260);
			previous?.focus({ preventScroll: true });
			resolve(value);
		};

		const sync = () => {
			if (!field) return;
			ok.disabled = field.value.trim().toLowerCase() !== opts.requireWord!.toLowerCase();
		};

		const onKey = (e: KeyboardEvent) => {
			if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finish(false); return; }
			if (e.key === 'Enter' && !ok.disabled) { e.preventDefault(); finish(true); return; }
			if (e.key !== 'Tab') return;
			// Keep focus inside the dialog.
			const list = Array.from(panel.querySelectorAll<HTMLElement>('button:not(:disabled), input'));
			if (list.length === 0) return;
			const first = list[0];
			const last = list[list.length - 1];
			if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
			else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
		};

		cancel.addEventListener('click', () => finish(false));
		ok.addEventListener('click', () => finish(true));
		backdrop.addEventListener('mousedown', (e) => { if (e.target === backdrop) finish(false); });
		field?.addEventListener('input', sync);

		backdrop.appendChild(panel);
		document.body.appendChild(backdrop);
		sync();
		requestAnimationFrame(() => backdrop.classList.add('sc-backdrop--on'));
		(field || (opts.danger ? cancel : ok)).focus({ preventScroll: true });
		document.addEventListener('keydown', onKey, true);
	});
}

// --- Screen-reader announcements ------------------------------------------

let liveRegion: HTMLElement | null = null;

export function announce(message: string): void {
	if (!liveRegion) {
		liveRegion = el('div', 'sc-sr-only');
		liveRegion.setAttribute('aria-live', 'polite');
		liveRegion.setAttribute('role', 'status');
		document.body.appendChild(liveRegion);
	}
	// Re-set to the same text still needs to fire, so clear first.
	liveRegion.textContent = '';
	window.setTimeout(() => { if (liveRegion) liveRegion.textContent = message; }, 30);
}

// --- Clipboard ------------------------------------------------------------

export async function copyText(text: string, what: string): Promise<void> {
	try {
		await navigator.clipboard.writeText(text);
		toast({ message: `${what} copied`, duration: 2200 });
	} catch {
		toast({ message: `Couldn't copy ${what.toLowerCase()}`, duration: 3000 });
	}
}

// --- Search match marking -------------------------------------------------

/**
 * Wrap every occurrence of `query` inside an already-rendered subtree in `<mark>`,
 * so a search tells you *where* it matched instead of just which cards survived.
 * Walks text nodes only — the surrounding markup is left exactly as it was.
 */
export function markMatches(root: HTMLElement, query: string): void {
	if (!query) return;
	const needle = query.toLowerCase();
	const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
	const targets: Text[] = [];
	let node = walker.nextNode() as Text | null;
	while (node) {
		if (node.nodeValue && node.nodeValue.toLowerCase().includes(needle)) targets.push(node);
		node = walker.nextNode() as Text | null;
	}
	for (const text of targets) {
		const value = text.nodeValue || '';
		const frag = document.createDocumentFragment();
		let at = 0;
		for (;;) {
			const found = value.toLowerCase().indexOf(needle, at);
			if (found < 0) break;
			if (found > at) frag.appendChild(document.createTextNode(value.slice(at, found)));
			frag.appendChild(el('mark', 'sc-hit', value.slice(found, found + needle.length)));
			at = found + needle.length;
		}
		if (at < value.length) frag.appendChild(document.createTextNode(value.slice(at)));
		text.replaceWith(frag);
	}
}

export function installUi(): void {
	installTooltips();
}

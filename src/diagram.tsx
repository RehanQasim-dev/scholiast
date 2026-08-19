import React, { useState, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob, convertToExcalidrawElements } from '@excalidraw/excalidraw';
import browser from 'webextension-polyfill';
import { saveDiagramImage, hasDiagramImage } from './utils/video/frame-store';

/**
 * The Excalidraw editor window. Two things open it:
 *   - a comment's diagram button — a blank canvas, saved back as a diagram comment
 *   - the Excalidraw button on a highlighted image's action bar — the page image is
 *     seeded onto the canvas, and the export replaces that image on the page
 *
 * Either way the scene is stored under `diagrams[id]` and the rendered PNG in the
 * `diagrams` blob store, so re-opening continues from the last save.
 */

const params = new URLSearchParams(window.location.search);
const diagramId = params.get('id');
// Set only for an image edit: the highlight whose picture is being redrawn.
const highlightId = params.get('highlight');
const pageUrl = params.get('page') || '';

interface Seed { dataUrl: string; mimeType: string; width: number; height: number }

// A scene holding just the page image, scaled to a comfortable canvas size.
function sceneFromSeed(seed: Seed) {
	const fileId = `seed-${diagramId}`;
	const maxSide = 1000;
	const w = seed.width || maxSide;
	const h = seed.height || maxSide;
	const scale = Math.min(1, maxSide / Math.max(w, h));
	return {
		elements: convertToExcalidrawElements([{
			type: 'image',
			fileId: fileId as any,
			x: 0,
			y: 0,
			width: Math.round(w * scale),
			height: Math.round(h * scale),
		} as any]),
		files: {
			[fileId]: {
				id: fileId as any,
				mimeType: (seed.mimeType || 'image/png') as any,
				dataURL: seed.dataUrl as any,
				created: Date.now(),
			},
		},
		appState: { viewBackgroundColor: '#ffffff' },
		scrollToContent: true,
	};
}

function App() {
	const [initialData, setInitialData] = useState<any>(null);
	const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
	const [isReady, setIsReady] = useState(false);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (!diagramId) { setIsReady(true); return; }
		const seedKey = `diagramSeed:${diagramId}`;
		void browser.storage.local.get(['diagrams', seedKey]).then(async (res: any) => {
			const saved = ((res.diagrams || {}) as Record<string, any>)[diagramId];
			if (saved?.sceneData) {
				setInitialData(saved.sceneData);
			} else if (res[seedKey]) {
				setInitialData(sceneFromSeed(res[seedKey] as Seed));
			}
			// The seed has served its purpose either way; the scene now holds the image.
			if (res[seedKey]) await browser.storage.local.remove(seedKey);
			setIsReady(true);
		});
	}, []);

	// A text element being typed lives in an overlay textarea and is only committed to
	// the scene when that textarea loses focus. Saving straight from the button left
	// the last thing written out of the exported PNG — which read as "my changes
	// weren't saved", right up until the next save picked them up.
	const commitPendingEdits = async () => {
		const active = document.activeElement as HTMLElement | null;
		if (active && (active.tagName === 'TEXTAREA' || active.isContentEditable)) active.blur();
		await new Promise<void>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
	};

	const save = async () => {
		if (!excalidrawAPI || !diagramId || saving) return;
		setSaving(true);
		setError(null);
		try {
			await commitPendingEdits();

			const elements = excalidrawAPI.getSceneElements();
			const appState = excalidrawAPI.getAppState();
			const files = excalidrawAPI.getFiles();

			const blob = await exportToBlob({ elements, appState, files, mimeType: 'image/png' });
			const dataUrl = await new Promise<string>((resolve, reject) => {
				const reader = new FileReader();
				reader.onloadend = () => resolve(reader.result as string);
				reader.onerror = () => reject(reader.error);
				reader.readAsDataURL(blob);
			});

			// The rendered PNG goes to the IndexedDB blob store (keyed by diagram id);
			// storage.local keeps only the editable scene + a timestamp. This keeps the
			// image out of every JSON payload (storage + sync) — see frame-store.
			//
			// Order matters, and each step is confirmed before the next: the bytes are
			// written and read back, THEN the metadata is published, THEN the window
			// closes. Announcing a save whose bytes hadn't landed is what made a save
			// silently show the previous drawing until it was saved a second time.
			await saveDiagramImage(diagramId, dataUrl);
			if (!(await hasDiagramImage(diagramId))) {
				throw new Error('The drawing could not be stored. Try saving again.');
			}

			const sceneData = {
				elements,
				appState: { viewBackgroundColor: appState.viewBackgroundColor },
				files,
			};
			const res = await browser.storage.local.get('diagrams');
			const diagrams = (res.diagrams || {}) as Record<string, any>;
			diagrams[diagramId] = {
				...diagrams[diagramId],
				sceneData,
				updatedAt: Date.now(),
				...(highlightId ? { imageForHighlight: highlightId } : {}),
				...(pageUrl ? { pageUrl } : {}),
			};
			await browser.storage.local.set({ diagrams });

			// Tell the page directly, with the PNG in hand, instead of leaving it to
			// notice the storage write and read the bytes back for itself.
			await browser.runtime.sendMessage({
				action: 'diagramSaved',
				id: diagramId,
				dataUrl,
				...(highlightId ? { highlightId } : {}),
			}).catch(() => { /* no receiver — the storage listener still covers it */ });

			window.close();
		} catch (e) {
			setError(e instanceof Error ? e.message : String(e));
			setSaving(false);
		}
	};

	if (!isReady) return null;

	return (
		<>
			<div className="top-bar">
				{error && <span className="save-error" role="alert">{error}</span>}
				<button onClick={save} disabled={saving}>
					{saving ? 'Saving…' : 'Save & Close'}
				</button>
			</div>
			<div style={{ height: '100%' }}>
				<Excalidraw
					initialData={initialData}
					excalidrawAPI={(api: any) => setExcalidrawAPI(api)}
					theme="dark"
				/>
			</div>
		</>
	);
}

const root = createRoot(document.getElementById('app')!);
root.render(<App />);

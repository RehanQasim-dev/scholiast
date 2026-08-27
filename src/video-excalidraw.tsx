import { useState, useEffect, useRef } from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw, exportToBlob } from '@excalidraw/excalidraw';
import * as Icons from './excalidraw-icons';

function App() {
	const lockedViewRef = useRef<{scrollX: number, scrollY: number, zoom: number} | null>(null);
	const [excalidrawAPI, setExcalidrawAPI] = useState<any>(null);
	const excalidrawAPIRef = useRef<any>(null);
	const [frameDataUrl, setFrameDataUrl] = useState<string | null>(null);
	const [frameSize, setFrameSize] = useState({ w: 0, h: 0 });
	// Bumped on every INIT_FRAME so the scene-setup effect re-runs even when the
	// captured frame is byte-identical to the last one (recapturing the SAME paused
	// timestamp yields the same dataURL — React would otherwise bail on the
	// unchanged state and never re-post FRAME_RENDERED, leaving the host to reveal
	// the iframe only via its slow 700ms fallback).
	const [initSeq, setInitSeq] = useState(0);
	
	const [appState, setAppState] = useState<any>({
		activeTool: { type: 'freedraw' },
		currentItemStrokeColor: '#ffeb3b',
		currentItemBackgroundColor: 'transparent',
		currentItemStrokeWidth: 1,
		currentItemStrokeStyle: 'solid',
		currentItemRoughness: 1,
		currentItemRoundness: 'sharp',
		currentItemFillStyle: 'hachure'
	});
	const [, setSelectedElements] = useState<any[]>([]);
	const [activePopup, setActivePopup] = useState<string | null>(null);
	const [tempSelectedValue, setTempSelectedValue] = useState<any>(null);
	const [activeToolType, setActiveToolType] = useState<string>('selection');
	const [dimOpacity, setDimOpacity] = useState<number>(15);
	
	// Vertical bands (px) reserved at top and bottom so the top toolbar,
	// action buttons, properties dock, undo/redo, and dim slider do not overlap
	// the snapshot image. With 30px docks at 6px margin, reserving 38px leaves
	// a clean 2px breathing gap with zero overlap.
	const TOP_BAND = 38;
	const BOTTOM_BAND = 38;

	const handleApiChange = (api: any) => {
		setExcalidrawAPI(api);
		excalidrawAPIRef.current = api;
	};

	const save = async (action: 'save' | 'comment') => {
		const api = excalidrawAPIRef.current || excalidrawAPI;
		if (!api) {
			console.warn('[vid-excali] save called before API ready');
			return;
		}
		const elements = api.getSceneElements();
		const state = api.getAppState();
		const files = api.getFiles();
		
		try {
			const blob = await exportToBlob({
				elements,
				mimeType: 'image/jpeg',
				appState: { ...state, exportBackground: true },
				files
			});
			
			const reader = new FileReader();
			reader.onloadend = () => {
				const bakedDataUrl = reader.result as string;
				window.parent.postMessage({ 
					type: 'SAVE_ANNOTATION', 
					action, 
					sceneData: { 
						elements, 
						appState: { viewBackgroundColor: state.viewBackgroundColor }, 
						files,
						bakedDataUrl
					} 
				}, '*');
			};
			reader.readAsDataURL(blob as Blob);
		} catch (e) {
			console.error('[vid-excali] Failed to export Excalidraw scene to blob:', e);
			window.parent.postMessage({ type: 'SAVE_ANNOTATION', action, sceneData: { elements, appState: { viewBackgroundColor: state.viewBackgroundColor }, files } }, '*');
		}
	};

	const discard = () => {
		window.parent.postMessage({ type: 'DISCARD_ANNOTATION' }, '*');
	};

	useEffect(() => {
		const handleMessage = (e: MessageEvent) => {
			if (e.data?.type === 'INIT_FRAME') {
				setFrameDataUrl(e.data.dataUrl);
				setFrameSize({ w: e.data.w, h: e.data.h });
				setInitSeq(s => s + 1);
			} else if (e.data?.type === 'TRIGGER_SAVE') {
				save('save');
			} else if (e.data?.type === 'TRIGGER_COMMENT') {
				save('comment');
			} else if (e.data?.type === 'TRIGGER_DISCARD') {
				discard();
			} else if (e.data?.type === 'TRIGGER_TOOL' && e.data?.tool) {
				const api = excalidrawAPIRef.current || excalidrawAPI;
				if (api) {
					api.setActiveTool({ type: e.data.tool });
				}
			} else if (e.data?.type === 'TRIGGER_CYCLE_STROKE') {
				cycleProp('currentItemStrokeColor', colors);
			}
		};
		window.addEventListener('message', handleMessage);
		
		const blockWheel = (e: WheelEvent) => {
			if (!e.ctrlKey) { // let pinch-to-zoom through if they really want, but lockedView will snap it back
				e.preventDefault();
				e.stopPropagation();
			}
		};
		window.addEventListener('wheel', blockWheel, { passive: false });
		
		window.parent.postMessage({ type: 'EXCALIDRAW_READY' }, '*');
		return () => {
			window.removeEventListener('message', handleMessage);
			window.removeEventListener('wheel', blockWheel);
		};
	}, [excalidrawAPI]);

	useEffect(() => {
		const kb = (navigator as unknown as { keyboard?: { lock?: (k: string[]) => Promise<void> } }).keyboard;
		if (kb?.lock) {
			kb.lock(['Escape']).catch(() => {});
		}
	}, []);

	useEffect(() => {
		const handleResize = () => {
			if (!excalidrawAPI || !frameDataUrl) return;
			const W = window.innerWidth, H = window.innerHeight;
			const regionH = Math.max(1, H - TOP_BAND - BOTTOM_BAND);
			const zoom = Math.min(W / frameSize.w, regionH / frameSize.h);
			const dispW = frameSize.w * zoom, dispH = frameSize.h * zoom;
			const offX = (W - dispW) / 2;
			const offY = TOP_BAND + (regionH - dispH) / 2;

			const scrollX = offX / zoom;
			const scrollY = offY / zoom;
			lockedViewRef.current = { scrollX, scrollY, zoom };

			excalidrawAPI.updateScene({
				appState: { zoom: { value: zoom }, scrollX, scrollY }
			});
		};
		window.addEventListener('resize', handleResize);
		return () => window.removeEventListener('resize', handleResize);
	}, [excalidrawAPI, frameDataUrl, frameSize]);

	useEffect(() => {
		if (!excalidrawAPI || !frameDataUrl) return;
		try {
		const fileId = 'frame-img-' + Date.now();

		// Reset any prior scene first — the iframe is pooled and reused across
		// captures, so we must clear the previous frame + drawings.
		excalidrawAPI.updateScene({ elements: [] });

		// The captured JPEG is already a dataURL: hand it straight to Excalidraw,
		// no fetch→blob→FileReader round-trip.
		excalidrawAPI.addFiles([{
			id: fileId, dataURL: frameDataUrl, mimeType: 'image/jpeg',
			created: Date.now(), lastRetrieved: Date.now()
		}]);

		const elements = [{
			type: 'image', version: 1, versionNonce: Date.now(), isDeleted: false,
			id: 'bg-image', fillStyle: 'hachure', strokeWidth: 1, strokeStyle: 'solid',
			roughness: 1, opacity: 100, angle: 0, x: 0, y: 0,
			width: frameSize.w, height: frameSize.h, seed: 1, groupIds: [],
			frameId: null, roundness: null, boundElements: [], updated: Date.now(),
			link: null, locked: true, fileId: fileId, scale: [1, 1]
		}, {
			type: 'rectangle', version: 1, versionNonce: Date.now(), isDeleted: false,
			id: 'bg-dim', backgroundColor: '#010101', fillStyle: 'solid', strokeWidth: 0, strokeStyle: 'solid',
			strokeColor: 'transparent', roughness: 0, opacity: dimOpacity, angle: 0, x: 0, y: 0,
			width: frameSize.w, height: frameSize.h, seed: 1, groupIds: [],
			frameId: null, roundness: null, boundElements: [], updated: Date.now(),
			link: null, locked: true
		}];

		// Place the frame deterministically (no fitToViewport, which pads/scales
		// unpredictably): fit it into the region between the top/bottom bands and
		// lock zoom+scroll so scene units map 1:1 onto the visible picture.
		const W = window.innerWidth, H = window.innerHeight;
		const regionH = Math.max(1, H - TOP_BAND - BOTTOM_BAND);
		const zoom = Math.min(W / frameSize.w, regionH / frameSize.h);
		const dispW = frameSize.w * zoom, dispH = frameSize.h * zoom;
		const offX = (W - dispW) / 2;
		const offY = TOP_BAND + (regionH - dispH) / 2;

		const scrollX = offX / zoom;
		const scrollY = offY / zoom;
		lockedViewRef.current = { scrollX, scrollY, zoom };

		excalidrawAPI.updateScene({
			elements,
			appState: { zoom: { value: zoom }, scrollX, scrollY }
		});
		excalidrawAPI.setActiveTool({ type: 'freedraw' });

		// Tell the host the scene is set so it can reveal the iframe. Post
		// immediately — the iframe is visibility:hidden while off-screen, and Chrome
		// throttles requestAnimationFrame there, so a rAF-gated signal can never
		// arrive. The scene is already applied synchronously above, so the first
		// paint after the host flips visibility will show content.
		window.parent.postMessage({ type: 'FRAME_RENDERED' }, '*');
		} catch (err) {
			console.error('[vid-excali] image setup failed', err);
			window.parent.postMessage({ type: 'FRAME_RENDERED' }, '*');
		}
	}, [excalidrawAPI, frameDataUrl, initSeq]);

	const cycleProp = (key: string, optionsList: any[]) => {
		const api = excalidrawAPIRef.current || excalidrawAPI;
		if (!api) return;
		const state = api.getAppState();
		const current = activePopup === key ? tempSelectedValue : state[key];
		let currentIndex = optionsList.findIndex(o => {
			if (key === 'currentItemRoundness') {
				const val = current === null ? 'sharp' : current?.type === 2 ? 'round' : 'elbow';
				return o.val === val;
			}
			return o.val === current || o.value === current;
		});
		if (currentIndex === -1) currentIndex = 0;
		const nextIndex = (currentIndex + 1) % optionsList.length;
		
		setActivePopup(key);
		setTempSelectedValue(optionsList[nextIndex].val ?? optionsList[nextIndex].value);
	};

	useEffect(() => {
		const handleKeyDown = (e: KeyboardEvent) => {
			const activeTag = document.activeElement?.tagName;
			const isTextEditing = activeTag === 'INPUT' || activeTag === 'TEXTAREA' || 
			                      document.activeElement?.getAttribute('contenteditable') === 'true' ||
			                      document.activeElement?.classList?.contains('excalidraw-text-editor');

			if (isTextEditing) {
				if (e.key === 'Escape') return;
				return;
			}
			if (e.code === 'Space') {
				e.preventDefault();
				e.stopPropagation();
				return;
			}
			const k = e.key.toLowerCase();
			const TOOL_SHORTCUTS: Record<string, string> = {
				'1': 'selection', 'v': 'selection',
				'2': 'rectangle', 'r': 'rectangle',
				'3': 'diamond',   'd': 'diamond',
				'4': 'ellipse',   'o': 'ellipse',
				'5': 'arrow',     'a': 'arrow',
				'6': 'line',      'l': 'line',
				'7': 'freedraw',  'p': 'freedraw',
				'8': 'text',      't': 'text',
				'9': 'image',
				'0': 'eraser',    'e': 'eraser',
				'h': 'hand',
			};

			if (e.key === 'Enter') { 
				e.preventDefault(); e.stopPropagation(); 
				if (activePopup) {
					updateProp(activePopup, tempSelectedValue);
					setActivePopup(null);
				} else {
					save('save'); 
				}
			}
			else if (e.key === 'Escape') { 
				e.preventDefault(); e.stopPropagation(); 
				if (activePopup) setActivePopup(null);
				discard(); 
			}
			else if (k === 'c' || k === 'n') { 
				if (activePopup) return;
				e.preventDefault(); e.stopPropagation(); 
				save('comment'); 
			}
			else if (k === 's') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemStrokeColor', colors); }
			else if (k === 'g') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemBackgroundColor', colors); }
			else if (k === 'f') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemFillStyle', fillStyles); }
			else if (k === 'w') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemStrokeWidth', strokeWidths); }
			else if (k === 'x') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemStrokeStyle', strokeStyles); }
			else if (k === 'q') { e.preventDefault(); e.stopPropagation(); cycleProp('currentItemOpacity', opacities); }
			else if (TOOL_SHORTCUTS[k] && !e.ctrlKey && !e.metaKey && !e.altKey && !activePopup) {
				const api = excalidrawAPIRef.current || excalidrawAPI;
				if (api) {
					e.preventDefault();
					e.stopPropagation();
					api.setActiveTool({ type: TOOL_SHORTCUTS[k] });
				}
			}
		};
		window.addEventListener('keydown', handleKeyDown, true);
		return () => window.removeEventListener('keydown', handleKeyDown, true);
	}, [excalidrawAPI, activePopup, tempSelectedValue]);

	useEffect(() => {
		const api = excalidrawAPIRef.current || excalidrawAPI;
		if (!api) return;
		const elements = api.getSceneElements();
		const dimEl = elements.find((el: any) => el.id === 'bg-dim');
		if (dimEl && dimEl.opacity !== dimOpacity) {
			const updated = elements.map((el: any) => el.id === 'bg-dim' ? { ...el, opacity: dimOpacity, version: (el.version || 1) + 1, versionNonce: Date.now() } : el);
			api.updateScene({ elements: updated });
		}
	}, [dimOpacity, excalidrawAPI]);

	const handleExcalidrawChange = (elements: readonly any[], state: any) => {
		if (lockedViewRef.current && excalidrawAPI) {
			const lv = lockedViewRef.current;
			if (Math.abs(state.scrollX - lv.scrollX) > 0.5 || 
				Math.abs(state.scrollY - lv.scrollY) > 0.5 || 
				Math.abs(state.zoom.value - lv.zoom) > 0.01) {
				excalidrawAPI.updateScene({
					appState: { 
						scrollX: lv.scrollX, 
						scrollY: lv.scrollY, 
						zoom: { value: lv.zoom } 
					}
				});
			}
		}

		const trackedStateKeys = [
			'currentItemStrokeColor', 'currentItemBackgroundColor',
			'currentItemFillStyle', 'currentItemStrokeWidth', 'currentItemStrokeStyle',
			'currentItemRoughness', 'currentItemOpacity', 'currentItemFontFamily',
			'currentItemFontSize', 'currentItemTextAlign', 'currentItemStartArrowhead',
			'currentItemEndArrowhead', 'currentItemRoundness'
		];

		let stateChanged = false;
		for (const key of trackedStateKeys) {
			if (state[key] !== appState[key]) {
				if (JSON.stringify(state[key]) !== JSON.stringify(appState[key])) {
					stateChanged = true;
					break;
				}
			}
		}

		if (state.activeTool?.type !== appState.activeTool?.type) stateChanged = true;
		if (state.editingElement?.id !== appState.editingElement?.id) stateChanged = true;
		
		const currentSelectedIds = Object.keys(appState.selectedElementIds || {}).join(',');
		const newSelectedIds = Object.keys(state.selectedElementIds || {}).join(',');
		if (currentSelectedIds !== newSelectedIds) stateChanged = true;

		if (stateChanged) {
			const nextAppState = {
				...state,
				activeTool: { ...state.activeTool },
				editingElement: state.editingElement ? { id: state.editingElement.id, type: state.editingElement.type } : null,
				selectedElementIds: { ...state.selectedElementIds }
			};
			setAppState(nextAppState);
			
			let tool = state.activeTool?.type || 'selection';
			if (state.editingElement) {
				tool = state.editingElement.type;
			} else if (tool === 'selection' && state.selectedElementIds) {
				const selected = elements.filter((el: any) => state.selectedElementIds[el.id]);
				if (selected.length > 0) {
					tool = selected[0].type;
				}
				setSelectedElements(selected);
			} else {
				setSelectedElements([]);
			}
			setActiveToolType(tool);
		}
	};

	const updateProp = (key: string, value: any) => {
		if (!excalidrawAPI) return;
		excalidrawAPI.updateScene({ appState: { [key]: value } });
		
		const state = excalidrawAPI.getAppState();
		const elements = excalidrawAPI.getSceneElements();
		const selected = elements.filter((el: any) => state.selectedElementIds[el.id]);
		if (selected.length) {
			const updated = selected.map((el: any) => {
				const newEl = { ...el };
				if (key === 'currentItemStrokeColor') newEl.strokeColor = value;
				if (key === 'currentItemBackgroundColor') newEl.backgroundColor = value;
				if (key === 'currentItemStrokeWidth') newEl.strokeWidth = value;
				if (key === 'currentItemStrokeStyle') newEl.strokeStyle = value;
				if (key === 'currentItemRoughness') newEl.roughness = value;
				if (key === 'currentItemRoundness') {
					if (newEl.type === 'arrow') {
						newEl.roundness = value === 'sharp' ? null : value === 'round' ? { type: 2 } : { type: 3 }; // 2 is round, 3 is elbow roughly
					} else {
						newEl.roundness = value === 'round' ? { type: 3 } : null; // adaptive radius
					}
				}
				if (key === 'currentItemFillStyle') newEl.fillStyle = value;
				if (key === 'currentItemFontFamily') newEl.fontFamily = value;
				if (key === 'currentItemFontSize') newEl.fontSize = value;
				if (key === 'currentItemTextAlign') newEl.textAlign = value;
				if (key === 'currentItemStartArrowhead') newEl.startArrowhead = value;
				if (key === 'currentItemEndArrowhead') newEl.endArrowhead = value;
				if (key === 'currentItemOpacity') newEl.opacity = value;
				return newEl;
			});
			const otherElements = elements.filter((el: any) => !state.selectedElementIds[el.id]);
			excalidrawAPI.updateScene({ elements: [...otherElements, ...updated] });
		}
	};

	const isShape = ['rectangle', 'diamond', 'ellipse'].includes(activeToolType);
	const isRectangle = activeToolType === 'rectangle';
	const isDiamond = activeToolType === 'diamond';
	const isLine = activeToolType === 'line';
	const isArrow = activeToolType === 'arrow';
	const isFreedraw = activeToolType === 'freedraw';
	const isText = activeToolType === 'text';

	// The icons for properties
	const strokeWidths = [
		{ val: 1, icon: <Icons.StrokeWidthBaseIcon /> },
		{ val: 2, icon: <Icons.StrokeWidthBoldIcon /> },
		{ val: 4, icon: <Icons.StrokeWidthExtraBoldIcon /> }
	];
	const strokeStyles = [
		{ val: 'solid', icon: <Icons.StrokeStyleSolidIcon /> },
		{ val: 'dashed', icon: <Icons.StrokeStyleDashedIcon /> },
		{ val: 'dotted', icon: <Icons.StrokeStyleDottedIcon /> }
	];
	const roughnesses = [
		{ val: 0, icon: <Icons.SloppinessArchitectIcon /> },
		{ val: 1, icon: <Icons.SloppinessArtistIcon /> },
		{ val: 2, icon: <Icons.SloppinessCartoonistIcon /> }
	];
	const roundnesses = [
		{ val: 'sharp', icon: <Icons.EdgeSharpIcon /> },
		{ val: 'round', icon: <Icons.EdgeRoundIcon /> }
	];
	const fillStyles = [
		{ val: 'hachure', icon: <Icons.FillHachureIcon /> },
		{ val: 'cross-hatch', icon: <Icons.FillCrossHatchIcon /> },
		{ val: 'solid', icon: <Icons.FillSolidIcon /> }
	];
	
	const fontFamilies = [
		{ val: 1, icon: <Icons.FontFamilyHeadingIcon /> },
		{ val: 2, icon: <Icons.FontFamilyNormalIcon /> },
		{ val: 3, icon: <Icons.FontFamilyCodeIcon /> }
	];
	const fontSizes = [
		{ val: 16, icon: <Icons.FontSizeSmallIcon /> },
		{ val: 20, icon: <Icons.FontSizeMediumIcon /> },
		{ val: 28, icon: <Icons.FontSizeLargeIcon /> },
		{ val: 36, icon: <Icons.FontSizeExtraLargeIcon /> }
	];
	const textAligns = [
		{ val: 'left', icon: <Icons.TextAlignLeftIcon /> },
		{ val: 'center', icon: <Icons.TextAlignCenterIcon /> },
		{ val: 'right', icon: <Icons.TextAlignRightIcon /> }
	];
	const arrowheads = [
		{ val: null, icon: <Icons.ArrowheadNoneIcon /> },
		{ val: 'arrow', icon: <Icons.ArrowheadArrowIcon /> },
		{ val: 'triangle', icon: <Icons.ArrowheadTriangleIcon /> },
		{ val: 'dot', icon: <Icons.ArrowheadCircleIcon /> },
		{ val: 'bar', icon: <Icons.ArrowheadBarIcon /> }
	];
	const arrowTypes = [
		{ val: 'sharp', icon: <Icons.sharpArrowIcon /> },
		{ val: 'round', icon: <Icons.roundArrowIcon /> },
		{ val: 'elbow', icon: <Icons.elbowArrowIcon /> }
	];
	const opacities = [
		{ val: 100, icon: <span style={{fontSize:'12px', fontWeight:'bold'}}>100%</span> },
		{ val: 75, icon: <span style={{fontSize:'12px', fontWeight:'bold'}}>75%</span> },
		{ val: 50, icon: <span style={{fontSize:'12px', fontWeight:'bold'}}>50%</span> },
		{ val: 25, icon: <span style={{fontSize:'12px', fontWeight:'bold'}}>25%</span> }
	];

	const colors = [
		{ name: 'yellow', val: '#ffeb3b' }, { name: 'orange', val: '#ff9800' }, { name: 'red', val: '#f44336' }, 
		{ name: 'green', val: '#4caf50' }, { name: 'blue', val: '#2196f3' }, { name: 'black', val: '#000000' }, { name: 'white', val: '#ffffff' }
	];

	// Components
	const OptionGroup = ({ options, currentVal, propKey, isColor = false, title = '' }: any) => {
		const isCurrentlyActive = (o: any) => {
			if (o.val === currentVal) return true;
			// Excalidraw sometimes normalizes 'sharp' or 'none' to null or undefined
			if ((o.val === 'sharp' || o.val === null || o.val === 'none') && (currentVal === null || currentVal === undefined || currentVal === 'sharp' || currentVal === 'none')) {
				if (o.val === 'sharp' && (currentVal === 'sharp' || currentVal === null || currentVal === undefined)) return true;
				if ((o.val === null || o.val === 'none') && (currentVal === 'none' || currentVal === null || currentVal === undefined)) return true;
			}
			return false;
		};

		const selected = options.find(isCurrentlyActive) || options[0];
		const isPopupOpen = activePopup === propKey;

		return (
			<div className="option-group" style={isPopupOpen ? { zIndex: 100 } : undefined}>
				<div className="option-popup" style={isPopupOpen ? { display: 'flex' } : undefined}>
					<div className="option-popup-inner">
						{options.map((o: any) => {
							const isTempActive = isPopupOpen && (o.val === tempSelectedValue || o.value === tempSelectedValue);
							const active = isCurrentlyActive(o) && !isTempActive;
							return (
								<div key={String(o.val)} 
									className={isColor ? `color-swatch-wrap ${active ? 'active' : ''}` : `option-btn ${active ? 'active' : ''}`}
									style={isTempActive ? { outline: '2px solid #2f9e62', outlineOffset: '1px', zIndex: 10 } : undefined}
									onClick={() => {
										updateProp(propKey, o.val);
										setActivePopup(null);
									}}
									title={o.name || o.title || ''}
								>
									{isColor ? (
										o.val === 'transparent' ? (
											<Icons.TransparentIcon />
										) : (
											<div className="color-swatch-dot" style={{ background: o.val }} />
										)
									) : (
										o.icon
									)}
								</div>
							);
						})}
					</div>
				</div>
				<div 
					className={isColor ? `color-swatch-wrap active` : `option-btn active`} 
					title={title}
					onClick={() => setActivePopup(isPopupOpen ? null : propKey)}
				>
					{isColor ? (
						selected.val === 'transparent' ? (
							<Icons.TransparentIcon />
						) : (
							<div className="color-swatch-dot" style={{ background: selected.val }} />
						)
					) : (
						selected.icon
					)}
				</div>
			</div>
		);
	};

	return (
		<>
			<div style={{ width: '100%', height: '100%', position: 'absolute', top: 0, left: 0 }}>
				<Excalidraw 
					excalidrawAPI={handleApiChange} 
					onChange={handleExcalidrawChange}
					zenModeEnabled={false}
					viewModeEnabled={false}
					theme="light"
					initialData={{
						appState: {
							currentItemStrokeColor: '#ffeb3b',
							currentItemBackgroundColor: 'transparent',
							viewBackgroundColor: 'transparent'
						}
					}}
				/>
			</div>
			
			{frameDataUrl && <div className="custom-ui">
				<div className="top-right-bar">
					<button className="action-btn action-btn-cancel" onClick={discard} title="Discard annotation (Esc)">
						<kbd className="btn-kbd">Esc</kbd> Cancel
					</button>
					<button className="action-btn action-btn-comment" onClick={() => save('comment')} title="Save & start comment thread (C)">
						<kbd className="btn-kbd">C</kbd> Comment
					</button>
					<button className="action-btn action-btn-save" onClick={() => save('save')} title="Save annotation (Enter)">
						<kbd className="btn-kbd btn-kbd-primary btn-kbd-lg">↵</kbd> Save
					</button>
				</div>
				
				{(isShape || isLine || isArrow || isFreedraw || isText) && (
					<div className="bottom-options-bar">
						{/* Stroke Color */}
						<OptionGroup title="Stroke Color" options={colors} currentVal={appState.currentItemStrokeColor} propKey="currentItemStrokeColor" isColor={true} />
						
						{/* Background Color & Fill */}
						{(isShape || isLine || isFreedraw) && (
							<>
								<div className="bar-divider"></div>
								<OptionGroup title="Background Color" options={[{name:'transparent', val:'transparent'}, ...colors]} currentVal={appState.currentItemBackgroundColor} propKey="currentItemBackgroundColor" isColor={true} />
								{appState.currentItemBackgroundColor !== 'transparent' && (
									<OptionGroup title="Fill Style" options={fillStyles} currentVal={appState.currentItemFillStyle} propKey="currentItemFillStyle" />
								)}
							</>
						)}

						{/* Text properties */}
						{isText && (
							<>
								<div className="bar-divider"></div>
								<OptionGroup title="Font Family" options={fontFamilies} currentVal={appState.currentItemFontFamily} propKey="currentItemFontFamily" />
								<OptionGroup title="Font Size" options={fontSizes} currentVal={appState.currentItemFontSize} propKey="currentItemFontSize" />
								<OptionGroup title="Text Alignment" options={textAligns} currentVal={appState.currentItemTextAlign} propKey="currentItemTextAlign" />
							</>
						)}
						
						{/* Stroke width */}
						{(isShape || isLine || isArrow || isFreedraw) && (
							<>
								<div className="bar-divider"></div>
								<OptionGroup title="Stroke Width" options={strokeWidths} currentVal={appState.currentItemStrokeWidth} propKey="currentItemStrokeWidth" />
							</>
						)}
						
						{/* Stroke style */}
						{(isShape || isLine || isArrow) && (
							<OptionGroup title="Stroke Style" options={strokeStyles} currentVal={appState.currentItemStrokeStyle} propKey="currentItemStrokeStyle" />
						)}
						
						{/* Sloppiness/Roughness */}
						{(isShape || isLine || isArrow || isFreedraw) && (
							<OptionGroup title="Sloppiness" options={roughnesses} currentVal={appState.currentItemRoughness} propKey="currentItemRoughness" />
						)}
						
						{/* Edges/Roundness */}
						{(isLine || isRectangle || isDiamond) && (
							<OptionGroup title="Corners" options={roundnesses} currentVal={appState.currentItemRoundness === null ? 'sharp' : 'round'} propKey="currentItemRoundness" />
						)}

						{/* Arrow Type (Routing) */}
						{isArrow && (
							<OptionGroup title="Arrow Routing" options={arrowTypes} currentVal={appState.currentItemRoundness === null ? 'sharp' : appState.currentItemRoundness?.type === 2 ? 'round' : 'elbow'} propKey="currentItemRoundness" />
						)}

						{/* Arrowheads */}
						{isArrow && (
							<>
								<div className="bar-divider"></div>
								<OptionGroup title="Start Arrowhead" options={arrowheads} currentVal={appState.currentItemStartArrowhead} propKey="currentItemStartArrowhead" />
								<OptionGroup title="End Arrowhead" options={arrowheads} currentVal={appState.currentItemEndArrowhead} propKey="currentItemEndArrowhead" />
							</>
						)}

						{/* Opacity */}
						<div className="bar-divider"></div>
						<OptionGroup title="Opacity" options={opacities} currentVal={appState.currentItemOpacity} propKey="currentItemOpacity" />
					</div>
				)}

				<div style={{ pointerEvents: 'auto', position: 'absolute', bottom: 6, right: 10, height: '30px', display: 'flex', alignItems: 'center', gap: '6px', background: 'rgba(10, 16, 13, 0.92)', backdropFilter: 'blur(16px)', WebkitBackdropFilter: 'blur(16px)', padding: '0 8px', borderRadius: '8px', border: '1px solid rgba(255, 255, 255, 0.1)', color: '#a8d5b5', boxShadow: '0 8px 30px rgba(0, 0, 0, 0.55), inset 0 1px 0 rgba(255, 255, 255, 0.08)', zIndex: 40, boxSizing: 'border-box' }}>
					<label style={{ fontSize: '10px', fontWeight: 600, color: '#a8d5b5', fontFamily: "'JetBrains Mono', monospace", letterSpacing: '0.02em' }}>Dim</label>
					<input type="range" min="0" max="50" value={dimOpacity} onChange={(e) => setDimOpacity(parseInt(e.target.value))} style={{ width: '55px', accentColor: '#2f9e62', cursor: 'pointer' }} />
					<span style={{ fontSize: '10px', fontWeight: 600, minWidth: '3ch', textAlign: 'right', color: '#6fcf97', fontFamily: "'JetBrains Mono', monospace" }}>{dimOpacity}%</span>
				</div>
			</div>}
		</>
	);
}

const root = createRoot(document.getElementById('app')!);
root.render(<App />);

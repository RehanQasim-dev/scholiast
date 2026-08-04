import { AnyHighlightData } from '../../utils/highlighter';
import { VideoItem } from '../../utils/video/video-storage';

export type HLColor = 'yellow' | 'red' | 'green';

/** Sort orders offered by the header's sort menu. */
export type SortOrder = 'new' | 'old' | 'doc' | 'color';

export type DateRange = 'all' | 'today' | '7d' | '30d';

/** A video annotation is carried through the entry model by stashing it here. */
export interface VideoCarrier { __video?: VideoItem }

/** A freehand-drawing set is carried the same way. */
export interface DrawingCarrier { __drawing?: DrawingSet }

export interface DrawingStroke {
	id: string;
	color: string;
	width: number;
	points: number[];
	updatedAt?: number;
}

export interface DrawingSet {
	id: string;
	strokes: DrawingStroke[];
}

export interface HighlightEntry {
	data: AnyHighlightData;
	url: string;
}

export interface PageGroup {
	url: string;
	path: string;
	title?: string;
	highlights: HighlightEntry[];
}

export interface DomainGroup {
	domain: string;
	pages: PageGroup[];
	totalHighlights: number;
}

/**
 * One render unit — a single annotation, or several highlights sharing a groupId
 * (one selection that crossed block boundaries) shown as one card.
 */
export interface RenderUnit {
	/** Stable identity across re-renders: `pageUrl::groupId|id`. */
	key: string;
	entries: HighlightEntry[];
	pageUrl: string;
	domain: string;
	title?: string;
}

export interface VisiblePage {
	page: PageGroup;
	domain: string;
	units: RenderUnit[];
}

export type NavSelection =
	| { type: 'all' }
	| { type: 'domain'; domain: string }
	| { type: 'page'; domain: string; url: string };

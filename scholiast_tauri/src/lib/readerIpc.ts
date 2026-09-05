import { invokeCommand } from "./ipc";

export interface ArticleSummary {
  urlHash: string;
  url: string;
  title: string | null;
  domain: string | null;
  updatedAt: number;
}

export interface AddArticleResult {
  urlHash: string;
  title: string;
}

export interface PageView {
  urlHash: string;
  url: string;
  title: string | null;
  /** Sanitized article HTML; null/empty until extraction captures it. */
  body: string | null;
  capturedAt: number | null;
  updatedAt: number;
}

/** Extension highlight shape (`type`-tagged); Rust round-trips it via serde. */
export interface HighlightPayload {
  type: "text" | "element";
  id?: string;
  xpath?: string | null;
  startOffset?: number | null;
  endOffset?: number | null;
  content: string;
  notes?: string[];
  color?: string | null;
  groupId?: string | null;
  anchor?: unknown;
  updatedAt?: number;
}

export type HighlightView = HighlightPayload & { id: string };

export interface CommentView {
  id: string;
  body: string;
  createdAt: number;
  editedAt: number | null;
}

export interface StreamFormatView {
  itag: number;
  kind: "progressive" | "audio" | "videoOnly";
  mime: string;
  codecs: string;
  qualityLabel?: string | null;
  bitrate?: number | null;
  width?: number | null;
  height?: number | null;
  fps?: number | null;
  audioSampleRate?: number | null;
  audioChannels?: number | null;
  contentLength?: string | null;
  initRange?: string | null;
  indexRange?: string | null;
  url: string;
}

export interface ManifestCaptionView {
  languageCode: string;
  name: string;
  baseUrl: string;
  isAsr: boolean;
}

/** Fresh per-session manifest (produced by the youtubei.js engine); stream
 * URLs expire and are never persisted. */
export interface StreamManifestView {
  videoId: string;
  title?: string | null;
  lengthSeconds?: number | null;
  streams: StreamFormatView[];
  hlsUrl?: string | null;
  captions: ManifestCaptionView[];
  /** PO token bound to this videoId; replays onto captions/segments. */
  poToken?: string | null;
  /** iOS-client HLS manifest URL (HD path); null when unavailable. */
  iosHlsUrl?: string | null;
}

export function addArticle(args: {
  url: string;
  title?: string;
}): Promise<AddArticleResult> {
  return invokeCommand<AddArticleResult>("add_article", args);
}

export function listArticles(): Promise<ArticleSummary[]> {
  return invokeCommand<ArticleSummary[]>("list_articles");
}

export function getPage(args: { urlHash: string }): Promise<PageView | null> {
  return invokeCommand<PageView | null>("get_page", args);
}

export function getAuthenticHtml(args: { url: string }): Promise<string> {
  return invokeCommand<string>("get_authentic_html", args);
}

export function deleteArticle(args: { urlHash: string }): Promise<boolean> {
  return invokeCommand<boolean>("delete_article", args);
}

export function saveHighlight(args: {
  urlHash: string;
  highlight: HighlightPayload;
}): Promise<void> {
  return invokeCommand<void>("save_highlight", args);
}

export function listHighlights(args: { urlHash: string }): Promise<HighlightView[]> {
  return invokeCommand<HighlightView[]>("list_highlights", args);
}

export function deleteHighlight(args: { highlightId: string }): Promise<boolean> {
  return invokeCommand<boolean>("delete_highlight", args);
}

export function updateHighlightColor(args: {
  highlightId: string;
  color: string;
}): Promise<boolean> {
  return invokeCommand<boolean>("update_highlight_color", args);
}

/** `note` is the full inline-marker string; its timestamp id is preserved. */
export function saveComment(args: {
  highlightId: string;
  note: string;
}): Promise<CommentView> {
  return invokeCommand<CommentView>("save_comment", args);
}

export function listComments(args: { highlightId: string }): Promise<CommentView[]> {
  return invokeCommand<CommentView[]>("list_comments", args);
}

export function deleteComment(args: { commentId: string }): Promise<boolean> {
  return invokeCommand<boolean>("delete_comment", args);
}

export interface SaveDiagramInput {
  id?: string;
  pageUrlHash?: string;
  highlightId?: string;
  sceneJson: string;
  pngBase64: string;
}

export interface SaveDiagramOutput {
  id: string;
}

export interface DiagramItemOut {
  id: string;
  pageUrlHash: string | null;
  sceneJson: string | null;
  pngPath: string | null;
}

export function saveDiagramItem(input: SaveDiagramInput): Promise<SaveDiagramOutput> {
  return invokeCommand<SaveDiagramOutput>("save_diagram_item", { input });
}

export function getDiagramItem(args: { id: string }): Promise<DiagramItemOut | null> {
  return invokeCommand<DiagramItemOut | null>("get_diagram_item", args);
}

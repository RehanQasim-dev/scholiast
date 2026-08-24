//! Domain models whose serialized JSON is byte-compatible with the Scholiast
//! browser extension (field names pinned to the TypeScript types in
//! `shared/merge.ts`, `src/utils/video/video-storage.ts`,
//! `src/utils/highlighter.ts`, `src/utils/pencil-overlays.ts` and
//! `shared/anchor.ts`). Unknown fields are preserved through round-trips via a
//! flattened catch-all map on every synced entity.

use serde::{Deserialize, Serialize, Serializer};

pub type JsonMap = serde_json::Map<String, serde_json::Value>;

fn is_false(b: &bool) -> bool {
    !*b
}

/// Serializes an f64 the way JS `JSON.stringify` does: whole values print
/// without a fractional part (`0`, not `0.0`).
fn serialize_f64_js<S: Serializer>(v: &f64, serializer: S) -> Result<S::Ok, S::Error> {
    if v.fract() == 0.0 && v.abs() < 9_007_199_254_740_992.0 {
        serializer.serialize_i64(*v as i64)
    } else {
        serializer.serialize_f64(*v)
    }
}

fn serialize_opt_f64_js<S: Serializer>(v: &Option<f64>, serializer: S) -> Result<S::Ok, S::Error> {
    match v {
        Some(x) => serialize_f64_js(x, serializer),
        None => serializer.serialize_none(),
    }
}

// --- Video annotations (extension: video-storage.ts) -------------------------

pub type VideoColor = String;

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum VideoItemKind {
    Frame,
    Note,
    Transcript,
}

/// Normalized 0..1 frame-markup primitives (f32 coords per task spec).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoStroke {
    pub id: String,
    pub color: VideoColor,
    /// Flattened normalized points [x0,y0,x1,y1,...].
    #[serde(default)]
    pub points: Vec<f32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoLine {
    pub id: String,
    pub color: VideoColor,
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoText {
    pub id: String,
    pub color: VideoColor,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub size: Option<f32>,
    #[serde(default)]
    pub text: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoRect {
    pub id: String,
    pub color: VideoColor,
    pub x: f32,
    pub y: f32,
    pub w: f32,
    pub h: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoArrow {
    pub id: String,
    pub color: VideoColor,
    pub x1: f32,
    pub y1: f32,
    pub x2: f32,
    pub y2: f32,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub weight: Option<String>,
}

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct VideoMarkup {
    #[serde(default)]
    pub strokes: Vec<VideoStroke>,
    #[serde(default)]
    pub lines: Vec<VideoLine>,
    #[serde(default)]
    pub texts: Vec<VideoText>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub rects: Vec<VideoRect>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub arrows: Vec<VideoArrow>,
}

/// Frame image metadata only — bytes live on disk / Drive blobs, never here.
/// `data_url` ("dataUrl") is runtime-only and never persisted.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct FrameImage {
    #[serde(rename = "dataUrl", default, skip_serializing_if = "Option::is_none")]
    pub data_url: Option<String>,
    #[serde(rename = "driveId", default, skip_serializing_if = "Option::is_none")]
    pub drive_id: Option<String>,
    pub w: i64,
    pub h: i64,
    #[serde(flatten, skip_deserializing)]
    pub extra: JsonMap,
}

/// Anchors a transcript highlight to the immutable caption track
/// (cue index + char offset — no XPath).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct TranscriptAnchor {
    #[serde(rename = "startCue")]
    pub start_cue: i64,
    #[serde(rename = "startOffset")]
    pub start_offset: i64,
    #[serde(rename = "endCue")]
    pub end_cue: i64,
    #[serde(rename = "endOffset")]
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct VideoItem {
    pub id: String,
    pub kind: VideoItemKind,
    /// Seconds into the video; range START for transcript items.
    #[serde(rename = "videoTime", serialize_with = "serialize_f64_js")]
    pub video_time: f64,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub frame: Option<FrameImage>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub markup: Option<VideoMarkup>,
    /// Chat messages: `"text<!--timestamp:N--><!--edited:M-->"`.
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    // --- transcript-only ---
    #[serde(
        rename = "timeEnd",
        default,
        skip_serializing_if = "Option::is_none",
        serialize_with = "serialize_opt_f64_js"
    )]
    pub time_end: Option<f64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub quote: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<VideoColor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<TranscriptAnchor>,
    #[serde(
        rename = "excalidrawScene",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub excalidraw_scene: Option<serde_json::Value>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

// --- Reader highlights (extension: highlighter.ts) ---------------------------

#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "lowercase")]
pub enum AnchorSurface {
    Web,
    Obsidian,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextQuoteAnchor {
    pub quote: String,
    #[serde(default)]
    pub prefix: String,
    #[serde(default)]
    pub suffix: String,
    #[serde(default)]
    pub occurrence: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct StructuralAnchor {
    pub surface: AnchorSurface,
    pub xpath: String,
    #[serde(rename = "startOffset")]
    pub start_offset: i64,
    #[serde(rename = "endOffset")]
    pub end_offset: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageAnchor {
    pub src: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub alt: Option<String>,
}

/// Portable cross-surface anchor carried on every annotation.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct AnnotationAnchor {
    pub quote: TextQuoteAnchor,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub structural: Option<StructuralAnchor>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub image: Option<ImageAnchor>,
}

/// An element highlight over an image redrawn in Excalidraw.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ImageEdit {
    #[serde(rename = "diagramId")]
    pub diagram_id: String,
    #[serde(rename = "updatedAt")]
    pub updated_at: i64,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "type", rename_all = "lowercase")]
pub enum HighlightData {
    Text(TextHighlight),
    Element(ElementHighlight),
}

impl HighlightData {
    pub fn id(&self) -> &str {
        match self {
            HighlightData::Text(h) => &h.id,
            HighlightData::Element(h) => &h.id,
        }
    }

    pub fn notes(&self) -> &[String] {
        match self {
            HighlightData::Text(h) => &h.notes,
            HighlightData::Element(h) => &h.notes,
        }
    }

    pub fn set_notes(&mut self, notes: Vec<String>) {
        match self {
            HighlightData::Text(h) => h.notes = notes,
            HighlightData::Element(h) => h.notes = notes,
        }
    }

    pub fn updated_at(&self) -> i64 {
        match self {
            HighlightData::Text(h) => h.updated_at.unwrap_or(0),
            HighlightData::Element(h) => h.updated_at.unwrap_or(0),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct TextHighlight {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xpath: Option<String>,
    #[serde(
        rename = "startOffset",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub start_offset: Option<i64>,
    #[serde(rename = "endOffset", default, skip_serializing_if = "Option::is_none")]
    pub end_offset: Option<i64>,
    pub content: String,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(rename = "groupId", default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<AnnotationAnchor>,
    #[serde(rename = "imageEdit", default, skip_serializing_if = "Option::is_none")]
    pub image_edit: Option<ImageEdit>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ElementHighlight {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub xpath: Option<String>,
    pub content: String,
    #[serde(default)]
    pub notes: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(rename = "groupId", default, skip_serializing_if = "Option::is_none")]
    pub group_id: Option<String>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub anchor: Option<AnnotationAnchor>,
    #[serde(rename = "imageEdit", default, skip_serializing_if = "Option::is_none")]
    pub image_edit: Option<ImageEdit>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

// --- Drawings & diagrams ------------------------------------------------------

/// Freehand page drawing stroke (document-coordinate points). All payload
/// fields are optional-skip: merge fixtures carry `{id, updatedAt}` stubs.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageDrawing {
    pub id: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub width: Option<f64>,
    /// Flattened document coords [x0,y0,x1,y1,...].
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub points: Vec<f64>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

/// Diagram pointer metadata — scene JSON yes, PNG bytes no.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct DiagramMeta {
    pub id: String,
    #[serde(rename = "sceneData", default, skip_serializing_if = "Option::is_none")]
    pub scene_data: Option<serde_json::Value>,
    #[serde(rename = "updatedAt", default, skip_serializing_if = "Option::is_none")]
    pub updated_at: Option<i64>,
    #[serde(rename = "driveId", default, skip_serializing_if = "Option::is_none")]
    pub drive_id: Option<String>,
    #[serde(
        rename = "sceneDriveId",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub scene_drive_id: Option<String>,
    #[serde(default, skip_serializing_if = "is_false")]
    pub pasted: bool,
    #[serde(
        rename = "imageForHighlight",
        default,
        skip_serializing_if = "Option::is_none"
    )]
    pub image_for_highlight: Option<String>,
    #[serde(rename = "pageUrl", default, skip_serializing_if = "Option::is_none")]
    pub page_url: Option<String>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

// --- Per-page record (extension: shared/merge.ts PageRecord v2) ---------------

/// `ownerId:commentTs` (or bare entity id) -> deletedAt ms.
pub type TombstoneMap = std::collections::BTreeMap<String, i64>;

#[derive(Debug, Clone, Default, Serialize, Deserialize, PartialEq)]
pub struct PageTombstones {
    #[serde(default)]
    pub highlights: TombstoneMap,
    #[serde(default)]
    pub drawings: TombstoneMap,
    #[serde(default)]
    pub comments: TombstoneMap,
    #[serde(rename = "videoItems", default)]
    pub video_items: TombstoneMap,
    #[serde(default)]
    pub diagrams: TombstoneMap,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct PageRecord {
    pub version: u8,
    pub url: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(rename = "videoId", default, skip_serializing_if = "Option::is_none")]
    pub video_id: Option<String>,
    #[serde(default)]
    pub highlights: Vec<HighlightData>,
    #[serde(default)]
    pub drawings: Vec<PageDrawing>,
    #[serde(rename = "videoItems", default)]
    pub video_items: Vec<VideoItem>,
    #[serde(default)]
    pub diagrams: Vec<DiagramMeta>,
    #[serde(default)]
    pub tombstones: PageTombstones,
    #[serde(rename = "deletedAt", default, skip_serializing_if = "Option::is_none")]
    pub deleted_at: Option<i64>,
    #[serde(flatten)]
    pub extra: JsonMap,
}

impl Default for PageRecord {
    fn default() -> Self {
        Self::empty("")
    }
}

impl PageRecord {
    pub fn empty(url: &str) -> Self {
        PageRecord {
            version: 2,
            url: url.to_string(),
            title: None,
            video_id: None,
            highlights: Vec::new(),
            drawings: Vec::new(),
            video_items: Vec::new(),
            diagrams: Vec::new(),
            tombstones: PageTombstones::default(),
            deleted_at: None,
            extra: JsonMap::new(),
        }
    }
}

// --- Comment note-ID format (extension: comment-overlays parseNoteString) ----

const TIMESTAMP_OPEN: &str = "<!--timestamp:";
const EDITED_OPEN: &str = "<!--edited:";
const MARKER_CLOSE: &str = "-->";

/// A parsed comment: display body plus its inline-marker IDs.
///
/// The extension stores comments as plain strings tagged with
/// `"text<!--timestamp:N--><!--edited:M-->"`; the markers ARE the stable IDs
/// the sync merge keys on — never regenerate them.
#[derive(Debug, Clone, PartialEq)]
pub struct CommentData {
    /// Timestamp digits of `<!--timestamp:N-->`, or the raw note for legacy notes.
    pub id: String,
    /// Note text with all ID markers stripped.
    pub body: String,
    /// N from `<!--timestamp:N-->`, or 0 for legacy notes.
    pub created_at: i64,
    /// M from `<!--edited:M-->`, if edited.
    pub edited_at: Option<i64>,
}

/// Returns (digits_start, digits_end, value) of the first valid marker.
fn find_marker(note: &str, open: &str) -> Option<(usize, usize, i64)> {
    let open_start = note.find(open)?;
    let digits_start = open_start + open.len();
    let close_start = note[digits_start..].find(MARKER_CLOSE)? + digits_start;
    let digits = &note[digits_start..close_start];
    if digits.is_empty() || !digits.bytes().all(|b| b.is_ascii_digit()) {
        return None;
    }
    let v = digits.parse::<i64>().ok()?;
    Some((digits_start, close_start, v))
}

fn marker_digits<'a>(note: &'a str, open: &str) -> Option<&'a str> {
    find_marker(note, open).map(|(s, e, _)| &note[s..e])
}

/// Stable comment id: timestamp digits, else the raw note text (legacy).
pub fn comment_id(note: &str) -> String {
    marker_digits(note, TIMESTAMP_OPEN)
        .map(str::to_string)
        .unwrap_or_else(|| note.to_string())
}

/// Merge version of a comment: edited stamp, else creation stamp, else 0.
pub fn comment_version(note: &str) -> i64 {
    if let Some((_, _, v)) = find_marker(note, EDITED_OPEN) {
        return v;
    }
    find_marker(note, TIMESTAMP_OPEN)
        .map(|(_, _, v)| v)
        .unwrap_or(0)
}

/// `"body<!--timestamp:N-->"` — a brand-new comment's stored form.
pub fn format_note(body: &str, created_at_ms: i64) -> String {
    format!("{body}{TIMESTAMP_OPEN}{created_at_ms}{MARKER_CLOSE}")
}

/// Rebuilds a stored note carrying its original timestamp plus `<!--edited:M-->`
/// (replacing any previous edited stamp).
pub fn apply_edited(stored_note: &str, edited_at_ms: i64) -> String {
    let created = comment_version_of_created(stored_note);
    format!(
        "{}{TIMESTAMP_OPEN}{created}{MARKER_CLOSE}{EDITED_OPEN}{edited_at_ms}{MARKER_CLOSE}",
        strip_markers(stored_note)
    )
}

fn comment_version_of_created(note: &str) -> i64 {
    find_marker(note, TIMESTAMP_OPEN)
        .map(|(_, _, v)| v)
        .unwrap_or(0)
}

/// Strips every ID marker, leaving the display body.
/// Malformed markers are kept verbatim.
pub fn strip_markers(note: &str) -> String {
    let mut out = String::with_capacity(note.len());
    let mut rest = note;
    while let Some(open_pos) = [rest.find(TIMESTAMP_OPEN), rest.find(EDITED_OPEN)]
        .into_iter()
        .flatten()
        .min()
    {
        out.push_str(&rest[..open_pos]);
        let tail = &rest[open_pos..];
        let open = if tail.starts_with(TIMESTAMP_OPEN) {
            TIMESTAMP_OPEN
        } else {
            EDITED_OPEN
        };
        match find_marker(tail, open) {
            Some((_, digits_end, _)) => {
                rest = &tail[digits_end + MARKER_CLOSE.len()..];
            }
            None => {
                out.push_str(open);
                rest = &tail[open.len()..];
            }
        }
    }
    out.push_str(rest);
    out
}

/// Full parse of a stored note into [`CommentData`].
pub fn parse_comment(note: &str) -> CommentData {
    CommentData {
        id: comment_id(note),
        body: strip_markers(note),
        created_at: comment_version_of_created(note),
        edited_at: find_marker(note, EDITED_OPEN).map(|(_, _, v)| v),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn comment_ids_round_trip() {
        let n = format_note("hello world", 1724000000000);
        assert_eq!(n, "hello world<!--timestamp:1724000000000-->");
        assert_eq!(comment_id(&n), "1724000000000");
        assert_eq!(comment_version(&n), 1724000000000);
        assert_eq!(parse_comment(&n).body, "hello world");

        let edited = apply_edited(&n, 1724000009999);
        assert_eq!(
            edited,
            "hello world<!--timestamp:1724000000000--><!--edited:1724000009999-->"
        );
        assert_eq!(comment_version(&edited), 1724000009999);

        let reedited = apply_edited(&edited, 555);
        assert_eq!(
            reedited,
            "hello world<!--timestamp:1724000000000--><!--edited:555-->"
        );
    }

    #[test]
    fn legacy_notes_fall_back_to_raw_id() {
        assert_eq!(comment_id("plain note"), "plain note");
        assert_eq!(comment_version("plain note"), 0);
        let parsed = parse_comment("plain note");
        assert_eq!(parsed.id, "plain note");
        assert_eq!(parsed.created_at, 0);
        assert_eq!(parsed.edited_at, None);
    }

    #[test]
    fn malformed_markers_are_left_alone() {
        assert_eq!(
            strip_markers("<!--timestamp:abc-->"),
            "<!--timestamp:abc-->"
        );
        assert_eq!(comment_id("<!--timestamp:x-->"), "<!--timestamp:x-->");
    }
}

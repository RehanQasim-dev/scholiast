//! Caption-track parsing and semantic paragraph chunking.
//!
//! Ports:
//! - json3: `android/.../domain/transcript/CueParser.kt` (the desktop extension
//!   parses caption XML only; the Kotlin port defines the shared json3
//!   semantics — `tStartMs` events open cues, `aAppend` events accumulate).
//! - XML: `src/utils/video/video-transcript.ts:parseCuesXml` (srv3 `<p t= d=>`
//!   first, then the simple `<text start= dur=>` format), including the
//!   collapse-whitespace-then-decode-entities order.
//! - Chunking: `video-transcript.ts:semanticChunk` (:439) with the constants at
//!   :253–255 (`TRANSCRIPT_GROUP_GAP_SECONDS = 20`, `TRANSCRIPT_MAX_GROUP_SECONDS
//!   = 30`) and `splitOnInternalSentences` (:399).

use std::sync::OnceLock;

use serde::{Deserialize, Serialize};

/// One timestamped caption line. Times are seconds.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct Cue {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

/// A readable paragraph: a run of consecutive cues (chunker output).
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Paragraph {
    pub index: usize,
    pub text: String,
    pub start: f64,
    pub end: f64,
    /// First/last cue index covered by this paragraph.
    pub cue_range: [usize; 2],
}

fn ms_to_s(ms: i64) -> f64 {
    ms as f64 / 1000.0
}

// --- JSON3 -------------------------------------------------------------------

/// Parse YouTube's `&fmt=json3` payload.
///
/// Shape: `{ "events": [ { "tStartMs": 0, "dDurationMs": 2680,
/// "segs": [{"utf8":"Hello"},{"tOffsetMs":900,"utf8":" world"}] },
/// { "aAppend": 0, "segs": [{"utf8":", and welcome."}] } ] }`.
///
/// An event carrying `tStartMs` flushes any pending cue and starts a new one;
/// an event without it accumulates its segs into the pending cue's text and
/// extends its end when a positive `dDurationMs` is present. Segs' `utf8`
/// strings are concatenated verbatim (they carry their own whitespace);
/// `tOffsetMs` is per-word timing and does not affect text assembly. Malformed
/// input yields no cues rather than an error.
pub fn parse_json3(raw: &str) -> Vec<Cue> {
    let Ok(value) = serde_json::from_str::<serde_json::Value>(raw) else {
        return Vec::new();
    };
    let Some(events) = value.get("events").and_then(|e| e.as_array()) else {
        return Vec::new();
    };

    let mut cues: Vec<Cue> = Vec::new();
    let mut have_start = false;
    let mut start_ms = 0i64;
    let mut end_ms = 0i64;
    let mut text = String::new();

    macro_rules! flush {
        () => {
            if have_start && !text.trim().is_empty() {
                cues.push(Cue {
                    start: ms_to_s(start_ms),
                    end: ms_to_s(end_ms),
                    text: text.trim().to_string(),
                });
            }
            text.clear();
        };
    }

    for event in events {
        let Some(obj) = event.as_object() else {
            continue;
        };
        if let Some(t_start) = obj.get("tStartMs").and_then(|v| v.as_i64()) {
            flush!();
            have_start = true;
            start_ms = t_start;
            let dur = obj.get("dDurationMs").and_then(|v| v.as_i64()).unwrap_or(0);
            end_ms = t_start + dur;
            text.push_str(&segs_utf8(obj));
        } else if have_start {
            text.push_str(&segs_utf8(obj));
            if let Some(dur) = obj.get("dDurationMs").and_then(|v| v.as_i64()) {
                if dur > 0 {
                    end_ms = start_ms + dur;
                }
            }
        }
    }
    flush!();
    cues
}

fn segs_utf8(obj: &serde_json::Map<String, serde_json::Value>) -> String {
    obj.get("segs")
        .and_then(|s| s.as_array())
        .map(|segs| {
            segs.iter()
                .filter_map(|seg| seg.get("utf8").and_then(|u| u.as_str()))
                .collect()
        })
        .unwrap_or_default()
}

// --- XML ---------------------------------------------------------------------

fn srv3_p_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(r#"<p\s+t="(\d+)"(?:[^>]*?\sd="(\d+)")?[^>]*>([\s\S]*?)</p>"#).unwrap()
    })
}
fn srv3_s_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"<s[^>]*>([^<]*)</s>").unwrap())
}
fn strip_tags_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"<[^>]+>").unwrap())
}
fn text_tag_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| {
        regex::Regex::new(
            r#"<text\s+start="([^"]*)"(?:[^>]*?\sdur="([^"]*)")?[^>]*>([\s\S]*?)</text>"#,
        )
        .unwrap()
    })
}
fn collapse_ws_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"\s{2,}").unwrap())
}
fn hex_entity_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"&#x([0-9a-fA-F]+);").unwrap())
}
fn dec_entity_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r"&#(\d+);").unwrap())
}

/// Parse YouTube caption XML: srv3 first, then the simple timedtext format
/// (port of `parseCuesXml`, video-transcript.ts:203–230).
pub fn parse_xml(xml: &str) -> Vec<Cue> {
    let srv3 = parse_srv3(xml);
    if !srv3.is_empty() {
        return srv3;
    }
    parse_text_format(xml)
}

/// srv3: `<p t="ms" d="ms"><s>word</s>…</p>` — one line = one cue.
fn parse_srv3(xml: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    for cap in srv3_p_re().captures_iter(xml) {
        let Ok(start_ms) = cap[1].parse::<i64>() else { continue };
        let dur_ms = cap.get(2).and_then(|m| m.as_str().parse::<i64>().ok()).unwrap_or(0);
        let inner = &cap[3];
        let joined: String = srv3_s_re()
            .captures_iter(inner)
            .map(|c| c[1].to_string())
            .collect();
        let raw = if joined.is_empty() {
            strip_tags_re().replace_all(inner, "").into_owned()
        } else {
            joined
        };
        let text = clean_caption(&raw);
        if !text.is_empty() {
            cues.push(Cue {
                start: ms_to_s(start_ms),
                end: ms_to_s(start_ms + dur_ms),
                text,
            });
        }
    }
    cues
}

/// Simple format: `<text start="s" dur="s">…</text>` — timestamps in seconds.
fn parse_text_format(xml: &str) -> Vec<Cue> {
    let mut cues = Vec::new();
    for cap in text_tag_re().captures_iter(xml) {
        let start: f64 = cap[1].parse().unwrap_or(0.0);
        let dur: f64 = cap
            .get(2)
            .map(|m| m.as_str().parse::<f64>().unwrap_or(0.0))
            .unwrap_or(0.0);
        let raw = strip_tags_re().replace_all(&cap[3], "").into_owned();
        let text = clean_caption(&raw);
        if !text.is_empty() {
            cues.push(Cue {
                start,
                end: start + dur,
                text,
            });
        }
    }
    cues
}

/// Collapse whitespace first, then decode entities — same order as the TS.
fn clean_caption(text: &str) -> String {
    let collapsed = collapse_ws_re()
        .replace_all(&text.replace('\n', " "), " ")
        .into_owned();
    decode_entities(&collapsed).trim().to_string()
}

/// Port of the desktop `decodeEntities` replacement chain: named entities
/// first (so `&amp;lt;` stays literal), then hex, then decimal numeric.
fn decode_entities(text: &str) -> String {
    let s = text
        .replace("&amp;", "&")
        .replace("&lt;", "<")
        .replace("&gt;", ">")
        .replace("&quot;", "\"")
        .replace("&#39;", "'")
        .replace("&apos;", "'");
    let s = hex_entity_re().replace_all(&s, |caps: &regex::Captures| {
        u32::from_str_radix(&caps[1], 16)
            .ok()
            .and_then(char::from_u32)
            .map(String::from)
            .unwrap_or_else(|| caps[0].to_string())
    });
    dec_entity_re()
        .replace_all(&s, |caps: &regex::Captures| {
            caps[1]
                .parse::<u32>()
                .ok()
                .and_then(char::from_u32)
                .map(String::from)
                .unwrap_or_else(|| caps[0].to_string())
        })
        .into_owned()
}

// --- Semantic chunking ---------------------------------------------------------

/// `TRANSCRIPT_GROUP_GAP_SECONDS` (video-transcript.ts:254): a gap this large
/// between consecutive cue starts is a paragraph break.
const GROUP_GAP_S: f64 = 20.0;
/// `TRANSCRIPT_MAX_GROUP_SECONDS` (video-transcript.ts:255): an unpunctuated
/// run spanning this long from the paragraph's first cue is flushed.
const MAX_GROUP_S: f64 = 30.0;

fn sent_end_re() -> &'static regex::Regex {
    static RE: OnceLock<regex::Regex> = OnceLock::new();
    RE.get_or_init(|| regex::Regex::new(r#"[.!?。！？]["')\]’”]?\s*$"#).unwrap())
}

fn internal_sent_re_positions(text: &str) -> Vec<usize> {
    const PUNCT: &[char] = &['.', '!', '?', '。', '！', '？'];
    const CLOSING: &[char] = &['"', '\'', ')', ']', '’', '”'];
    let chars: Vec<(usize, char)> = text.char_indices().collect();
    let mut positions = Vec::new();
    for (i, &(_, ch)) in chars.iter().enumerate() {
        if !PUNCT.contains(&ch) {
            continue;
        }
        let mut j = i + 1;
        if let Some(&(_, c)) = chars.get(j) {
            if CLOSING.contains(&c) {
                j += 1;
            }
        }
        let mut k = j;
        while let Some(&(_, c)) = chars.get(k) {
            if c.is_whitespace() {
                k += 1;
            } else {
                break;
            }
        }
        if k == j {
            continue;
        }
        if let Some(&(_, next)) = chars.get(k) {
            // Uppercase letter or an opening quote (CJK punctuation needs no
            // capital-letter lookahead, but the shared class keeps parity with
            // the TS regex).
            if next.is_ascii_uppercase() || matches!(next, '“' | '"' | '‘' | '\'') {
                positions.push(byte_idx_of(&chars, j));
            }
        }
    }
    positions
}

fn byte_idx_of(chars: &[(usize, char)], slot: usize) -> usize {
    match chars.get(slot) {
        Some(&(b, _)) => b,
        None => match chars.last() {
            Some(&(b, c)) => b + c.len_utf8(),
            None => 0,
        },
    }
}

/// Pre-split cues that carry a mid-cue sentence boundary into separate cues
/// (`splitOnInternalSentences`, video-transcript.ts:399–422). Both halves keep
/// the original cue's times; emitted indexes are sequential.
pub fn split_on_internal_sentences(cues: &[Cue]) -> Vec<Cue> {
    let mut out = Vec::new();
    for c in cues {
        let positions = internal_sent_re_positions(&c.text);
        if positions.is_empty() {
            out.push(Cue {
                start: c.start,
                end: c.end,
                text: c.text.clone(),
            });
            continue;
        }
        let mut prev = 0usize;
        for pos in positions {
            let piece = c.text[prev..pos].trim();
            if !piece.is_empty() {
                out.push(Cue {
                    start: c.start,
                    end: c.end,
                    text: piece.to_string(),
                });
            }
            prev = pos;
        }
        let tail = c.text[prev..].trim();
        if !tail.is_empty() {
            out.push(Cue {
                start: c.start,
                end: c.end,
                text: tail.to_string(),
            });
        }
    }
    out
}

/// Exact port of `semanticChunk` (video-transcript.ts:439–454): flush before a
/// cue whose start is more than 20s past the previous cue's start; flush after
/// a cue ending a sentence; flush after a cue once the pending run has spanned
/// ≥30s without punctuation.
pub fn semantic_chunk(cues: &[Cue]) -> Vec<Paragraph> {
    if cues.is_empty() {
        return Vec::new();
    }
    let mut paragraphs: Vec<Paragraph> = Vec::new();
    let mut pending: Vec<(usize, &Cue)> = Vec::new();

    macro_rules! flush {
        () => {
            if !pending.is_empty() {
                paragraphs.push(build_paragraph(paragraphs.len(), &pending));
                pending.clear();
            }
        };
    }

    for (slot, c) in cues.iter().enumerate() {
        if let Some((_, prev)) = pending.last() {
            if c.start - prev.start > GROUP_GAP_S {
                flush!();
            }
        }
        pending.push((slot, c));
        if sent_end_re().is_match(&c.text) {
            flush!();
            continue;
        }
        if c.start - pending[0].1.start >= MAX_GROUP_S {
            flush!();
        }
    }
    flush!();
    paragraphs
}

/// The full pipeline the transcript client calls: internal-sentence split,
/// then semantic grouping (`TranscriptChunker.chunk`).
pub fn chunk(cues: &[Cue]) -> Vec<Paragraph> {
    semantic_chunk(&split_on_internal_sentences(cues))
}

fn build_paragraph(index: usize, cues: &[(usize, &Cue)]) -> Paragraph {
    let text = cues
        .iter()
        .map(|(_, c)| c.text.as_str())
        .collect::<Vec<_>>()
        .join(" ");
    let (first_slot, first) = cues.first().expect("non-empty");
    let (last_slot, last) = cues.last().expect("non-empty");
    Paragraph {
        index,
        text,
        start: first.start,
        end: last.end,
        cue_range: [*first_slot, *last_slot],
    }
}

// Auto-detect entry point mirroring `CueParser.parse`: XML payloads start with
// `<`; JSON3 is an object.
pub fn parse(raw: &str) -> Vec<Cue> {
    if raw.trim_start().starts_with('<') {
        parse_xml(raw)
    } else {
        parse_json3(raw)
    }
}

//! Pure 3-way merge for the per-page Drive record — port of
//! `shared/merge.ts::mergePageRecord` (the authority). No I/O: records in,
//! merged record out, so the golden fixtures pin behavior byte-for-byte.
//!
//! Reconciliation is the 3-way merge between `base` (the last-reconciled
//! snapshot), `local` (this device's state) and `remote` (the Drive file).
//! Deletions are detected against base and recorded as per-page tombstones so
//! a delete on one device isn't resurrected by the other's stale copy.

use std::collections::BTreeMap;

use crate::models::{
    DiagramMeta, HighlightData, PageDrawing, PageRecord, PageTombstones, TombstoneMap, VideoItem,
};
use crate::normalize;

/// Tombstones older than this are garbage-collected so a record can't grow
/// forever (shared/merge.ts TOMBSTONE_RETENTION_MS).
pub const TOMBSTONE_RETENTION_MS: i64 = 30 * 24 * 60 * 60 * 1000;

// --- JS number-string parsing -------------------------------------------------
//
// The extension versions entities with `updatedAt || parseInt(id, 10) || 0`.
// JS parseInt parses LEADING decimal digits and yields NaN otherwise; both
// NaN and 0 collapse to 0 through `|| 0`.

fn js_parse_int(s: &str) -> i64 {
    let trimmed = s.trim_start();
    let bytes = trimmed.as_bytes();
    let mut idx = match bytes.first() {
        Some(b'+') | Some(b'-') => 1,
        _ => 0,
    };
    let start = idx;
    while idx < bytes.len() && bytes[idx].is_ascii_digit() {
        idx += 1;
    }
    if idx == start {
        return 0;
    }
    trimmed[start..idx].parse::<i64>().unwrap_or(0)
}

pub fn highlight_version(h: &HighlightData) -> i64 {
    let updated = h.updated_at();
    if updated != 0 {
        return updated;
    }
    js_parse_int(h.id())
}

pub fn video_item_version(it: &VideoItem) -> i64 {
    if let Some(updated) = it.updated_at {
        if updated != 0 {
            return updated;
        }
    }
    js_parse_int(&it.id)
}

fn drawing_version(s: &PageDrawing) -> i64 {
    s.updated_at.unwrap_or(0)
}

fn diagram_version(d: &DiagramMeta) -> i64 {
    d.updated_at.unwrap_or(0)
}

// --- Generic keyed 3-way merge -----------------------------------------------

fn push_id(order: &mut Vec<String>, id: &str) {
    if !order.iter().any(|seen| seen == id) {
        order.push(id.to_string());
    }
}

/// Kept entities in first-seen order (base → local → remote → tombstones),
/// mirroring the TS Map insertion order that drives JSON output order.
pub struct KeyedMergeResult<T> {
    kept: BTreeMap<String, T>,
    order: Vec<String>,
}

impl<T> KeyedMergeResult<T> {
    pub fn into_values(mut self) -> Vec<T> {
        self.order
            .into_iter()
            .map(|id| self.kept.remove_entry(&id).expect("ordered id").1)
            .collect()
    }

    pub fn get(&self, id: &str) -> Option<&T> {
        self.kept.get(id)
    }
}

pub fn merge_keyed<T, FVer, FCombine>(
    base: &BTreeMap<String, T>,
    local: &BTreeMap<String, T>,
    remote: &BTreeMap<String, T>,
    in_tombs: &TombstoneMap,
    version_of: FVer,
    mut combine: FCombine,
    now: i64,
) -> (KeyedMergeResult<T>, TombstoneMap)
where
    T: Clone,
    FVer: Fn(&T) -> i64,
    FCombine: FnMut(&T, &T) -> T,
{
    let mut order: Vec<String> = Vec::new();
    for source in base.keys().chain(local.keys()).chain(remote.keys()) {
        push_id(&mut order, source);
    }
    for id in in_tombs.keys() {
        push_id(&mut order, id);
    }

    let mut kept: BTreeMap<String, T> = BTreeMap::new();
    let mut tombs: TombstoneMap = in_tombs.clone();

    for id in &order {
        let b = base.get(id);
        let l = local.get(id);
        let r = remote.get(id);
        let tomb = tombs.get(id).copied();

        match (l, r) {
            (Some(l), Some(r)) => {
                let merged = combine(l, r);
                if let Some(t) = tomb {
                    if version_of(&merged) <= t {
                        continue; // deleted more recently than this edit — stays deleted
                    }
                }
                kept.insert(id.clone(), merged);
                tombs.remove(id);
            }
            (Some(l), None) => {
                if let Some(t) = tomb {
                    if version_of(l) > t {
                        // re-edited locally after a remote delete → resurrect
                        kept.insert(id.clone(), l.clone());
                        tombs.remove(id);
                    }
                } else if b.is_none() {
                    kept.insert(id.clone(), l.clone()); // brand-new local entity
                } else {
                    tombs.insert(id.clone(), now); // gone from remote → remote deleted it
                }
            }
            (None, Some(r)) => {
                if b.is_some() {
                    tombs.insert(id.clone(), now); // gone locally → local deleted it
                } else if let Some(t) = tomb {
                    if version_of(r) > t {
                        // re-added remotely after a delete → resurrect
                        kept.insert(id.clone(), r.clone());
                        tombs.remove(id);
                    }
                } else {
                    kept.insert(id.clone(), r.clone()); // brand-new remote entity
                }
            }
            (None, None) => {} // absent both sides — leave any tombstone for GC
        }
    }

    tombs.retain(|_, t| now - *t <= TOMBSTONE_RETENTION_MS);

    order.retain(|id| kept.contains_key(id));

    (
        KeyedMergeResult { kept, order },
        tombs,
    )
}

// --- Comment (notes[]) merge --------------------------------------------------

fn note_map(notes: Option<&Vec<String>>) -> BTreeMap<String, String> {
    let mut m = BTreeMap::new();
    if let Some(notes) = notes {
        for n in notes {
            m.insert(crate::models::comment_id(n), n.clone());
        }
    }
    m
}

/// Merges one highlight's comment thread. IDs are the inline
/// `<!--timestamp:N-->` markers (legacy notes fall back to raw text); newest
/// edit wins per ID and deletions propagate via `${highlightId}:${commentTs}`
/// comment tombstones.
#[allow(clippy::too_many_arguments)]
pub fn merge_notes(
    base_notes: Option<&Vec<String>>,
    local_notes: Option<&Vec<String>>,
    remote_notes: Option<&Vec<String>>,
    comment_tombs: &mut TombstoneMap,
    highlight_id: &str,
    now: i64,
) -> Vec<String> {
    let base = note_map(base_notes);
    let local = note_map(local_notes);
    let remote = note_map(remote_notes);

    let prefix = format!("{highlight_id}:");
    let mut scoped: TombstoneMap = BTreeMap::new();
    for (k, v) in comment_tombs.iter() {
        if let Some(rest) = k.strip_prefix(&prefix) {
            scoped.insert(rest.to_string(), *v);
        }
    }

    let (kept, tombs) = merge_keyed(
        &base,
        &local,
        &remote,
        &scoped,
        |n| crate::models::comment_version(n),
        |l, r| {
            if crate::models::comment_version(l) >= crate::models::comment_version(r) {
                l.clone()
            } else {
                r.clone()
            }
        },
        now,
    );

    comment_tombs.retain(|k, _| !k.starts_with(&prefix));
    for (k, v) in tombs {
        comment_tombs.insert(format!("{prefix}{k}"), v);
    }

    let mut out: Vec<(i64, String)> = kept
        .into_values()
        .into_iter()
        .map(|n| (js_parse_int(&crate::models::comment_id(&n)), n))
        .collect();
    out.sort_by_key(|(v, _)| *v);
    out.into_iter().map(|(_, n)| n).collect()
}

// --- Per-page record merge (shared/merge.ts mergePageRecord) -----------------

/// 3-way reconcile of a single page record. Any side may be absent. Returns
/// the merged record with updated tombstones, ready to write locally and upload.
pub fn merge_page_record(
    base: Option<&PageRecord>,
    local: Option<&PageRecord>,
    remote: Option<&PageRecord>,
    now: i64,
) -> PageRecord {
    let url = local
        .and_then(|r| (!r.url.is_empty()).then_some(r.url.as_str()))
        .or_else(|| remote.map(|r| r.url.as_str()))
        .or_else(|| base.map(|r| r.url.as_str()))
        .unwrap_or_default()
        .to_string();
    let default = PageRecord::empty(&url);
    let b = base.unwrap_or(&default);
    let l = local.unwrap_or(&default);
    let r = remote.unwrap_or(&default);

    // Seed from remote — the shared, durable record of deletions.
    let mut tombs: PageTombstones = r.tombstones.clone();

    let owned_map = |rec: &PageRecord| -> BTreeMap<String, HighlightData> {
        rec.highlights
            .iter()
            .map(|h| (h.id().to_string(), h.clone()))
            .collect()
    };
    let b_h_owned = owned_map(b);
    let l_h_owned = owned_map(l);
    let r_h_owned = owned_map(r);

    // Comments are mutated by the highlight/video combines; take the map out so
    // the borrows stay disjoint (TS shares one mutable tombstone set too).
    let mut comments = std::mem::take(&mut tombs.comments);

    let hl_base_by_id = b_h_owned.clone();

    let (hl_kept, hl_tombs) = merge_keyed(
        &b_h_owned,
        &l_h_owned,
        &r_h_owned,
        &tombs.highlights,
        highlight_version,
        |x, y| {
            let newer =
                if highlight_version(x) >= highlight_version(y) {
                    x
                } else {
                    y
                };
            let notes = merge_notes(
                hl_base_by_id.get(x.id()).and_then(|h| notes_of(h)),
                notes_of(x),
                notes_of(y),
                &mut comments,
                x.id(),
                now,
            );
            let mut out = newer.clone();
            out.set_notes(notes);
            out
        },
        now,
    );
    tombs.highlights = hl_tombs;

    let drawings_map = |rec: &PageRecord| -> BTreeMap<String, PageDrawing> {
        rec.drawings
            .iter()
            .map(|s| (s.id.clone(), s.clone()))
            .collect()
    };
    let (d_kept, d_tombs) = merge_keyed(
        &drawings_map(b),
        &drawings_map(l),
        &drawings_map(r),
        &tombs.drawings,
        drawing_version,
        |x, y| {
            if drawing_version(x) >= drawing_version(y) {
                x.clone()
            } else {
                y.clone()
            }
        },
        now,
    );
    tombs.drawings = d_tombs;

    let items_map = |rec: &PageRecord| -> BTreeMap<String, VideoItem> {
        rec.video_items
            .iter()
            .map(|it| (it.id.clone(), it.clone()))
            .collect()
    };
    let v_base_by_id = items_map(b);
    let (v_kept, v_tombs) = merge_keyed(
        &items_map(b),
        &items_map(l),
        &items_map(r),
        &tombs.video_items,
        video_item_version,
        |x, y| {
            let newer = if video_item_version(x) >= video_item_version(y) {
                x
            } else {
                y
            };
            let notes = merge_notes(
                v_base_by_id.get(&x.id).map(|it| &it.notes),
                Some(&x.notes),
                Some(&y.notes),
                &mut comments,
                &x.id,
                now,
            );
            let mut out = newer.clone();
            out.notes = notes;
            if out.frame.is_none() {
                out.frame = x.frame.clone().or_else(|| y.frame.clone());
            }
            out
        },
        now,
    );
    tombs.video_items = v_tombs;

    let diagrams_map = |rec: &PageRecord| -> BTreeMap<String, DiagramMeta> {
        rec.diagrams
            .iter()
            .map(|d| (d.id.clone(), d.clone()))
            .collect()
    };
    let (g_kept, g_tombs) = merge_keyed(
        &diagrams_map(b),
        &diagrams_map(l),
        &diagrams_map(r),
        &tombs.diagrams,
        diagram_version,
        |x, y| {
            if diagram_version(x) >= diagram_version(y) {
                x.clone()
            } else {
                y.clone()
            }
        },
        now,
    );
    tombs.diagrams = g_tombs;

    tombs.comments = comments;

    // `??` keeps empty strings in JS but the spread omits falsy values, so an
    // empty title/videoId is dropped from the output exactly as TS does.
    let title = [l.title.as_deref(), r.title.as_deref(), b.title.as_deref()]
        .into_iter()
        .flatten()
        .find(|t| !t.is_empty())
        .map(str::to_string);
    let video_id = [
        l.video_id.as_deref(),
        r.video_id.as_deref(),
        b.video_id.as_deref(),
    ]
    .into_iter()
    .flatten()
    .find(|v| !v.is_empty())
    .map(str::to_string);

    PageRecord {
        version: 2,
        url,
        title,
        video_id,
        highlights: hl_kept.into_values(),
        drawings: d_kept.into_values(),
        video_items: v_kept.into_values(),
        diagrams: g_kept.into_values(),
        tombstones: tombs,
        deleted_at: None,
        extra: Default::default(),
    }
}

fn notes_of(h: &HighlightData) -> Option<&Vec<String>> {
    Some(match h {
        HighlightData::Text(t) => &t.notes,
        HighlightData::Element(e) => &e.notes,
    })
}

// --- Fingerprint --------------------------------------------------------------

/// Stable identity of a record's live content: canonical JSON of the whole
/// record with the `tombstones` key stripped (same trick as the extension's
/// sync engine — tombstones churn without entity changes). Canonical because
/// serde_json's default object map sorts keys. Compared by string equality.
pub fn fingerprint(record: &PageRecord) -> String {
    let mut value = serde_json::to_value(record).unwrap_or_default();
    if let Some(obj) = value.as_object_mut() {
        obj.remove("tombstones");
    }
    serde_json::to_string(&value).unwrap_or_default()
}

// --- Drive file naming ----------------------------------------------------------

/// Drive filename for a page's record: `pages/page-<sha256-prefix>.json` of
/// the URL — identical scheme to `shared/merge.ts::pageFileName`, so every
/// client computes the same name. (The hash itself is task-03's `url_hash`,
/// which is the same SHA-256/first-16-bytes/hex digest.)
pub fn page_file_name(url: &str) -> String {
    normalize::page_file_name(&normalize::url_hash(url))
}

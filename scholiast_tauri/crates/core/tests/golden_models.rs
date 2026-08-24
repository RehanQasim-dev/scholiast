//! Golden round-trips: the Rust models must deserialize and re-serialize the
//! extension's per-page records without changing any field name or value.

use scholiast_core::models::{
    AnnotationAnchor, FrameImage, PageRecord, TextQuoteAnchor, TranscriptAnchor, VideoArrow,
    VideoItem, VideoItemKind, VideoLine, VideoMarkup, VideoRect, VideoStroke, VideoText,
};
use serde_json::{json, Value};

fn fixture_cases() -> Vec<Value> {
    let raw = include_str!("fixtures/merge_page_record_fixtures.json");
    let parsed: Value = serde_json::from_str(raw).expect("fixture parses");
    parsed["cases"].as_array().cloned().expect("cases array")
}

#[test]
fn page_record_fixtures_round_trip_value_identically() {
    for case in fixture_cases() {
        for side in ["base", "local", "remote"] {
            let mut record = case[side].clone();
            if record.is_null() {
                continue;
            }
            // Some fixture records omit arrays that mergePageRecord output
            // always writes; deserialize fills them with [], so seed the
            // expectation the same way.
            let obj = record.as_object_mut().unwrap();
            for arr in ["highlights", "drawings", "videoItems", "diagrams"] {
                obj.entry(arr.to_string()).or_insert(json!([]));
            }
            let parsed: PageRecord = serde_json::from_value(record.clone())
                .unwrap_or_else(|e| panic!("case {:?} side {side}: {e}", case["name"]));
            let out = serde_json::to_value(&parsed).unwrap();
            assert_eq!(out, record, "case {:?}", case["name"]);
        }
    }
}

#[test]
fn empty_page_record_matches_extension_shape() {
    let out = serde_json::to_value(PageRecord::empty("https://example.com/a")).unwrap();
    assert_eq!(
        out,
        json!({
            "version": 2,
            "url": "https://example.com/a",
            "highlights": [],
            "drawings": [],
            "videoItems": [],
            "diagrams": [],
            "tombstones": {"highlights": {}, "drawings": {}, "comments": {}, "videoItems": {}, "diagrams": {}}
        })
    );
}

/// A fully-populated VideoItem survives struct ↔ JSON with every field named
/// exactly as the extension writes it.
#[test]
fn video_item_full_round_trip() {
    let item = VideoItem {
        id: "m1abc23".into(),
        kind: VideoItemKind::Frame,
        video_time: 615.25,
        frame: Some(FrameImage {
            data_url: None,
            drive_id: Some("drive-blob-1".into()),
            w: 1280,
            h: 720,
            extra: Default::default(),
        }),
        markup: Some(VideoMarkup {
            strokes: vec![VideoStroke {
                id: "s1".into(),
                color: "#facc15".into(),
                points: vec![0.1, 0.2, 0.35, 0.45],
                weight: Some("thick".into()),
            }],
            lines: vec![VideoLine {
                id: "l1".into(),
                color: "#fb7185".into(),
                x1: 0.0,
                y1: 0.0,
                x2: 0.5,
                y2: 0.5,
                weight: None,
            }],
            texts: vec![VideoText {
                id: "t1".into(),
                color: "#000000".into(),
                x: 0.05,
                y: 0.9,
                w: 0.4,
                size: Some(1.5),
                text: "key idea".into(),
            }],
            rects: vec![VideoRect {
                id: "r1".into(),
                color: "#4ac582".into(),
                x: 0.2,
                y: 0.2,
                w: 0.3,
                h: 0.3,
                weight: Some("thin".into()),
            }],
            arrows: vec![VideoArrow {
                id: "a1".into(),
                color: "#facc15".into(),
                x1: 0.1,
                y1: 0.1,
                x2: 0.9,
                y2: 0.9,
                weight: None,
            }],
        }),
        notes: vec!["what is a monad?<!--timestamp:1724000000000-->".into()],
        updated_at: Some(1724000001000),
        time_end: None,
        quote: None,
        color: None,
        anchor: None,
        excalidraw_scene: None,
        extra: Default::default(),
    };

    let value = serde_json::to_value(&item).unwrap();
    // Field names pinned to the extension's JSON:
    let obj = value.as_object().unwrap();
    for key in [
        "id",
        "kind",
        "videoTime",
        "frame",
        "markup",
        "notes",
        "updatedAt",
    ] {
        assert!(obj.contains_key(key), "missing key {key}");
    }
    assert_eq!(value["kind"], json!("frame"));
    assert_eq!(value["videoTime"], json!(615.25));
    assert_eq!(value["updatedAt"], json!(1724000001000i64));
    assert!(value["frame"].get("dataUrl").is_none());
    assert_eq!(value["frame"]["driveId"], json!("drive-blob-1"));
    assert_eq!(value["frame"]["w"], json!(1280));
    let stroke = &value["markup"]["strokes"][0];
    for key in ["id", "color", "points", "weight"] {
        assert!(stroke.get(key).is_some(), "stroke missing {key}");
    }
    for key in ["strokes", "lines", "texts", "rects", "arrows"] {
        assert!(value["markup"].get(key).is_some(), "markup missing {key}");
    }

    let back: VideoItem = serde_json::from_value(value).unwrap();
    assert_eq!(back, item);
}

#[test]
fn transcript_item_fields_use_extension_names() {
    let item = VideoItem {
        id: "tx9".into(),
        kind: VideoItemKind::Transcript,
        video_time: 42.0,
        frame: None,
        markup: None,
        notes: Vec::new(),
        updated_at: Some(7),
        time_end: Some(48.5),
        quote: Some("spoken words".into()),
        color: Some("yellow".into()),
        anchor: Some(TranscriptAnchor {
            start_cue: 12,
            start_offset: 3,
            end_cue: 14,
            end_offset: 8,
        }),
        excalidraw_scene: None,
        extra: Default::default(),
    };
    let value = serde_json::to_value(&item).unwrap();
    assert_eq!(value["kind"], json!("transcript"));
    assert_eq!(value["timeEnd"], json!(48.5));
    assert_eq!(
        value["anchor"],
        json!({"startCue": 12, "startOffset": 3, "endCue": 14, "endOffset": 8})
    );
    // Frame-less transcript items omit the optional objects entirely.
    assert!(value.get("frame").is_none());
    assert!(value.get("markup").is_none());
}

/// Unknown fields from future/other-client versions must survive a round-trip.
#[test]
fn unknown_fields_are_preserved_via_flatten() {
    let raw = json!({
        "version": 2,
        "url": "https://example.com/a",
        "highlights": [{
            "type": "text",
            "id": "h1",
            "xpath": "/html/body/p[1]",
            "startOffset": 4,
            "endOffset": 9,
            "content": "hello",
            "notes": [],
            "color": "yellow",
            "groupId": "g1",
            "updatedAt": 10,
            "anchor": {
                "quote": {"quote": "hello", "prefix": "say ", "suffix": " world", "occurrence": 0},
                "structural": {"surface": "web", "xpath": "/html/body/p[1]", "startOffset": 4, "endOffset": 9}
            },
            "someFutureField": {"nested": true}
        }],
        "drawings": [],
        "videoItems": [],
        "diagrams": [{"id": "d1", "updatedAt": 7, "brandNew": "x"}],
        "tombstones": {"highlights": {}, "drawings": {}, "comments": {}, "videoItems": {}, "diagrams": {}},
        "deletedAt": null
    });

    let parsed: PageRecord = serde_json::from_value(raw.clone()).unwrap();
    let hl = &parsed.highlights[0];
    match hl {
        scholiast_core::models::HighlightData::Text(t) => {
            assert_eq!(
                t.extra.get("someFutureField"),
                Some(&json!({"nested": true}))
            );
        }
        _ => panic!("expected text highlight"),
    }
    let anchor: &AnnotationAnchor = match &parsed.highlights[0] {
        scholiast_core::models::HighlightData::Text(t) => t.anchor.as_ref().unwrap(),
        _ => unreachable!(),
    };
    let q: &TextQuoteAnchor = &anchor.quote;
    assert_eq!(q.quote, "hello");
    let out = serde_json::to_value(&parsed).unwrap();
    // deletedAt: null is dropped on re-serialize (absent == null in TS checks).
    assert!(out.get("deletedAt").is_none());
    assert_eq!(
        out["highlights"][0]["someFutureField"],
        json!({"nested": true})
    );
    assert_eq!(out["diagrams"][0]["brandNew"], json!("x"));
    // Everything the extension wrote comes back untouched.
    let mut expected = raw.clone();
    expected.as_object_mut().unwrap().remove("deletedAt");
    assert_eq!(out, expected);
}

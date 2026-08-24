//! Golden tests: the Rust merge must reproduce the TypeScript
//! `mergePageRecord` output Value-identically for every committed fixture
//! case (vectors from `scholiast_flutter/test/fixtures/`).

use scholiast_core::merge::{fingerprint, merge_page_record, page_file_name};
use scholiast_core::models::PageRecord;
use serde_json::{json, Value};

fn fixture_doc(path: &str) -> Value {
    let raw = match path {
        "in" => include_str!("fixtures/merge_page_record_fixtures.json"),
        "expected" => include_str!("fixtures/merge_page_record_expected.json"),
        _ => unreachable!(),
    };
    serde_json::from_str(raw.trim()).expect("fixture parses")
}

fn cases() -> (i64, Vec<Value>, Vec<Value>) {
    let inputs = fixture_doc("in");
    let expected = fixture_doc("expected");
    (
        inputs["now"].as_i64().expect("top-level now"),
        inputs["cases"].as_array().cloned().expect("input cases"),
        expected["cases"].as_array().cloned().expect("expected cases"),
    )
}

fn parse_side(value: &Value, name: &str) -> Option<PageRecord> {
    if value.is_null() {
        return None;
    }
    Some(
        serde_json::from_value(value.clone())
            .unwrap_or_else(|e| panic!("side {name} failed to parse: {e}")),
    )
}

#[test]
fn golden_merge_matches_extension_output_for_every_case() {
    let (now, inputs, expecteds) = cases();
    assert_eq!(inputs.len(), expecteds.len(), "fixture counts align");
    for (case, exp) in inputs.iter().zip(expecteds.iter()) {
        assert_eq!(case["name"], exp["name"], "case ordering aligns");
        let base = parse_side(&case["base"], "base");
        let local = parse_side(&case["local"], "local");
        let remote = parse_side(&case["remote"], "remote");

        let merged = merge_page_record(base.as_ref(), local.as_ref(), remote.as_ref(), now);
        let got = serde_json::to_value(&merged).unwrap();
        let want: Value =
            serde_json::from_str(exp["expectedJson"].as_str().expect("expectedJson")).unwrap();
        assert_eq!(got, want, "case {:?}", case["name"]);
    }
}

#[test]
fn page_file_name_uses_sha256_prefix_of_url() {
    // openssl dgst -sha256 of "https://example.com/a", first 32 hex chars.
    assert_eq!(
        page_file_name("https://example.com/a"),
        "pages/page-2dce0a4c50441bfccfa9caf4b58c3cba.json"
    );
}

#[test]
fn fingerprint_ignores_tombstone_churn_and_is_deterministic() {
    let record: PageRecord = serde_json::from_value(json!({
        "version": 2,
        "url": "https://example.com/a",
        "highlights": [{"id":"h1","updatedAt":10,"notes":[],"color":"yellow","type":"text","content":"h1"}],
        "drawings": [],
        "videoItems": [],
        "diagrams": [],
        "tombstones": {"highlights":{"h2":5},"drawings":{},"comments":{},"videoItems":{},"diagrams":{}}
    }))
    .unwrap();

    // A pure tombstone-count change never moves the fingerprint.
    let mut tombstoned_more = record.clone();
    tombstoned_more.tombstones.highlights.insert("h3".into(), 9);
    assert_eq!(fingerprint(&record), fingerprint(&tombstoned_more));

    // A live-content edit does.
    let mut edited = record.clone();
    edited.highlights[0].set_notes(vec!["changed<!--timestamp:1-->".into()]);
    assert_ne!(fingerprint(&record), fingerprint(&edited));

    // Deterministic across serialize/parse round-trips.
    let reparsed: PageRecord =
        serde_json::from_value(serde_json::to_value(&record).unwrap()).unwrap();
    assert_eq!(fingerprint(&record), fingerprint(&reparsed));
}

use scholiast_core::cue::{chunk, parse, parse_json3, parse_xml, semantic_chunk, split_on_internal_sentences, Cue};

fn cue(start: f64, end: f64, text: &str) -> Cue {
    Cue {
        start,
        end,
        text: text.to_string(),
    }
}

// --- JSON3 -------------------------------------------------------------------

#[test]
fn json3_fixture_parses_events_appends_and_offsets() {
    let raw = include_str!("fixtures/captions/sample.json3");
    let cues = parse_json3(raw);
    assert_eq!(
        cues,
        vec![
            cue(0.0, 2.68, "Welcome to the course, everyone."),
            cue(3.0, 4.5, "Today we cover parsing & lexing"),
            // The append event's dDurationMs extends the start cue's end.
            cue(6.0, 10.0, "Third line continued."),
        ]
    );
}

#[test]
fn json3_malformed_and_empty_payloads_yield_no_cues() {
    assert!(parse_json3("not json at all").is_empty());
    assert!(parse_json3("{}").is_empty());
    assert!(parse_json3(r#"{"events": []}"#).is_empty());
    assert!(parse_json3(r#"{"events": ["nope", 3]}"#).is_empty());
}

// --- XML -----------------------------------------------------------------------

#[test]
fn srv3_xml_fixture_parses_with_entities_and_tag_stripping() {
    let raw = include_str!("fixtures/captions/srv3.xml");
    assert_eq!(
        parse_xml(raw),
        vec![
            cue(0.0, 2.0, "Hello world"),
            cue(2.5, 3.7, "\"Quoted\" <stuff>"),
            // Missing d= → zero duration; tags stripped without a space (TS parity).
            cue(4.0, 4.0, "plaintext"),
        ]
    );
}

#[test]
fn timedtext_xml_fixture_parses_simple_format() {
    let raw = include_str!("fixtures/captions/timedtext.xml");
    assert_eq!(
        parse_xml(raw),
        vec![
            cue(1.5, 3.75, "First & second"),
            cue(10.0, 13.0, "Second line"),
        ]
    );
}

#[test]
fn parse_autodetects_xml_vs_json3() {
    let xml = include_str!("fixtures/captions/srv3.xml");
    let json3 = include_str!("fixtures/captions/sample.json3");
    assert_eq!(parse(xml), parse_xml(xml));
    assert_eq!(parse(json3), parse_json3(json3));
}

// --- Chunking ------------------------------------------------------------------

#[test]
fn chunker_golden_fixture() {
    let input: Vec<Cue> = serde_json::from_str(include_str!("fixtures/chunker/golden_input_cues.json"))
        .expect("golden cues fixture");
    let expected: Vec<scholiast_core::cue::Paragraph> =
        serde_json::from_str(include_str!("fixtures/chunker/golden_paragraphs.json"))
            .expect("golden paragraphs fixture");
    assert_eq!(chunk(&input), expected);
}

#[test]
fn semantic_chunk_flushes_exactly_like_the_ts_source() {
    // Gap flush uses strict >: a 20.0s gap does NOT break, 20.5 does.
    let cues = vec![
        cue(0.0, 1.0, "alpha"),
        cue(20.0, 21.0, "beta"),
        cue(40.5, 41.0, "gamma"),
    ];
    let paras = semantic_chunk(&cues);
    assert_eq!(paras.len(), 2);
    assert_eq!(paras[0].cue_range, [0, 1]);
    assert_eq!(paras[1].cue_range, [2, 2]);

    // Unpunctuated span >= 30s from the paragraph's first cue flushes even
    // though every individual gap stays under the 20s break threshold.
    let cues = vec![
        cue(0.0, 1.0, "one two three"),
        cue(15.0, 16.0, "four five six"),
        cue(31.0, 32.0, "seven eight nine"),
        cue(36.0, 37.0, "and finally done."),
    ];
    let paras = semantic_chunk(&cues);
    assert_eq!(paras.len(), 2);
    assert_eq!(paras[0].cue_range, [0, 2]);
    assert_eq!(paras[1].text, "and finally done.");

    // Sentence end flushes immediately.
    let paras = semantic_chunk(&[cue(0.0, 1.0, "done."), cue(1.5, 2.0, "next")]);
    assert_eq!(paras.len(), 2);
    assert_eq!(paras[0].text, "done.");
}

#[test]
fn split_on_internal_sentences_splits_mid_cue_boundaries() {
    let cues = vec![cue(3.0, 6.0, "it works. And then some")];
    let split = split_on_internal_sentences(&cues);
    assert_eq!(
        split,
        vec![
            cue(3.0, 6.0, "it works."),
            cue(3.0, 6.0, "And then some"),
        ]
    );

    // Lowercase after the period is not a boundary; CJK without an
    // intervening space is not either (the TS regex requires \s+ before its
    // lookahead — ported verbatim).
    assert_eq!(split_on_internal_sentences(&[cue(0.0, 1.0, "e.g. something")]).len(), 1);
    assert_eq!(split_on_internal_sentences(&[cue(0.0, 1.0, "第一句。第二句")]).len(), 1);
}

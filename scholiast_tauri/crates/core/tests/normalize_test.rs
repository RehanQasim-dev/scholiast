use scholiast_core::normalize::{
    extract_video_id, gen_video_id, normalize_url, page_file_name, url_hash,
};

const EPHEMERAL_PARAMS_LIST: [&str; 20] = [
    "t",
    "utm_source",
    "utm_medium",
    "utm_campaign",
    "utm_term",
    "utm_content",
    "ref",
    "ref_src",
    "source",
    "src",
    "fbclid",
    "gclid",
    "dclid",
    "msclkid",
    "twclid",
    "mc_cid",
    "mc_eid",
    "_ga",
    "_gl",
    "si",
];

#[test]
fn strips_utm_and_click_ids_keeps_other_params() {
    assert_eq!(
        normalize_url(
            "https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1"
        ),
        "https://example.com/article?x=1"
    );
}

#[test]
fn strips_t_and_si_but_keeps_list() {
    assert_eq!(
        normalize_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"
    );
}

#[test]
fn strips_t_but_keeps_start() {
    assert_eq!(
        normalize_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45"
    );
}

#[test]
fn strips_ref_family_but_keeps_unnamed_utm_param() {
    assert_eq!(
        normalize_url(
            "https://example.com/path?utm_foo=kept&src=stripped&ref_src=stripped&source=stripped&ref=stripped"
        ),
        "https://example.com/path?utm_foo=kept"
    );
}

#[test]
fn strips_every_ephemeral_param() {
    for param in EPHEMERAL_PARAMS_LIST {
        let url = format!("https://example.com/p?{param}=value&keep=1");
        assert_eq!(
            normalize_url(&url),
            "https://example.com/p?keep=1",
            "param {param} must be stripped"
        );
    }
}

#[test]
fn strips_bare_param_with_no_value() {
    assert_eq!(
        normalize_url("https://example.com/p?t&v=1"),
        "https://example.com/p?v=1"
    );
}

#[test]
fn strips_percent_encoded_param_names() {
    assert_eq!(
        normalize_url("https://example.com/p?utm%5Fsource=x&a=1"),
        "https://example.com/p?a=1"
    );
}

#[test]
fn preserves_original_param_order() {
    assert_eq!(
        normalize_url("https://example.com/p?b=2&a=1"),
        "https://example.com/p?b=2&a=1"
    );
}

#[test]
fn drops_the_fragment() {
    assert_eq!(
        normalize_url("https://example.com/path/page#frag"),
        "https://example.com/path/page"
    );
    assert_eq!(
        normalize_url("https://www.youtube.com/watch?v=dQw4w9WgXcQ#fragment&foo=bar"),
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ"
    );
}

#[test]
fn keeps_trailing_slash_on_non_empty_path() {
    assert_eq!(
        normalize_url("https://example.com/path/page/"),
        "https://example.com/path/page/"
    );
}

#[test]
fn adds_slash_for_empty_path() {
    assert_eq!(normalize_url("https://example.com"), "https://example.com/");
}

#[test]
fn lowercases_scheme_and_host() {
    assert_eq!(
        normalize_url("HTTPS://EXAMPLE.COM/"),
        "https://example.com/"
    );
}

#[test]
fn drops_default_ports_keeps_custom_ports() {
    assert_eq!(
        normalize_url("http://example.com:80/"),
        "http://example.com/"
    );
    assert_eq!(
        normalize_url("https://example.com:443/"),
        "https://example.com/"
    );
    assert_eq!(
        normalize_url("http://localhost:8080/x"),
        "http://localhost:8080/x"
    );
}

#[test]
fn resolves_dot_segments() {
    assert_eq!(
        normalize_url("https://example.com/a/b/../c/./d"),
        "https://example.com/a/c/d"
    );
}

#[test]
fn re_encodes_query_like_url_search_params() {
    assert_eq!(
        normalize_url("https://example.com/a%20b?q=hello%20world"),
        "https://example.com/a%20b?q=hello+world"
    );
    assert_eq!(
        normalize_url("https://example.com/x?r=100%25"),
        "https://example.com/x?r=100%25"
    );
}

#[test]
fn returns_input_unchanged_when_unparseable() {
    assert_eq!(normalize_url("not a url"), "not a url");
    assert_eq!(
        normalize_url("https://example.com/a b"),
        "https://example.com/a b"
    );
}

#[test]
fn extracts_from_watch_with_v_anywhere_in_query() {
    assert_eq!(
        extract_video_id("https://www.youtube.com/watch?v=dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/watch?list=PL123&v=dQw4w9WgXcQ&index=5"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/watch?t=60&v=dQw4w9WgXcQ&start=30"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://m.youtube.com/watch?v=dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );
}

#[test]
fn extracts_from_youtu_be_short_links() {
    assert_eq!(
        extract_video_id("https://youtu.be/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://youtu.be/dQw4w9WgXcQ?t=30"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://youtu.be/dQw4w9WgXcQ/extra/path"),
        Some("dQw4w9WgXcQ".to_string())
    );
}

#[test]
fn extracts_from_shorts_embed_and_live() {
    assert_eq!(
        extract_video_id("https://youtube.com/shorts/dQw4w9WgXcQ?feature=share"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://youtube.com/shorts/dQw4w9WgXcQ/extra"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/embed/dQw4w9WgXcQ?start=45"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ"),
        Some("dQw4w9WgXcQ".to_string())
    );
    assert_eq!(
        extract_video_id("https://www.youtube.com/live/dQw4w9WgXcQ?feature=share"),
        Some("dQw4w9WgXcQ".to_string())
    );
}

#[test]
fn returns_none_for_invalid_or_non_youtube_urls() {
    assert_eq!(
        extract_video_id("https://example.com/watch?v=dQw4w9WgXcQ"),
        None
    );
    assert_eq!(extract_video_id("https://www.youtube.com/watch?v="), None);
    assert_eq!(extract_video_id("https://www.youtube.com/watch"), None);
    assert_eq!(extract_video_id("https://www.youtube.com/"), None);
    assert_eq!(extract_video_id("https://youtu.be/"), None);
    assert_eq!(extract_video_id("https://www.youtube.com/shorts/"), None);
    assert_eq!(extract_video_id("not a url"), None);
    assert_eq!(extract_video_id(""), None);
}

const HASH_FIXTURES: [(&str, &str); 18] = [
    (
        "https://example.com/article?x=1",
        "bbeb724611106d499bfaeeae2808c1e8",
    ),
    (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123",
        "459380db164cf39befe833994c12f996",
    ),
    (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=45",
        "30e4864ca20bce8c335eefe292cd3d2d",
    ),
    (
        "https://example.com/path?utm_foo=kept",
        "9d9cf7778600782ef29ec22967de3cc9",
    ),
    ("https://example.com/", "0f115db062b7c0dd030b16878c99dea5"),
    ("http://example.com/", "2a1b402420ef46577471cdc7409b0fa2"),
    (
        "https://example.com/x?q=a+b&r=100%25",
        "868b1a279795d4516421bfd5bd50780c",
    ),
    (
        "https://example.com/a%20b?q=hello+world",
        "65c1417c3fc9fb7b5ace07afb4c752f9",
    ),
    (
        "https://example.com/a/c/d",
        "ed550e401b1cd8092fdfebd37be49217",
    ),
    (
        "https://example.com/path/page/",
        "253bd110def6ba931e5e03bf2b61ad85",
    ),
    (
        "https://example.com/path/page",
        "f4487e8e7088d8af42048fbb4a928934",
    ),
    (
        "https://youtu.be/dQw4w9WgXcQ",
        "61e610a9d7fd37bc9df752aa7dd374f0",
    ),
    (
        "https://youtube.com/shorts/dQw4w9WgXcQ?feature=share",
        "8bfffba315e07741070a5ecf37ed21bf",
    ),
    (
        "https://www.youtube.com/embed/dQw4w9WgXcQ",
        "9a48466f10433f4ba5c859c48b958368",
    ),
    (
        "https://www.youtube.com/live/dQw4w9WgXcQ",
        "0c888b3aa897e315ca44982381956578",
    ),
    (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123&index=2",
        "934ff66f65f4da1f3c34c3789b116ce0",
    ),
    (
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&start=30",
        "c47071a1399995ef4d73002507481fb2",
    ),
    (
        "https://m.youtube.com/watch?v=dQw4w9WgXcQ",
        "71c5a3c2ade54326f3805c0e322f8c69",
    ),
];

#[test]
fn url_hash_matches_ts_fixtures() {
    for (url, expected) in HASH_FIXTURES {
        assert_eq!(url_hash(url), expected, "hash of {url}");
    }
}

#[test]
fn url_hash_is_32_lowercase_hex_chars() {
    for (url, _) in HASH_FIXTURES {
        let hash = url_hash(url);
        assert_eq!(hash.len(), 32);
        assert_eq!(hash.to_lowercase(), hash);
        assert!(hash.bytes().all(|b| b.is_ascii_hexdigit()));
    }
}

#[test]
fn page_file_name_matches_ts_output() {
    for (_, hash) in HASH_FIXTURES {
        assert_eq!(page_file_name(hash), format!("pages/page-{hash}.json"));
    }
}

#[test]
fn page_file_name_is_drive_appdata_path() {
    assert_eq!(
        page_file_name(&url_hash(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&list=PL123"
        )),
        "pages/page-459380db164cf39befe833994c12f996.json"
    );
}

#[test]
fn stripped_and_unstripped_urls_hash_identically() {
    let base = "https://youtu.be/dQw4w9WgXcQ";
    assert_eq!(
        url_hash(base),
        url_hash(&normalize_url(&format!("{base}?t=30")))
    );
    assert_eq!(
        page_file_name(&url_hash(base)),
        "pages/page-61e610a9d7fd37bc9df752aa7dd374f0.json"
    );
}

#[test]
fn normalize_then_hash_matches_fixtures_end_to_end() {
    assert_eq!(
        url_hash(&normalize_url(
            "https://example.com/article?utm_source=newsletter&utm_medium=email&utm_campaign=summer&fbclid=abc123&_ga=GA1.2.1234&x=1"
        )),
        "bbeb724611106d499bfaeeae2808c1e8"
    );
    assert_eq!(
        url_hash(&normalize_url(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc"
        )),
        "459380db164cf39befe833994c12f996"
    );
    assert_eq!(
        url_hash(&normalize_url(
            "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&start=45"
        )),
        "30e4864ca20bce8c335eefe292cd3d2d"
    );
}

#[test]
fn gen_video_id_matches_genvideoid_format() {
    for _ in 0..50 {
        let id = gen_video_id();
        assert!(
            id.len() >= 6,
            "id {id} should be base36 timestamp + random suffix"
        );
        assert!(
            id.chars()
                .all(|c| c.is_ascii_lowercase() || c.is_ascii_digit()),
            "id {id} must be lowercase base36 only"
        );
    }
    let ids: Vec<String> = (0..200).map(|_| gen_video_id()).collect();
    let unique: std::collections::HashSet<&String> = ids.iter().collect();
    assert_eq!(unique.len(), ids.len(), "gen_video_id must not collide");
}

#[test]
fn normalize_is_idempotent_and_hash_is_stable() {
    let corpus = [
        "https://example.com/article?utm_source=x&id=9#top",
        "https://www.youtube.com/watch?v=dQw4w9WgXcQ&t=123&list=PL123&si=abc",
        "http://localhost:8080/x?a=1&b=2",
        "https://example.com/a/b/../c/./d?q=hello%20world&r=100%25",
        "HTTPS://EXAMPLE.COM/",
        "https://user:pw@Example.COM:443/p/?x=%41",
        "not a url",
        "https://example.com/a b",
        "",
    ];
    for url in corpus {
        let once = normalize_url(url);
        assert_eq!(
            normalize_url(&once),
            once,
            "normalize not idempotent on {url:?}"
        );
        assert_eq!(url_hash(url), url_hash(url), "hash unstable on {url:?}");
        assert_eq!(
            page_file_name(&url_hash(url)),
            page_file_name(&url_hash(url))
        );
    }
}

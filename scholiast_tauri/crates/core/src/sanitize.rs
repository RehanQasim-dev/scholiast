//! Sanitizer contract (plan §6.9 step 1): captured article HTML must pass an
//! allowlist sanitizer before it is stored/rendered.
//!
//! Task 23 shipped only the contract + a no-op implementation; task 25 adds
//! the real allowlist sanitizer below. Parsing uses html5ever (via `scraper`)
//! because hand-rolling an entity-correct tokenizer is riskier than trusting
//! a vetted parser; output HTML is rebuilt token-by-token from the parsed
//! tree, so nothing from the input reaches the reader unless this module
//! emits it.
//!
//! Policy:
//! - allowlisted tags kept, all attributes stripped except `img[src,alt]`
//!   and `a[href]`; `srcset`/`sizes` therefore never survive;
//! - dangerous/media elements (`script`, `style`, `iframe`, `svg`, `video`,
//!   …) are removed together with their subtree; every other non-allowlisted
//!   element is unwrapped (children promoted), so text inside `span`/`div`
//!   wrappers survives;
//! - comments, doctypes and processing instructions never reach the output;
//! - `img[src]` / `a[href]` resolve against the capture base URL; only
//!   `http(s)` URLs survive (`javascript:`/`data:`/`mailto:` are dropped);
//! - text and attribute values are re-escaped on emission.

use scraper::{Html, Node};
use url::Url;

/// Turns untrusted HTML into HTML safe to render inside the reader.
pub trait Sanitizer {
    fn sanitize(&self, html: &str) -> String;
}

/// Placeholder used until task 25 delivered the allowlist sanitizer.
/// Passes input through unchanged.
pub struct NoopSanitizer;

impl Sanitizer for NoopSanitizer {
    fn sanitize(&self, html: &str) -> String {
        html.to_string()
    }
}

/// Tags that survive sanitization; every other element is either unwrapped
/// (harmless containers) or dropped with its content (see [`DROPPED`]).
const ALLOWED: &[&str] = &[
    "p", "h1", "h2", "h3", "h4", "h5", "h6", "ul", "ol", "li", "blockquote", "img", "a", "em",
    "strong", "i", "b", "code", "pre", "br", "hr", "figure", "figcaption", "table", "thead",
    "tbody", "tr", "td", "th",
];

/// Elements removed together with their whole subtree: executable or remote
/// content, layout chrome whose text is junk (forms, media controls), and
/// metadata heads. Everything else not in [`ALLOWED`] is unwrapped.
const DROPPED: &[&str] = &[
    "script", "style", "noscript", "template", "iframe", "frame", "frameset", "object", "embed",
    "applet", "svg", "math", "video", "audio", "source", "track", "canvas", "map", "head",
    "title", "meta", "link", "base", "form", "input", "button", "select", "option", "textarea",
    "label", "fieldset", "legend", "datalist", "dialog",
];

/// Allowlisted void elements (no closing tag, no children).
const VOID: &[&str] = &["br", "hr", "img"];

/// The real reader sanitizer. Holds the capture-time base URL used to make
/// `img[src]` / `a[href]` absolute.
#[derive(Debug, Clone, Default)]
pub struct AllowlistSanitizer {
    base_url: Option<Url>,
}

impl AllowlistSanitizer {
    /// `base_url` should be the page the HTML was captured from; unparseable
    /// values degrade to "absolute URLs only".
    pub fn new(base_url: Option<&str>) -> Self {
        AllowlistSanitizer {
            base_url: base_url.and_then(|b| Url::parse(b).ok()),
        }
    }

    pub fn base_url(&self) -> Option<&Url> {
        self.base_url.as_ref()
    }
}

impl Sanitizer for AllowlistSanitizer {
    fn sanitize(&self, html: &str) -> String {
        sanitize_html(html, self.base_url.as_ref().map(Url::as_str))
    }
}

/// Pure entry point: sanitize `html`, resolving relative URLs against
/// `base_url`. Idempotent — sanitized output re-sanitizes to itself.
pub fn sanitize_html(html: &str, base_url: Option<&str>) -> String {
    let base = base_url.and_then(|b| Url::parse(b).ok());
    let fragment = Html::parse_fragment(html);
    let mut out = String::with_capacity(html.len());
    for child in fragment.tree.root().children() {
        emit(child, base.as_ref(), &mut out);
    }
    out
}

fn emit(node: ego_tree::NodeRef<'_, Node>, base: Option<&Url>, out: &mut String) {
    match node.value() {
        Node::Text(text) => push_escaped(out, &**text),
        Node::Element(element) => {
            let name = element.name();
            if DROPPED.contains(&name) {
                return;
            }
            if !ALLOWED.contains(&name) {
                // Harmless container (span/div/article/…): unwrap it.
                for child in node.children() {
                    emit(child, base, out);
                }
                return;
            }
            out.push('<');
            out.push_str(name);
            push_allowed_attrs(out, name, element, base);
            out.push('>');
            if !VOID.contains(&name) {
                for child in node.children() {
                    emit(child, base, out);
                }
                out.push_str("</");
                out.push_str(name);
                out.push('>');
            }
        }
        // Comments (incl. IE conditional comments), doctypes, PIs: gone.
        _ => {}
    }
}

fn push_allowed_attrs(
    out: &mut String,
    name: &str,
    element: &scraper::node::Element,
    base: Option<&Url>,
) {
    match name {
        "img" => {
            let is_placeholder = |url_str: &str| -> bool {
                let lower = url_str.to_ascii_lowercase();
                lower.ends_with("/spacer.gif")
                    || lower.ends_with("/blank.gif")
                    || lower.ends_with("/placeholder.png")
                    || lower.contains("1x1")
                    || lower.contains("transparent")
            };
            let direct_src = element
                .attr("src")
                .and_then(|raw| resolve_url(base, raw))
                .filter(|resolved| !is_placeholder(resolved));

            let resolved_src = direct_src
                .or_else(|| {
                    element
                        .attr("data-src")
                        .and_then(|raw| resolve_url(base, raw))
                })
                .or_else(|| {
                    element
                        .attr("data-original")
                        .and_then(|raw| resolve_url(base, raw))
                })
                .or_else(|| {
                    element
                        .attr("data-original-src")
                        .and_then(|raw| resolve_url(base, raw))
                })
                .or_else(|| {
                    element
                        .attr("data-lazy-src")
                        .and_then(|raw| resolve_url(base, raw))
                })
                .or_else(|| {
                    element
                        .attr("data-actualsrc")
                        .and_then(|raw| resolve_url(base, raw))
                })
                .or_else(|| {
                    element
                        .attr("srcset")
                        .and_then(first_srcset_url)
                        .and_then(|raw| resolve_url(base, &raw))
                })
                .or_else(|| {
                    element
                        .attr("data-srcset")
                        .and_then(first_srcset_url)
                        .and_then(|raw| resolve_url(base, &raw))
                })
                .or_else(|| {
                    element.attr("src").and_then(|raw| resolve_url(base, raw))
                });
            if let Some(src) = resolved_src {
                push_attr(out, "src", &src);
                push_attr(out, "referrerpolicy", "no-referrer");
            }
            if let Some(alt) = element.attr("alt") {
                push_attr(out, "alt", alt);
            }
            if let Some(w) = element.attr("width").filter(|v| is_positive_int(v)) {
                push_attr(out, "width", w);
            }
            if let Some(h) = element.attr("height").filter(|v| is_positive_int(v)) {
                push_attr(out, "height", h);
            }
            if let Some(loading) = element
                .attr("loading")
                .filter(|v| matches!(*v, "lazy" | "eager"))
            {
                push_attr(out, "loading", loading);
            }
        }
        "a" => {
            if let Some(href) = element.attr("href").and_then(|raw| resolve_url(base, raw)) {
                push_attr(out, "href", &href);
            }
        }
        "td" | "th" => {
            if let Some(cs) = element.attr("colspan").filter(|v| is_span_value(v)) {
                push_attr(out, "colspan", cs);
            }
            if let Some(rs) = element.attr("rowspan").filter(|v| is_span_value(v)) {
                push_attr(out, "rowspan", rs);
            }
        }
        _ => {}
    }
}

fn first_srcset_url(srcset: &str) -> Option<String> {
    srcset
        .split(',')
        .next()
        .and_then(|c| c.trim().split_ascii_whitespace().next())
        .map(|s| s.to_string())
}

fn is_span_value(v: &str) -> bool {
    v.trim().parse::<u32>().is_ok_and(|n| (1..=1000).contains(&n))
}

fn is_positive_int(v: &str) -> bool {
    v.trim().parse::<u32>().is_ok_and(|n| n > 0 && n <= 10000)
}

fn push_attr(out: &mut String, name: &str, value: &str) {
    out.push(' ');
    out.push_str(name);
    out.push_str("=\"");
    push_escaped(out, value);
    out.push('"');
}

fn push_escaped(out: &mut String, text: impl AsRef<str>) {
    for c in text.as_ref().chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            _ => out.push(c),
        }
    }
}

/// Resolves one URL the way a browser would before fetching: surrounding
/// whitespace trimmed, stray tabs/newlines inside removed, relative paths
/// joined onto the page URL. Only http(s) survives — `javascript:`,
/// `data:`, `mailto:` etc. are refused.
fn resolve_url(base: Option<&Url>, raw: &str) -> Option<String> {
    let trimmed = raw.trim_matches(|c: char| c.is_ascii_whitespace() || c == '\u{feff}');
    let cleaned: String = trimmed.chars().filter(|c| !c.is_ascii_control()).collect();
    if cleaned.is_empty() {
        return None;
    }
    let resolved = match base {
        Some(base) => base.join(&cleaned).ok()?,
        None => Url::parse(&cleaned).ok()?,
    };
    matches!(resolved.scheme(), "http" | "https").then(|| resolved.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn wash(html: &str) -> String {
        sanitize_html(html, None)
    }

    fn wash_with_base(html: &str, base: &str) -> String {
        sanitize_html(html, Some(base))
    }

    #[test]
    fn noop_passes_html_through_unchanged() {
        let html = "<article><h1>Hi</h1><p>Body &amp; more</p></article>";
        assert_eq!(NoopSanitizer.sanitize(html), html);
    }

    #[test]
    fn noop_handles_empty_input() {
        assert_eq!(NoopSanitizer.sanitize(""), "");
    }

    #[test]
    fn contract_is_object_safe() {
        // Downstream code stores `Box<dyn Sanitizer>` / generics; prove both work.
        fn wash(s: &dyn Sanitizer, html: &str) -> String {
            s.sanitize(html)
        }
        fn wash_generic<S: Sanitizer>(s: &S, html: &str) -> String {
            s.sanitize(html)
        }
        let boxed: Box<dyn Sanitizer> = Box::new(NoopSanitizer);
        assert_eq!(wash(boxed.as_ref(), "<b>x</b>"), "<b>x</b>");
        assert_eq!(wash_generic(&NoopSanitizer, "y"), "y");
    }

    #[test]
    fn allowlisted_structure_passes_through() {
        let html = concat!(
            "<h1>Title</h1>",
            "<p>Plain <strong>bold</strong>, <em>italic</em>, <code>x</code>.</p>",
            "<blockquote><p>Quoted</p></blockquote>",
            "<ul><li>one</li><li>two</li></ul>",
            "<pre><code>let x = 1;</code></pre>",
            "<figure><figcaption>Caption</figcaption></figure>",
            "<table><thead><tr><th>H</th></tr></thead><tbody><tr><td>D</td></tr></tbody></table>"
        );
        assert_eq!(wash(html), html);
    }

    #[test]
    fn script_style_iframe_and_svg_are_removed_with_content() {
        let out = wash(concat!(
            "<p>before</p>",
            "<script>alert('<evil>')</script>",
            "<style>.x { color: red }</style>",
            "<iframe src=\"https://evil.example\"></iframe>",
            "<svg><circle r=\"1\"/></svg>",
            "<video src=\"x.mp4\"></video>",
            "<audio src=\"x.mp3\"></audio>",
            "<p>after</p>"
        ));
        assert_eq!(out, "<p>before</p><p>after</p>");
    }

    #[test]
    fn event_handler_style_class_id_attrs_are_stripped() {
        let out = wash(
            "<p onclick=\"steal()\" class=\"fancy\" id=\"lead\" style=\"color:red\" data-x=\"1\">t</p>",
        );
        assert_eq!(out, "<p>t</p>");
    }

    #[test]
    fn img_keeps_only_resolved_src_and_alt() {
        let out = wash_with_base(
            "<img srcset=\"a.jpg 1x\" sizes=\"50vw\" loading=\"lazy\" class=\"c\" \
             src=\"/img/pic.jpg\" alt=\"A picture\">",
            "https://example.com/post/1",
        );
        assert_eq!(
            out,
            "<img src=\"https://example.com/img/pic.jpg\" alt=\"A picture\" loading=\"lazy\">"
        );
    }

    #[test]
    fn anchors_resolve_relative_and_drop_javascript_schemes() {
        let base = "https://example.com/dir/page";
        assert_eq!(
            wash_with_base("<a href=\"other.html\">rel</a>", base),
            "<a href=\"https://example.com/dir/other.html\">rel</a>"
        );
        assert_eq!(
            wash_with_base("<a href=\"//cdn.example/x\">proto-rel</a>", base),
            "<a href=\"https://cdn.example/x\">proto-rel</a>"
        );
        assert_eq!(
            wash_with_base("<a href=\"javascript:alert(1)\">js</a>", base),
            "<a>js</a>"
        );
        assert_eq!(
            wash_with_base("<a href=\"#section\">frag</a>", base),
            "<a href=\"https://example.com/dir/page#section\">frag</a>"
        );
    }

    #[test]
    fn img_data_urls_are_dropped() {
        assert_eq!(
            wash_with_base(
                "<img src=\"data:image/png;base64,AAAA\" alt=\"d\">",
                "https://example.com/"
            ),
            "<img alt=\"d\">"
        );
    }

    #[test]
    fn harmless_containers_unwrap_keeping_text() {
        assert_eq!(
            wash("<div class=\"wrap\"><span style=\"x\">hello <u>u</u></span></div>"),
            "hello u"
        );
    }

    #[test]
    fn forms_vanish_entirely() {
        assert_eq!(
            wash("<p>a</p><form action=\"/\"><input name=\"q\"><button>Go</button></form><p>b</p>"),
            "<p>a</p><p>b</p>"
        );
    }

    #[test]
    fn entities_round_trip_and_text_is_reescaped() {
        assert_eq!(wash("Fish &amp; Chips"), "Fish &amp; Chips");
        assert_eq!(wash("a < b"), "a &lt; b");
        assert_eq!(wash("<p title=\"&quot;q&quot;\">x</p>"), "<p>x</p>");
        // pre/code contents are escaped like any other text — renders equal.
        assert_eq!(wash("<pre>if (a &lt; b)</pre>"), "<pre>if (a &lt; b)</pre>");
    }

    #[test]
    fn comments_doctype_and_processing_instructions_are_gone() {
        assert_eq!(
            wash("<!-- hidden --><!DOCTYPE html><?php echo 1; ?><p>t</p>"),
            "<p>t</p>"
        );
    }

    #[test]
    fn empty_and_plain_text_inputs() {
        assert_eq!(wash(""), "");
        assert_eq!(wash("just words"), "just words");
    }

    #[test]
    fn sanitization_is_idempotent() {
        let dirty = concat!(
            "<div class=\"a\"><p onclick=\"x\">One <b>two</b></p>",
            "<script>bad()</script><img src=\"/r.png\" alt=\"r\"></div>"
        );
        let once = wash_with_base(dirty, "https://example.com/a");
        let twice = wash_with_base(&once, "https://example.com/a");
        assert_eq!(once, twice);
    }

    #[test]
    fn sanitizer_trait_impl_matches_free_function() {
        let s = AllowlistSanitizer::new(Some("https://example.com/p/1"));
        assert_eq!(
            s.sanitize("<img src=\"i.png\" srcset=\"i2.png 2x\">"),
            "<img src=\"https://example.com/p/i.png\">"
        );
        assert_eq!(AllowlistSanitizer::default().sanitize("<b>b</b>"), "<b>b</b>");
    }

    #[test]
    fn fixture_dirty_article_is_fully_cleaned() {
        let dirty = include_str!("../tests/fixtures/reader/dirty-article.html");
        let out = sanitize_html(dirty, Some("https://blog.example.org/posts/highlighters"));
        assert!(out.contains("<h1>"), "headings survive: {out}");
        assert!(out.contains("Hidden Lives of Highlighters"));
        assert!(!out.contains("<script"));
        assert!(!out.contains("alert("));
        assert!(!out.contains("<iframe"));
        assert!(!out.contains("<svg"));
        assert!(!out.contains("onclick"));
        assert!(!out.contains("class="));
        assert!(!out.contains("srcset"));
        assert!(
            out.contains("https://blog.example.org/images/header.jpg"),
            "relative image becomes absolute: {out}"
        );
        assert!(out.contains("https://cdn.example.org/img/inline.png"));
    }
}

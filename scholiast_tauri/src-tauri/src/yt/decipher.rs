//! base.js sig/n deciphering (`NewPipe` `YoutubeSignatureUtils` +
//! `YoutubeThrottlingParameterUtils` recipe, `youtubei.js` `JsExtractor` behavior).
//!
//! YouTube ships ciphered stream URLs plus a player JS bundle containing the
//! inverse functions. This module downloads `base.js` (cached per player id),
//! extracts the sig + n functions with their helper objects (stacked regexes
//! + brace matching, mirroring upstream's lexer→regex fallbacks), and runs
//! them in the embedded Boa JS engine (pure Rust: builds for every release
//! target, unlike QuickJS bindings). Any rotation YouTube ships surfaces
//! as `YtError::Decipher` — never a panic, never silent wrong bytes.

use std::collections::HashMap;
use std::sync::Mutex;

use super::error::YtError;

/// Extracted, evaluable sources for one player build.
#[derive(Debug, Clone)]
pub struct PlayerSources {
    pub sig_src: String,
    pub n_src: Option<String>,
    pub sts: Option<u64>,
}

pub struct DecipherEngine {
    http: reqwest::Client,
    base_url: String,
    base_js: Mutex<HashMap<String, String>>,
    sources: Mutex<HashMap<String, PlayerSources>>,
    n_cache: Mutex<HashMap<(String, String), String>>,
}

impl DecipherEngine {
    pub fn new() -> Self {
        DecipherEngine {
            http: reqwest::Client::new(),
            base_url: "https://www.youtube.com".to_string(),
            base_js: Mutex::new(HashMap::new()),
            sources: Mutex::new(HashMap::new()),
            n_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Test seam: point discovery at a wiremock server.
    #[cfg(test)]
    pub fn with_base(base: &str) -> Self {
        DecipherEngine {
            http: reqwest::Client::new(),
            base_url: base.trim_end_matches('/').to_string(),
            base_js: Mutex::new(HashMap::new()),
            sources: Mutex::new(HashMap::new()),
            n_cache: Mutex::new(HashMap::new()),
        }
    }

    /// Player id for the current rollout (`/iframe_api` hash, `/embed/`
    /// `jsUrl` fallback — same two locators youtubei.js uses).
    pub async fn player_id(&self, video_id: &str) -> Result<String, YtError> {
        let api = self
            .http
            .get(format!("{}/iframe_api", self.base_url))
            .send()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?;
        if let Some(id) = find_player_hash(&api) {
            return Ok(id);
        }
        let embed = self
            .http
            .get(format!("{}/embed/{}", self.base_url, video_id))
            .send()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?;
        find_embed_js_url(&embed)
            .as_deref()
            .and_then(find_player_hash)
            .ok_or_else(|| YtError::Decipher("player id not found".into()))
    }

    async fn base_js(&self, player_id: &str) -> Result<String, YtError> {
        if let Some(cached) = self.base_js.lock().ok().and_then(|g| g.get(player_id).cloned()) {
            return Ok(cached);
        }
        let url = format!(
            "{}/s/player/{}/player_ias.vflset/en_US/base.js",
            self.base_url, player_id
        );
        let code = self
            .http
            .get(&url)
            .send()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?
            .text()
            .await
            .map_err(|e| YtError::Network(e.to_string()))?;
        if code.len() < 128 {
            // Garbage/empty bodies; anything bigger still has to survive
            // source extraction below, which is the real gate.
            return Err(YtError::Decipher("base.js too short".into()));
        }
        if let Ok(mut guard) = self.base_js.lock() {
            guard.insert(player_id.to_string(), code.clone());
            if guard.len() > 4 {
                guard.clear();
                guard.insert(player_id.to_string(), code.clone());
            }
        }
        Ok(code)
    }

    /// Extracted sources for a player build (cached).
    pub async fn sources(&self, player_id: &str, video_id: &str) -> Result<PlayerSources, YtError> {
        if let Some(cached) = self.sources.lock().ok().and_then(|g| g.get(player_id).cloned()) {
            return Ok(cached);
        }
        // `video_id` is unused today (base.js is global); kept so a future
        // per-video locator can slot in without changing callers.
        let _ = video_id;
        let code = self.base_js(player_id).await?;
        let found = extract_sources(&code)?;
        if let Ok(mut guard) = self.sources.lock() {
            guard.insert(player_id.to_string(), found.clone());
        }
        Ok(found)
    }

    /// Inverse the `s` parameter of a signatureCipher.
    pub async fn deobfuscate_sig(
        &self,
        player_id: &str,
        video_id: &str,
        sig: &str,
    ) -> Result<String, YtError> {
        let sources = self.sources(player_id, video_id).await?;
        eval_snippet(&sources.sig_src, sig)
            .await
            .map_err(|m| YtError::Decipher(format!("sig eval: {m}")))
    }

    /// Descramble the `n` throttling parameter (per-`n` cached). A missing
    /// n-function means this build needs none — the input passes through.
    pub async fn descramble_n(
        &self,
        player_id: &str,
        video_id: &str,
        n: &str,
    ) -> Result<String, YtError> {
        if let Some(hit) = self
            .n_cache
            .lock()
            .ok()
            .and_then(|g| g.get(&(player_id.to_string(), n.to_string())).cloned())
        {
            return Ok(hit);
        }
        let sources = self.sources(player_id, video_id).await?;
        let Some(n_src) = sources.n_src.clone() else {
            return Ok(n.to_string());
        };
        let out = eval_snippet(&n_src, n)
            .await
            .map_err(|m| YtError::Decipher(format!("n eval: {m}")))?;
        if out.is_empty() {
            return Err(YtError::Decipher("empty n result".into()));
        }
        if let Ok(mut guard) = self.n_cache.lock() {
            guard.insert((player_id.to_string(), n.to_string()), out.clone());
        }
        Ok(out)
    }
}

/// `player/<hash>/` inside the iframe_api bootstrap.
fn find_player_hash(text: &str) -> Option<String> {
    let from = text.find("player\\/")? + "player\\/".len();
    let hash: String = text[from..].chars().take(8).collect();
    if hash.len() == 8 && hash.chars().all(|c| c.is_ascii_alphanumeric()) {
        Some(hash)
    } else {
        None
    }
}

/// `"jsUrl":"/s/player/<hash>/..."` inside an embed watch page.
fn find_embed_js_url(text: &str) -> Option<String> {
    let key = "\"jsUrl\":\"";
    let from = text.find(key)? + key.len();
    let end = text[from..].find('"')?;
    Some(text[from..from + end].to_string())
}

/// `signatureTimestamp=12345` / `signatureTimestamp:12345`.
fn find_sts(code: &str) -> Option<u64> {
    for pat in ["signatureTimestamp=", "signatureTimestamp:"] {
        let mut rest = code;
        while let Some(pos) = rest.find(pat) {
            let digits: String = rest[pos + pat.len()..]
                .chars()
                .take_while(|c| c.is_ascii_digit())
                .collect();
            if !digits.is_empty() {
                if let Ok(sts) = digits.parse() {
                    return Some(sts);
                }
            }
            rest = &rest[pos + pat.len()..];
        }
    }
    None
}

/// Extract a `{...}` or `(...)`-balanced slice starting at `open_idx`
/// (index of the opening brace), skipping strings/comments.
fn balanced(code: &str, open_idx: usize, open: char, close: char) -> Option<String> {
    let bytes = code.as_bytes();
    if bytes.get(open_idx) != Some(&(open as u8)) {
        return None;
    }
    let mut depth = 0usize;
    let mut i = open_idx;
    let mut str_mark: Option<u8> = None;
    let mut escaped = false;
    let mut line_comment = false;
    let mut block_comment = false;
    while i < bytes.len() {
        let b = bytes[i];
        if line_comment {
            if b == b'\n' {
                line_comment = false;
            }
        } else if block_comment {
            if b == b'*' && bytes.get(i + 1) == Some(&b'/') {
                block_comment = false;
                i += 1;
            }
        } else if let Some(q) = str_mark {
            if escaped {
                escaped = false;
            } else if b == b'\\' {
                escaped = true;
            } else if b == q {
                str_mark = None;
            }
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'/') {
            line_comment = true;
            i += 1;
        } else if b == b'/' && bytes.get(i + 1) == Some(&b'*') {
            block_comment = true;
            i += 1;
        } else if b == b'\'' || b == b'"' || b == b'`' {
            str_mark = Some(b);
        } else if b == open as u8 {
            depth += 1;
        } else if b == close as u8 {
            depth -= 1;
            if depth == 0 {
                return Some(code[open_idx..=i].to_string());
            }
        }
        i += 1;
    }
    None
}

/// Identifier immediately before `pos` (for `NAME=function` / `NAME={`).
fn ident_before(code: &str, mut pos: usize) -> Option<String> {
    let bytes = code.as_bytes();
    while pos > 0 && (bytes[pos - 1] == b' ' || bytes[pos - 1] == b'\t' || bytes[pos - 1] == b'\n') {
        pos -= 1;
    }
    // Skip `=`, `:` or `(` variants: callers pass the operator index.
    let mut end = pos;
    while end > 0 && is_ident(bytes[end - 1] as char) {
        end -= 1;
    }
    if end == pos {
        return None;
    }
    Some(code[end..pos].to_string())
}

fn is_ident(c: char) -> bool {
    c.is_ascii_alphanumeric() || c == '_' || c == '$'
}

/// First `OBJ.member(` call inside a function body → helper object name.
fn helper_object(body: &str) -> Option<String> {
    let mut i = 0;
    while i < body.len() {
        let dot = match body[i..].find('.') {
            Some(d) => i + d,
            None => return None,
        };
        // Walk the identifier before the dot.
        let mut start = dot;
        while start > 0 && is_ident(body.as_bytes()[start - 1] as char) {
            start -= 1;
        }
        let name = &body[start..dot];
        // Followed by `member(` with a lowercase member (method call, not ctor).
        let after_dot = &body[dot + 1..];
        let mut m = 0;
        while m < after_dot.len() && is_ident(after_dot.as_bytes()[m] as char) {
            m += 1;
        }
        let member = &after_dot[..m];
        if !name.is_empty()
            && name.len() >= 2
            && !member.is_empty()
            && member.chars().next().is_some_and(|c| c.is_ascii_lowercase())
            && after_dot[m..].starts_with('(')
        {
            return Some(name.to_string());
        }
        i = dot + 1;
    }
    None
}

/// `var NAME = {...};` for a helper object.
fn extract_object(code: &str, name: &str) -> Option<String> {
    for prefix in [format!("var {name}="), format!("let {name}="), format!("const {name}="), format!("{name}=")] {
        let mut from = 0;
        while let Some(pos) = code[from..].find(&prefix) {
            let abs = from + pos + prefix.len();
            if let Some(obj) = balanced(code, abs, '{', '}') {
                return Some(format!("var {name}={obj};"));
            }
            from = abs;
        }
    }
    None
}

/// A top-level `function NAME(...) {...}` or `NAME=function(...) {...}`.
fn extract_function(code: &str, name: &str) -> Option<String> {
    // `NAME = function` first (most common in player builds)…
    let assign = format!("{name}=function");
    if let Some(pos) = code.find(&assign) {
        let paren = code[pos + assign.len()..].find('(')? + pos + assign.len();
        let params = balanced(code, paren, '(', ')')?;
        let body_start = code[paren + params.len()..].find('{')? + paren + params.len();
        let body = balanced(code, body_start, '{', '}')?;
        return Some(format!("function {name}{params}{body}"));
    }
    // …then `function NAME(`.
    let decl = format!("function {name}");
    if let Some(pos) = code.find(&decl) {
        let paren = code[pos + decl.len()..].find('(')? + pos + decl.len();
        let params = balanced(code, paren, '(', ')')?;
        let body_start = code[paren + params.len()..].find('{')? + paren + params.len();
        let body = balanced(code, body_start, '{', '}')?;
        return Some(format!("function {name}{params}{body}"));
    }
    None
}

/// Candidate sig-function names: `X=function(p){...p.split("")` for any
/// single-letter-style param (player builds pin `a`, but don't bet on it).
fn sig_candidates(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut from = 0;
    while let Some(pos) = code[from..].find("=function(") {
        let abs = from + pos;
        let rest = &code[abs + "=function(".len()..];
        let mut chars = rest.chars();
        let param = chars.next().unwrap_or(' ');
        if is_ident(param) && rest[param.len_utf8()..].starts_with("){") {
            if let Some(name) = ident_before(code, abs) {
                let tail = &code[abs..(abs + 400).min(code.len())];
                let split1 = format!("{param}.split(\"\")");
                let split2 = format!("{param}.split('')");
                if tail.contains(&split1) || tail.contains(&split2) {
                    out.push(name);
                }
            }
        }
        from = abs + 1;
    }
    out
}

/// Candidate n-function names: `...get("n"))&&(b=FN(b)` or nn-array forms.
fn n_candidates(code: &str) -> Vec<String> {
    let mut out = Vec::new();
    for pat in ["&&(b=", "&&(c=", ",b="] {
        let mut from = 0;
        while let Some(pos) = code[from..].find(pat) {
            let abs = from + pos + pat.len();
            let name: String = code[abs..].chars().take_while(|c| is_ident(*c)).collect();
            if !name.is_empty() && code[abs + name.len()..].starts_with('(') {
                out.push(name);
            }
            from = abs + 1;
        }
    }
    // `String.fromCharCode(110)` / `"nn"` holder forms: nearest function decl.
    for pat in ["fromCharCode(110)", "\"nn\""] {
        if let Some(pos) = code.find(pat) {
            let back = code[..pos].rfind("=function(").and_then(|p| ident_before(code, p));
            if let Some(name) = back {
                out.push(name);
            }
        }
    }
    out.sort();
    out.dedup();
    out
}

/// Assemble `{helper}\n{function}` for evaluation, or `None` when the helper
/// cannot be located (caller tries the next candidate).
fn assemble(code: &str, name: &str) -> Option<String> {
    let func = extract_function(code, name)?;
    let mut src = String::new();
    if let Some(helper) = helper_object(&func) {
        if let Some(obj) = extract_object(code, &helper) {
            src.push_str(&obj);
            src.push('\n');
        } else {
            return None;
        }
    }
    src.push_str(&func);
    Some(src)
}

/// Full source extraction for one player build (pure — unit-testable).
pub fn extract_sources(code: &str) -> Result<PlayerSources, YtError> {
    let mut sig_src = None;
    for name in sig_candidates(code) {
        if let Some(src) = assemble(code, &name) {
            sig_src = Some(src);
            break;
        }
    }
    let sig_src = sig_src.ok_or_else(|| YtError::Decipher("sig function not found".into()))?;

    let mut n_src = None;
    for name in n_candidates(code) {
        if let Some(src) = assemble(code, &name) {
            n_src = Some(src);
            break;
        }
    }

    Ok(PlayerSources { sig_src, n_src, sts: find_sts(code) })
}

/// Run `ENTRY(JSON_input)` in an embedded pure-Rust JS engine on a blocking
/// thread (keeps the async runtime unblocked during evaluation).
async fn eval_snippet(src: &str, input: &str) -> Result<String, String> {
    let entry = entry_name(src).ok_or_else(|| "no function entry".to_string())?;
    let literal = serde_json::to_string(input).map_err(|e| e.to_string())?;
    let code = format!("{src}\n{entry}({literal});");
    tokio::task::spawn_blocking(move || {
        let mut ctx = boa_engine::Context::default();
        let value = ctx
            .eval(boa_engine::Source::from_bytes(&code))
            .map_err(|e| e.to_string())?;
        value
            .to_string(&mut ctx)
            .map(|s| s.to_std_string_escaped())
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// First `function NAME(` of the assembled main function (appended last).
fn entry_name(src: &str) -> Option<String> {
    let pos = src.rfind("function ")? + "function ".len();
    let name: String = src[pos..].chars().take_while(|c| is_ident(*c)).collect();
    if name.is_empty() { None } else { Some(name) }
}

#[cfg(test)]
mod tests {
    use super::*;

    /// Minimal synthetic player exercising the exact shape the extractor
    /// expects (split-based sig fn + helper object + nn-style n fn with a
    /// `get("n")` call site, as in real player builds).
    const SYNTH: &str = r#"
var AB={kq:function(a,b){var c=a[0];a[0]=a[b%a.length];a[b]=c;return a;},rr:function(a){return a.reverse();}};
var xy=function(a){a=a.split("");AB.kq(a,3);AB.rr(a);return a.join("")};
var CD={qr:function(b){b.reverse();return b;}};
var nn=function(b){b=b.split("");CD.qr(b);return b.join("")};
var out=(p.get("n"))&&(b=nn(b));
var signatureTimestamp=19777;
"#;

    #[test]
    fn extracts_synth_sources() {
        let found = extract_sources(SYNTH).unwrap();
        assert!(found.sig_src.contains("function xy"));
        assert!(found.sig_src.contains("var AB="));
        assert!(found.n_src.as_ref().unwrap().contains("function nn"));
        assert_eq!(found.sts, Some(19777));
    }

    #[tokio::test]
    async fn evaluates_synth_snippet() {
        let found = extract_sources(SYNTH).unwrap();
        // xy("abcdef"): split → kq(a,3) swaps [0]<->[3] → "dbcaef" →
        // rr reverses → "feacbd".
        assert_eq!(eval_snippet(&found.sig_src, "abcdef").await.unwrap(), "feacbd");
        assert_eq!(
            eval_snippet(found.n_src.as_ref().unwrap(), "abc").await.unwrap(),
            "cba"
        );
    }

    #[test]
    fn rotation_surfaces_clean_error() {
        assert!(extract_sources("var x = 1;").is_err());
    }

    #[test]
    fn player_hash_parsing() {
        assert_eq!(
            find_player_hash("player\\/ab12cd34\\/"),
            Some("ab12cd34".to_string())
        );
        assert_eq!(find_player_hash("nothing here"), None);
    }
}

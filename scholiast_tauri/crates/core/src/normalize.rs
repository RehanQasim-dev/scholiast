use std::fs::File;
use std::io::Read;
use std::time::{SystemTime, UNIX_EPOCH};

const EPHEMERAL_PARAMS: [&str; 20] = [
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

const YOUTUBE_HOSTS: [&str; 3] = ["youtube.com", "www.youtube.com", "m.youtube.com"];

const BASE36: &[u8; 36] = b"0123456789abcdefghijklmnopqrstuvwxyz";

const SHA256_K: [u32; 64] = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

pub fn normalize_url(url: &str) -> String {
    match ParsedUrl::try_parse(url) {
        Some(parsed) => parsed.serialize(),
        None => url.to_string(),
    }
}

pub fn url_hash(url: &str) -> String {
    let digest = sha256(url.as_bytes());
    let mut out = String::with_capacity(32);
    for byte in &digest[..16] {
        out.push_str(&format!("{byte:02x}"));
    }
    out
}

pub fn page_file_name(hash: &str) -> String {
    format!("pages/page-{hash}.json")
}

pub fn extract_video_id(url: &str) -> Option<String> {
    let parsed = ParsedUrl::try_parse(url)?;
    let segment_id = |segment: &str| -> Option<String> {
        segment
            .trim_matches('/')
            .split('/')
            .next()
            .filter(|s| !s.is_empty())
            .map(str::to_string)
    };
    if parsed.host == "youtu.be" {
        return segment_id(&parsed.path);
    }
    if !YOUTUBE_HOSTS.contains(&parsed.host.as_str()) {
        return None;
    }
    for prefix in ["/shorts/", "/embed/", "/live/"] {
        if let Some(rest) = parsed.path.strip_prefix(prefix) {
            return segment_id(rest);
        }
    }
    if parsed.path == "/watch" {
        return query_value(parsed.query.as_deref(), "v").filter(|v| !v.is_empty());
    }
    None
}

pub fn gen_video_id() -> String {
    let millis = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_millis())
        .unwrap_or_default();
    let mut suffix = String::with_capacity(5);
    for byte in random_bytes(5) {
        suffix.push(BASE36[(byte % 36) as usize] as char);
    }
    format!("{}{}", base36(millis), suffix)
}

struct ParsedUrl {
    scheme: String,
    userinfo: Option<String>,
    host: String,
    port: Option<u16>,
    path: String,
    query: Option<String>,
}

impl ParsedUrl {
    fn try_parse(url: &str) -> Option<Self> {
        if !url.bytes().all(|b| (0x21..=0x7e).contains(&b)) {
            return None;
        }
        let (scheme_raw, rest) = url.split_once(':')?;
        let mut scheme_chars = scheme_raw.chars();
        if !scheme_chars.next()?.is_ascii_alphabetic() {
            return None;
        }
        if !scheme_chars.all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.')) {
            return None;
        }
        let scheme = scheme_raw.to_ascii_lowercase();
        let rest = match rest.split_once('#') {
            Some((before, _)) => before,
            None => rest,
        };
        let rest = rest.strip_prefix("//")?;
        let auth_end = rest.find(['/', '?']).unwrap_or(rest.len());
        let authority = &rest[..auth_end];
        let after = &rest[auth_end..];
        let (path_raw, query) = match after.split_once('?') {
            Some((p, q)) => (p, Some(q)),
            None => (after, None),
        };

        let (userinfo, hostport) = match authority.rsplit_once('@') {
            Some((ui, hp)) => (Some(ui.to_string()), hp),
            None => (None, authority),
        };
        if hostport.is_empty() {
            return None;
        }
        let (host_raw, port) = match hostport.rsplit_once(':') {
            Some((h, p)) if !p.is_empty() => {
                let n: u32 = p.parse().ok()?;
                if n > u32::from(u16::MAX) {
                    return None;
                }
                (h, Some(n as u16))
            }
            Some((h, _)) => (h, None),
            None => (hostport, None),
        };
        if host_raw.is_empty() {
            return None;
        }
        let host = host_raw.to_ascii_lowercase();
        let port = match (scheme.as_str(), port) {
            ("http", Some(80)) | ("https", Some(443)) => None,
            (_, p) => p,
        };
        let path = if path_raw.is_empty() {
            "/".to_string()
        } else {
            remove_dot_segments(path_raw)
        };
        Some(Self {
            scheme,
            userinfo,
            host,
            port,
            path,
            query: query.map(str::to_string),
        })
    }

    fn serialize(&self) -> String {
        let mut out = String::with_capacity(64);
        out.push_str(&self.scheme);
        out.push_str("://");
        if let Some(ui) = &self.userinfo {
            out.push_str(ui);
            out.push('@');
        }
        out.push_str(&self.host);
        if let Some(p) = self.port {
            out.push(':');
            out.push_str(&p.to_string());
        }
        out.push_str(&self.path);
        let query = filter_query(self.query.as_deref().unwrap_or(""));
        if !query.is_empty() {
            out.push('?');
            out.push_str(&query);
        }
        out
    }
}

fn remove_dot_segments(path: &str) -> String {
    if !path.split('/').any(|seg| seg == "." || seg == "..") {
        return path.to_string();
    }
    let mut input = path.to_string();
    let mut out: Vec<String> = Vec::new();
    while !input.is_empty() {
        if let Some(rest) = input.strip_prefix("../") {
            input = rest.to_string();
        } else if let Some(rest) = input.strip_prefix("./") {
            input = rest.to_string();
        } else if let Some(rest) = input.strip_prefix("/./") {
            input = format!("/{rest}");
        } else if input == "/." {
            input = "/".to_string();
        } else if let Some(rest) = input.strip_prefix("/../") {
            input = format!("/{rest}");
            out.pop();
        } else if input == "/.." {
            input = "/".to_string();
            out.pop();
        } else if input == "." || input == ".." {
            input = String::new();
        } else {
            let bytes = input.as_bytes();
            let seg_end = match bytes[1..].iter().position(|&b| b == b'/') {
                Some(i) => i + 1,
                None => bytes.len(),
            };
            out.push(input[..seg_end].to_string());
            input.replace_range(..seg_end, "");
        }
    }
    out.concat()
}

fn filter_query(raw: &str) -> String {
    raw.split('&')
        .filter(|pair| !pair.is_empty())
        .filter_map(|pair| {
            let (raw_name, raw_value) = match pair.split_once('=') {
                Some((n, v)) => (n, v),
                None => (pair, ""),
            };
            let name = form_decode(raw_name);
            if EPHEMERAL_PARAMS.contains(&name.as_str()) {
                None
            } else {
                Some(format!(
                    "{}={}",
                    form_encode(&name),
                    form_encode(&form_decode(raw_value))
                ))
            }
        })
        .collect::<Vec<_>>()
        .join("&")
}

fn query_value(raw_query: Option<&str>, key: &str) -> Option<String> {
    raw_query?
        .split('&')
        .filter_map(|pair| {
            let (name, value) = match pair.split_once('=') {
                Some((n, v)) => (n, v),
                None => (pair, ""),
            };
            if form_decode(name) == key {
                Some(form_decode(value))
            } else {
                None
            }
        })
        .next()
}

fn form_encode(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for &b in s.as_bytes() {
        match b {
            b'a'..=b'z' | b'A'..=b'Z' | b'0'..=b'9' | b'*' | b'-' | b'.' | b'_' => {
                out.push(b as char)
            }
            b' ' => out.push('+'),
            _ => {
                out.push('%');
                out.push_str(&format!("{b:02X}"));
            }
        }
    }
    out
}

fn form_decode(s: &str) -> String {
    let bytes = s.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        match bytes[i] {
            b'+' => {
                out.push(b' ');
                i += 1;
            }
            b'%' if i + 2 < bytes.len()
                && bytes[i + 1].is_ascii_hexdigit()
                && bytes[i + 2].is_ascii_hexdigit() =>
            {
                let hi = (bytes[i + 1] as char).to_digit(16).unwrap() as u8;
                let lo = (bytes[i + 2] as char).to_digit(16).unwrap() as u8;
                out.push(hi * 16 + lo);
                i += 3;
            }
            b => {
                out.push(b);
                i += 1;
            }
        }
    }
    String::from_utf8_lossy(&out).into_owned()
}

fn sha256(data: &[u8]) -> [u8; 32] {
    let mut h: [u32; 8] = [
        0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab,
        0x5be0cd19,
    ];
    let mut message = data.to_vec();
    let bit_len = (data.len() as u64) * 8;
    message.push(0x80);
    while message.len() % 64 != 56 {
        message.push(0);
    }
    message.extend_from_slice(&bit_len.to_be_bytes());

    for chunk in message.chunks_exact(64) {
        let mut w = [0u32; 64];
        for (i, word) in chunk.chunks_exact(4).enumerate() {
            w[i] = u32::from_be_bytes([word[0], word[1], word[2], word[3]]);
        }
        for i in 16..64 {
            let s0 = w[i - 15].rotate_right(7) ^ w[i - 15].rotate_right(18) ^ (w[i - 15] >> 3);
            let s1 = w[i - 2].rotate_right(17) ^ w[i - 2].rotate_right(19) ^ (w[i - 2] >> 10);
            w[i] = w[i - 16]
                .wrapping_add(s0)
                .wrapping_add(w[i - 7])
                .wrapping_add(s1);
        }
        let mut vars = h;
        for i in 0..64 {
            let [a, b, c, d, e, f, g, hh] = vars;
            let s1 = e.rotate_right(6) ^ e.rotate_right(11) ^ e.rotate_right(25);
            let ch = (e & f) ^ (!e & g);
            let t1 = hh
                .wrapping_add(s1)
                .wrapping_add(ch)
                .wrapping_add(SHA256_K[i])
                .wrapping_add(w[i]);
            let s0 = a.rotate_right(2) ^ a.rotate_right(13) ^ a.rotate_right(22);
            let maj = (a & b) ^ (a & c) ^ (b & c);
            let t2 = s0.wrapping_add(maj);
            vars = [t1.wrapping_add(t2), a, b, c, d.wrapping_add(t1), e, f, g];
        }
        for (slot, v) in h.iter_mut().zip(vars) {
            *slot = slot.wrapping_add(v);
        }
    }

    let mut digest = [0u8; 32];
    for (i, word) in h.iter().enumerate() {
        digest[i * 4..i * 4 + 4].copy_from_slice(&word.to_be_bytes());
    }
    digest
}

fn base36(mut n: u128) -> String {
    if n == 0 {
        return "0".to_string();
    }
    let mut digits = Vec::new();
    while n > 0 {
        digits.push(BASE36[(n % 36) as usize]);
        n /= 36;
    }
    digits.reverse();
    String::from_utf8(digits).unwrap_or_default()
}

fn random_bytes(n: usize) -> Vec<u8> {
    if let Ok(mut file) = File::open("/dev/urandom") {
        let mut buf = vec![0u8; n];
        if file.read_exact(&mut buf).is_ok() {
            return buf;
        }
    }
    let mut seed = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos().to_be_bytes().to_vec())
        .unwrap_or_default();
    let mut out = Vec::with_capacity(n);
    let mut counter = 0u64;
    while out.len() < n {
        seed.extend_from_slice(&counter.to_be_bytes());
        out.extend_from_slice(&sha256(&seed));
        counter = counter.wrapping_add(1);
    }
    out.truncate(n);
    out
}

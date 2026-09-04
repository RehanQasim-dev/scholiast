//! Embedded HTTP loopback server for YouTube player embedding.
//!
//! When running inside Tauri on desktop (Linux WebKitGTK, macOS WKWebView, Windows WebView2)
//! or Android WebView, the main application origin is typically a custom scheme (e.g.
//! `tauri://localhost`). Because browsers do not send an HTTP `Referer` header when
//! fetching HTTPS resources from custom schemes, YouTube's embed server returns:
//! "Error 153: Video player configuration error — missing referrer".
//!
//! This module runs a tiny, fast, zero-dependency Tokio loopback HTTP server on
//! `127.0.0.1:<ephemeral-port>`. By loading the YouTube player inside an iframe hosted
//! at `http://127.0.0.1:<port>/player`, the browser automatically transmits:
//! `Referer: http://127.0.0.1:<port>/`
//!
//! This satisfies YouTube's strict embedder verification across all platforms.
//! Bi-directional communication between the parent app and player iframe occurs over
//! standard `window.postMessage`.

use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tokio::task::JoinHandle;

const PLAYER_HTML: &str = r#"<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, user-scalable=no">
  <meta name="referrer" content="strict-origin-when-cross-origin">
  <title>Scholiast Player Bridge</title>
  <style>
    * { box-sizing: border-box; }
    html, body {
      margin: 0;
      padding: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #000000;
    }
    #player {
      position: absolute;
      inset: 0;
      width: 100% !important;
      height: 100% !important;
      border: 0;
    }
  </style>
</head>
<body>
  <div id="player"></div>
  <script>
    (function() {
      const params = new URLSearchParams(window.location.search);
      let initialVideoId = params.get('v') || params.get('videoId') || '';
      let player = null;
      let isReady = false;

      function post(type, payload) {
        try {
          if (window.parent && window.parent !== window) {
            window.parent.postMessage(Object.assign({ source: 'scholiast-player', type: type }, payload || {}), '*');
          }
        } catch (e) {
          console.error('[ScholiastPlayer] post error', e);
        }
      }

      function notifyMetadata() {
        if (!player) return;
        try {
          const data = player.getVideoData();
          if (data && data.title) {
            post('onTitle', { title: data.title });
          }
        } catch (_) {}
        try {
          const d = player.getDuration();
          if (d > 0) {
            post('onDuration', { duration: d });
          }
        } catch (_) {}
        try {
          const tracks = player.getOption('captions', 'tracklist');
          post('onCaptionsAvailable', { available: Array.isArray(tracks) && tracks.length > 0 });
        } catch (_) {}
      }

      window.onYouTubeIframeAPIReady = function() {
        try {
          player = new YT.Player('player', {
            width: '100%',
            height: '100%',
            videoId: initialVideoId || undefined,
            playerVars: {
              origin: window.location.origin,
              widget_referrer: window.location.origin,
              rel: 0,
              playsinline: 1,
              controls: 0,
              fs: 0,
              modestbranding: 1,
              iv_load_policy: 3,
              disablekb: 1,
              enablejsapi: 1,
              autoplay: 0
            },
            events: {
              onReady: function() {
                isReady = true;
                post('onPlayerReady');
                notifyMetadata();
              },
              onStateChange: function(e) {
                post('onStateChange', { data: e.data });
                notifyMetadata();
              },
              onError: function(e) {
                post('onError', { data: e.data });
              }
            }
          });
        } catch (err) {
          console.error('[ScholiastPlayer] init error', err);
          post('onError', { data: 5 });
        }
      };

      // Periodic time & duration sync
      setInterval(function() {
        if (!player || !isReady) return;
        try {
          const time = player.getCurrentTime() || 0;
          const duration = player.getDuration() || 0;
          post('onTimeUpdate', { time: time, duration: duration });
        } catch (_) {}
      }, 250);

      // Handle inbound commands from parent application
      window.addEventListener('message', function(e) {
        const msg = e.data;
        if (!msg || typeof msg !== 'object') return;
        if (msg.target !== 'scholiast-player' && !msg.command) return;

        if (!player) return;

        try {
          switch (msg.command) {
            case 'play':
              if (player.playVideo) player.playVideo();
              break;
            case 'pause':
              if (player.pauseVideo) player.pauseVideo();
              break;
            case 'seekTo':
              if (player.seekTo) player.seekTo(msg.seconds || 0, true);
              break;
            case 'loadVideo':
              if (player.loadVideoById && msg.videoId) {
                initialVideoId = msg.videoId;
                player.loadVideoById(msg.videoId);
              }
              break;
            case 'setRate':
              if (player.setPlaybackRate) player.setPlaybackRate(msg.rate || 1);
              break;
            case 'setVolume':
              if (player.setVolume) player.setVolume(msg.volume != null ? msg.volume : 100);
              break;
            case 'setCaptions':
              if (msg.enabled) {
                if (player.loadModule) player.loadModule('captions');
                const tracks = player.getOption ? player.getOption('captions', 'tracklist') : null;
                if (player.setOption) {
                  if (Array.isArray(tracks) && tracks.length > 0) {
                    player.setOption('captions', 'track', tracks[0]);
                  } else {
                    player.setOption('captions', 'track', { languageCode: 'en' });
                  }
                }
              } else {
                if (player.unloadModule) player.unloadModule('captions');
                if (player.setOption) player.setOption('captions', 'track', {});
              }
              break;
            case 'requestState':
              notifyMetadata();
              break;
          }
        } catch (err) {
          console.error('[ScholiastPlayer] command failed:', msg.command, err);
        }
      });

      // Load YouTube IFrame API script with strict referrer policy
      const script = document.createElement('script');
      script.src = 'https://www.youtube.com/iframe_api';
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.setAttribute('referrerpolicy', 'strict-origin-when-cross-origin');
      document.head.appendChild(script);
    })();
  </script>
</body>
</html>"#;

async fn handle_connection(mut stream: TcpStream) {
    let mut buf = [0u8; 2048];
    let n = match stream.read(&mut buf).await {
        Ok(n) if n > 0 => n,
        _ => return,
    };

    let req_str = String::from_utf8_lossy(&buf[..n]);
    if req_str.starts_with("OPTIONS") {
        let resp = "HTTP/1.1 204 No Content\r\n\
                    Access-Control-Allow-Origin: *\r\n\
                    Access-Control-Allow-Methods: GET, OPTIONS\r\n\
                    Access-Control-Allow-Headers: *\r\n\
                    Connection: close\r\n\r\n";
        let _ = stream.write_all(resp.as_bytes()).await;
        return;
    }

    if req_str.starts_with("GET /health") {
        let body = r#"{"status":"ok"}"#;
        let resp = format!(
            "HTTP/1.1 200 OK\r\n\
            Content-Type: application/json; charset=utf-8\r\n\
            Access-Control-Allow-Origin: *\r\n\
            Content-Length: {}\r\n\
            Connection: close\r\n\r\n{}",
            body.len(),
            body
        );
        let _ = stream.write_all(resp.as_bytes()).await;
        return;
    }

    let body = PLAYER_HTML;
    let resp = format!(
        "HTTP/1.1 200 OK\r\n\
        Content-Type: text/html; charset=utf-8\r\n\
        Access-Control-Allow-Origin: *\r\n\
        Referrer-Policy: strict-origin-when-cross-origin\r\n\
        Cache-Control: no-cache, no-store, must-revalidate\r\n\
        Content-Length: {}\r\n\
        Connection: close\r\n\r\n{}",
        body.len(),
        body
    );

    let _ = stream.write_all(resp.as_bytes()).await;
    let _ = stream.flush().await;
}

pub struct PlayerServerHandle {
    pub url: String,
    pub addr: SocketAddr,
    pub task: JoinHandle<()>,
}

/// Start the loopback player server on 127.0.0.1 with an OS-assigned ephemeral port.
pub async fn start_player_server() -> Result<PlayerServerHandle, std::io::Error> {
    let listener = TcpListener::bind("127.0.0.1:0").await?;
    let addr = listener.local_addr()?;
    let url = format!("http://127.0.0.1:{}/player", addr.port());

    let task = tokio::spawn(async move {
        loop {
            match listener.accept().await {
                Ok((stream, _)) => {
                    tokio::spawn(handle_connection(stream));
                }
                Err(_) => break,
            }
        }
    });

    Ok(PlayerServerHandle { url, addr, task })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_player_server_serves_html() {
        let server = start_player_server().await.expect("failed to start server");
        assert!(server.url.starts_with("http://127.0.0.1:"));
        assert!(server.url.ends_with("/player"));

        let client = reqwest::Client::new();
        let resp = client
            .get(&server.url)
            .send()
            .await
            .expect("request failed");

        assert_eq!(resp.status(), 200);
        let ctype = resp
            .headers()
            .get("content-type")
            .expect("content-type missing")
            .to_str()
            .unwrap();
        assert!(ctype.contains("text/html"));

        let ref_policy = resp
            .headers()
            .get("referrer-policy")
            .expect("referrer-policy missing")
            .to_str()
            .unwrap();
        assert_eq!(ref_policy, "strict-origin-when-cross-origin");

        let body = resp.text().await.expect("reading body failed");
        assert!(body.contains("scholiast-player"));
        assert!(body.contains("https://www.youtube.com/iframe_api"));
        assert!(body.contains("widget_referrer: window.location.origin"));

        server.task.abort();
    }
}

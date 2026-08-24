use axum::routing::get;

pub fn router() -> axum::Router {
    axum::Router::new().route("/health", get(health))
}

#[allow(clippy::unused_async)]
async fn health() -> &'static str {
    "ok"
}

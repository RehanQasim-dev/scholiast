use scholiast_server::router;

#[tokio::main]
async fn main() {
    let listener = tokio::net::TcpListener::bind("127.0.0.1:8787")
        .await
        .expect("failed to bind 127.0.0.1:8787");
    axum::serve(listener, router()).await.expect("server error");
}

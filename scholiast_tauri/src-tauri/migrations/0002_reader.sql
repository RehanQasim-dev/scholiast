-- Reader wave (task 23): query support over the 0001 annotation tables.
-- highlights(url_hash) / comments(highlight_id) already exist from 0001;
-- IF NOT EXISTS keeps this idempotent for databases created before the split.

CREATE INDEX IF NOT EXISTS idx_highlights_url ON highlights(url_hash);
CREATE INDEX IF NOT EXISTS idx_comments_highlight ON comments(highlight_id);
CREATE INDEX IF NOT EXISTS idx_pages_updated ON pages(updated_at);

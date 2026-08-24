-- Scholiast DB schema (plan §5.2, verbatim). SQLite, WAL.

-- Videos & their items (mirror of Room video_pages, expanded for querying)
CREATE TABLE videos (
  url_hash TEXT PRIMARY KEY,          -- sha256-prefix, same scheme as repo
  url TEXT NOT NULL, video_id TEXT, title TEXT,
  resume_at REAL NOT NULL DEFAULT 0,  -- seconds
  updated_at INTEGER NOT NULL
);
CREATE TABLE video_items (
  id TEXT PRIMARY KEY,                -- genVideoId (base36 ts + rand), same generator
  url_hash TEXT NOT NULL REFERENCES videos(url_hash) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('frame','note','transcript')),
  video_time REAL NOT NULL, time_end REAL,
  frame_w INTEGER, frame_h INTEGER, frame_drive_id TEXT,  -- bytes live on disk
  markup_json TEXT,                   -- VideoMarkup | null (normalized 0..1 coords)
  anchor_json TEXT,                   -- TranscriptAnchor for transcript kind
  quote TEXT, color TEXT,             -- yellow|red|green|black
  ocr_text TEXT,
  notes_json TEXT NOT NULL DEFAULT '[]',
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);

-- Reader pages & annotations (new; mirrors extension sharded stores)
CREATE TABLE pages (
  url_hash TEXT PRIMARY KEY, url TEXT NOT NULL, title TEXT,
  source_markdown TEXT,               -- captured readable body (immutable once synced)
  captured_at INTEGER, updated_at INTEGER NOT NULL
);
CREATE TABLE highlights (
  id TEXT PRIMARY KEY, url_hash TEXT NOT NULL REFERENCES pages(url_hash) ON DELETE CASCADE,
  type TEXT NOT NULL CHECK(type IN ('text','element')),
  xpath TEXT, start_offset INTEGER, end_offset INTEGER,
  content TEXT NOT NULL, color TEXT NOT NULL,
  group_id TEXT, anchor_json TEXT,    -- portable text-quote anchor (shared/anchor.ts schema)
  created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
);
CREATE TABLE comments (
  id TEXT PRIMARY KEY,                -- inline timestamp-comment id (preserve!)
  highlight_id TEXT NOT NULL REFERENCES highlights(id) ON DELETE CASCADE,
  body TEXT NOT NULL, created_at INTEGER NOT NULL, edited_at INTEGER
);
CREATE TABLE drawings (
  stroke_id TEXT PRIMARY KEY, url_hash TEXT NOT NULL,
  color TEXT NOT NULL, width REAL NOT NULL, points_json TEXT NOT NULL,
  updated_at INTEGER
);
CREATE TABLE diagrams (
  id TEXT PRIMARY KEY,                -- diagram uuid (extension-compatible)
  page_url_hash TEXT, image_for_highlight TEXT, pasted INTEGER DEFAULT 0,
  scene_json TEXT, png_path TEXT, png_drive_id TEXT, scene_drive_id TEXT,
  updated_at INTEGER NOT NULL
);
CREATE TABLE tags ( tag TEXT PRIMARY KEY );   -- tag index (#autocomplete)

CREATE TABLE sync_meta (             -- pagemeta:<url>
  url_hash TEXT PRIMARY KEY, file_id TEXT, head_revision_id TEXT, last_synced INTEGER
);
CREATE TABLE sync_snapshots (        -- snap:<url>: last reconciled PageRecord JSON
  url_hash TEXT PRIMARY KEY, record_json TEXT NOT NULL
);
CREATE TABLE sync_queue ( url_hash TEXT PRIMARY KEY, enqueued_at INTEGER );
CREATE TABLE ocr_texts ( item_id TEXT PRIMARY KEY, text TEXT, created_at INTEGER );

CREATE INDEX idx_video_items_url ON video_items(url_hash, video_time);
CREATE INDEX idx_highlights_url ON highlights(url_hash);
CREATE INDEX idx_comments_highlight ON comments(highlight_id);
CREATE INDEX idx_drawings_url ON drawings(url_hash);

CREATE TABLE IF NOT EXISTS documents (
  id TEXT PRIMARY KEY,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  note_id TEXT NOT NULL,
  file_name TEXT NOT NULL CHECK(length(file_name) BETWEEN 1 AND 255),
  kind TEXT NOT NULL CHECK(kind IN ('pdf','docx','txt','md','csv','json')),
  mime_type TEXT NOT NULL,
  sha256 TEXT NOT NULL CHECK(length(sha256) = 64),
  page_count INTEGER NOT NULL CHECK(page_count BETWEEN 0 AND 10000),
  pages_json TEXT NOT NULL CHECK(json_valid(pages_json)),
  file_bytes BLOB NOT NULL CHECK(length(file_bytes) BETWEEN 1 AND 33554432),
  created_at TEXT NOT NULL,
  FOREIGN KEY(note_id, subject_id) REFERENCES notes(id, subject_id),
  UNIQUE(subject_id, sha256)
);
CREATE TABLE IF NOT EXISTS material_assets (
  sha256 TEXT PRIMARY KEY CHECK(length(sha256) = 64),
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL CHECK(mime_type IN ('image/png','image/jpeg','image/webp','image/gif','image/bmp')),
  file_bytes BLOB NOT NULL CHECK(length(file_bytes) BETWEEN 1 AND 8388608)
);
CREATE TABLE IF NOT EXISTS card_metadata (
  flashcard_id TEXT PRIMARY KEY REFERENCES flashcards(id),
  tags_json TEXT NOT NULL CHECK(json_valid(tags_json)),
  images_json TEXT NOT NULL CHECK(json_valid(images_json))
);
PRAGMA user_version = 2;

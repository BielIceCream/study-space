-- StudySpace v1: storage shared by native SQLite and the browser SQLite engine.
-- The caller opens a transaction and enables PRAGMA foreign_keys before running this file.
CREATE TABLE IF NOT EXISTS subjects (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 160),
    name TEXT NOT NULL CHECK (length(trim(name)) BETWEEN 1 AND 120),
    accent TEXT NOT NULL CHECK (accent IN ('lavender', 'blue', 'green', 'peach', 'rose')),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') = created_at, 0)),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') = updated_at, 0)),
    CHECK (created_at <= updated_at)
);

CREATE TABLE IF NOT EXISTS notes (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 160),
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    title TEXT NOT NULL CHECK (length(trim(title)) BETWEEN 1 AND 180),
    body_json TEXT NOT NULL CHECK (
        length(CAST(body_json AS BLOB)) <= 2097152
        AND json_valid(body_json)
        AND json_type(body_json) = 'object'
        AND coalesce(json_extract(body_json, '$.type') = 'doc', 0)
    ),
    plain_text TEXT NOT NULL CHECK (length(plain_text) <= 2000000),
    revision INTEGER NOT NULL CHECK (typeof(revision) = 'integer' AND revision BETWEEN 1 AND 9007199254740991),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') = created_at, 0)),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') = updated_at, 0)),
    UNIQUE (id, subject_id),
    CHECK (created_at <= updated_at)
);

CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 160),
    subject_id TEXT NOT NULL REFERENCES subjects(id) ON DELETE CASCADE,
    note_id TEXT,
    front TEXT NOT NULL CHECK (length(trim(front)) BETWEEN 1 AND 20000),
    back TEXT NOT NULL CHECK (length(trim(back)) BETWEEN 1 AND 20000),
    created_at TEXT NOT NULL CHECK (length(created_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', created_at, '+0 seconds') = created_at, 0)),
    updated_at TEXT NOT NULL CHECK (length(updated_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', updated_at, '+0 seconds') = updated_at, 0)),
    FOREIGN KEY (note_id, subject_id) REFERENCES notes(id, subject_id) ON DELETE CASCADE,
    CHECK (created_at <= updated_at)
);

CREATE TABLE IF NOT EXISTS review_logs (
    id TEXT PRIMARY KEY NOT NULL CHECK (length(trim(id)) BETWEEN 1 AND 160),
    flashcard_id TEXT NOT NULL REFERENCES flashcards(id) ON DELETE CASCADE,
    session_id TEXT NOT NULL CHECK (length(trim(session_id)) BETWEEN 1 AND 160),
    rating INTEGER NOT NULL CHECK (typeof(rating) = 'integer' AND rating BETWEEN 1 AND 4),
    reviewed_at TEXT NOT NULL CHECK (length(reviewed_at) = 24 AND coalesce(strftime('%Y-%m-%dT%H:%M:%fZ', reviewed_at, '+0 seconds') = reviewed_at, 0)),
    UNIQUE (session_id, flashcard_id)
);

CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY NOT NULL CHECK (key = 'theme'),
    value TEXT NOT NULL CHECK (value IN ('light', 'dark'))
);

CREATE INDEX IF NOT EXISTS notes_subject ON notes(subject_id, updated_at);
CREATE INDEX IF NOT EXISTS flashcards_subject ON flashcards(subject_id);
CREATE INDEX IF NOT EXISTS flashcards_note ON flashcards(note_id, subject_id);
CREATE INDEX IF NOT EXISTS reviews_card_date ON review_logs(flashcard_id, reviewed_at);

INSERT INTO settings(key, value) VALUES ('theme', 'light') ON CONFLICT(key) DO NOTHING;
PRAGMA user_version = 1;

CREATE TABLE IF NOT EXISTS error_entries (
  id TEXT PRIMARY KEY NOT NULL,
  subject_id TEXT NOT NULL REFERENCES subjects(id),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);

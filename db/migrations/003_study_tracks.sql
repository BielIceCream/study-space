-- Personal aggregate: immutable catalog + configuration + diagnostic evidence.
-- Validated by both adapters; one revision protects edits across tabs/windows.
CREATE TABLE IF NOT EXISTS study_tracks (
  id TEXT PRIMARY KEY NOT NULL,
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);

CREATE TABLE IF NOT EXISTS study_planners (
  track_id TEXT PRIMARY KEY NOT NULL REFERENCES study_tracks(id),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);

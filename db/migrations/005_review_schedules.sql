CREATE TABLE IF NOT EXISTS review_schedules (
  flashcard_id TEXT PRIMARY KEY NOT NULL REFERENCES flashcards(id),
  last_review_id TEXT NOT NULL UNIQUE REFERENCES review_logs(id),
  data_json TEXT NOT NULL CHECK(json_valid(data_json))
);

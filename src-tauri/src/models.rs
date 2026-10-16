use serde::{Deserialize, Deserializer, Serialize};
use serde_json::Value;

fn required_nullable<'de, D>(deserializer: D) -> Result<Option<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Option::<String>::deserialize(deserializer)
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Accent {
    Lavender,
    Blue,
    Green,
    Peach,
    Rose,
}

impl Accent {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Lavender => "lavender",
            Self::Blue => "blue",
            Self::Green => "green",
            Self::Peach => "peach",
            Self::Rose => "rose",
        }
    }
}

#[derive(Clone, Copy, Debug, Deserialize, Serialize, PartialEq, Eq)]
#[serde(rename_all = "lowercase")]
pub enum Theme {
    Light,
    Dark,
}

impl Theme {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Light => "light",
            Self::Dark => "dark",
        }
    }
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Subject {
    pub id: String,
    pub name: String,
    pub accent: Accent,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Note {
    pub id: String,
    pub subject_id: String,
    pub title: String,
    pub body_json: Value,
    pub plain_text: String,
    pub revision: i64,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Flashcard {
    pub id: String,
    pub subject_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub note_id: Option<String>,
    pub front: String,
    pub back: String,
    pub created_at: String,
    pub updated_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewLog {
    pub id: String,
    pub flashcard_id: String,
    pub session_id: String,
    pub rating: u8,
    pub reviewed_at: String,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(deny_unknown_fields)]
pub struct Settings {
    pub theme: Theme,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Snapshot {
    pub subjects: Vec<Subject>,
    pub notes: Vec<Note>,
    pub flashcards: Vec<Flashcard>,
    pub review_logs: Vec<ReviewLog>,
    pub settings: Settings,
    #[serde(default)]
    pub documents: Vec<crate::materials::DocumentMetadata>,
    #[serde(default)]
    pub card_metadata: Vec<crate::materials::CardMetadata>,
}

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct BackupDocument {
    pub format: String,
    pub version: u32,
    pub exported_at: String,
    pub data: Snapshot,
    #[serde(default, skip_serializing_if="Option::is_none")]
    pub materials: Option<crate::materials::BackupMaterials>,
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct SubjectInput {
    pub name: String,
    pub accent: Accent,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct NoteInput {
    pub subject_id: String,
    pub title: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveNoteInput {
    pub id: String,
    pub title: String,
    pub body_json: Value,
    pub plain_text: String,
    pub expected_revision: i64,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct FlashcardInput {
    pub subject_id: String,
    #[serde(deserialize_with = "required_nullable")]
    pub note_id: Option<String>,
    pub front: String,
    pub back: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UpdateFlashcardInput {
    pub id: String,
    pub front: String,
    pub back: String,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewInput {
    pub flashcard_id: String,
    pub session_id: String,
    pub rating: u8,
}

//! Local error notebook: explicit student records and immutable source evidence.
use crate::{error::{StoreError, StoreResult}, models::Snapshot, validation};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

fn nullable<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(tag = "kind", rename_all = "lowercase", deny_unknown_fields)]
pub enum ErrorSource {
    Manual {},
    #[serde(rename_all = "camelCase")]
    Flashcard { flashcard_id: String, #[serde(deserialize_with = "nullable")] review_log_id: Option<String> },
    #[serde(rename_all = "camelCase")]
    Note { note_id: String },
    #[serde(rename_all = "camelCase")]
    Diagnostic { track_id: String, attempt_id: String, question_id: String },
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorPractice { pub id: String, pub description: String, pub created_at: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SourceSnapshot { pub title: String, pub prompt: String, pub answer: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ErrorEntry {
    pub id: String, pub revision: i64, pub subject_id: String, pub origin_label: String, pub question: String,
    pub correction: String, pub next_action: String, pub status: String, pub source: ErrorSource,
    pub source_snapshot: SourceSnapshot, pub practices: Vec<ErrorPractice>,
    pub created_at: String, pub updated_at: String,
    #[serde(deserialize_with = "nullable")]
    pub resolved_at: Option<String>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PracticeInput { pub id: String, pub description: String }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveErrorEntryInput {
    #[serde(default, deserialize_with = "optional_nonnull")]
    pub id: Option<String>,
    #[serde(default, deserialize_with = "optional_nonnull")]
    pub expected_revision: Option<i64>, pub subject_id: String,
    pub origin_label: String, pub question: String, pub correction: String, pub next_action: String,
    pub status: String, pub source: ErrorSource,
    #[serde(default, deserialize_with = "optional_nonnull")]
    pub practice: Option<PracticeInput>,
}
fn optional_nonnull<'de, D: serde::Deserializer<'de>, T: Deserialize<'de>>(deserializer: D) -> Result<Option<T>, D::Error> {
    T::deserialize(deserializer).map(Some)
}
fn ensure(condition: bool, message: &str) -> StoreResult<()> {
    if condition { Ok(()) } else { Err(StoreError::Invalid(message.into())) }
}
fn validate_source(source: &ErrorSource) -> StoreResult<()> {
    match source {
        ErrorSource::Manual {} => Ok(()),
        ErrorSource::Flashcard { flashcard_id, review_log_id } => {
            validation::id(flashcard_id)?;
            if let Some(id) = review_log_id { validation::id(id)?; }
            Ok(())
        },
        ErrorSource::Note { note_id } => validation::id(note_id),
        ErrorSource::Diagnostic { track_id, attempt_id, question_id } => {
            validation::id(track_id)?; validation::id(attempt_id)?; validation::id(question_id)
        },
    }
}
pub(crate) fn validate_input(input: &SaveErrorEntryInput) -> StoreResult<()> {
    ensure(input.id.is_some() == input.expected_revision.is_some(), "Informe o identificador e a revisão do registro juntos.")?;
    if let Some(id) = &input.id { validation::id(id)?; }
    if let Some(revision) = input.expected_revision { validation::revision(revision)?; ensure(revision < validation::MAX_SAFE_INTEGER, "O registro atingiu o limite de revisões.")?; }
    validation::id(&input.subject_id)?;
    validation::text(&input.origin_label, 180, "A origem", false)?;
    validation::text(&input.question, 2000, "A questão", false)?;
    validation::text(&input.correction, 5000, "A correção", true)?;
    validation::text(&input.next_action, 2000, "A próxima ação", true)?;
    ensure(matches!(input.status.as_str(), "open" | "resolved"), "O estado do registro é inválido.")?;
    if input.status == "resolved" { ensure(!input.correction.trim().is_empty() && !input.next_action.trim().is_empty(), "Preencha a correção e a próxima ação para resolver o registro.")?; }
    validate_source(&input.source)?;
    if let Some(practice) = &input.practice {
        validation::id(&practice.id)?;
        validation::text(&practice.description, 1000, "A prática", false)?;
        ensure(input.id.is_some(), "Salve o registro antes de adicionar uma prática.")?;
    }
    Ok(())
}
pub(crate) fn validate_entry(entry: &ErrorEntry) -> StoreResult<()> {
    validation::id(&entry.id)?; validation::revision(entry.revision)?;
    let input = SaveErrorEntryInput { id: Some(entry.id.clone()), expected_revision: Some(1),
        subject_id: entry.subject_id.clone(), origin_label: entry.origin_label.clone(), question: entry.question.clone(),
        correction: entry.correction.clone(), next_action: entry.next_action.clone(), status: entry.status.clone(),
        source: entry.source.clone(), practice: None };
    validate_input(&input)?;
    validation::text(&entry.source_snapshot.title, 300, "O título da origem", false)?;
    validation::text(&entry.source_snapshot.prompt, 20_000, "A pergunta da origem", true)?;
    validation::text(&entry.source_snapshot.answer, 20_000, "A resposta da origem", true)?;
    validation::date(&entry.created_at)?; validation::date(&entry.updated_at)?;
    ensure(entry.created_at <= entry.updated_at, "O registro contém datas fora de ordem.")?;
    match (&entry.status[..], &entry.resolved_at) {
        ("open", None) => (),
        ("resolved", Some(date)) => {
            validation::date(date)?;
            ensure(date >= &entry.created_at && date <= &entry.updated_at, "A data de resolução é inválida.")?;
            ensure(!entry.correction.trim().is_empty() && !entry.next_action.trim().is_empty(), "Preencha a correção e a próxima ação para resolver o registro.")?;
        },
        _ => return Err(StoreError::Invalid("O estado e a data de resolução são inconsistentes.".into())),
    }
    ensure(entry.practices.len() <= 200, "O registro atingiu o limite de práticas.")?;
    let mut ids = HashSet::new();
    let mut previous_date = entry.created_at.as_str();
    for practice in &entry.practices {
        validation::id(&practice.id)?; validation::text(&practice.description, 1000, "A prática", false)?;
        validation::date(&practice.created_at)?;
        ensure(ids.insert(practice.id.as_str()), "O registro contém práticas duplicadas.")?;
        ensure(practice.created_at.as_str() >= previous_date && practice.created_at <= entry.updated_at, "O registro contém práticas fora de ordem.")?;
        previous_date = &practice.created_at;
    }
    Ok(())
}
struct SourceContext<'a> {
    subjects: HashMap<&'a str, &'a crate::models::Subject>,
    cards: HashMap<&'a str, &'a crate::models::Flashcard>,
    notes: HashMap<&'a str, &'a crate::models::Note>,
    reviews: HashMap<&'a str, &'a crate::models::ReviewLog>,
    tracks: HashMap<&'a str, &'a crate::study::StudyTrack>,
}
impl<'a> SourceContext<'a> {
    fn new(data: &'a Snapshot) -> Self {
        Self { subjects:data.subjects.iter().map(|v|(v.id.as_str(),v)).collect(),
            cards:data.flashcards.iter().map(|v|(v.id.as_str(),v)).collect(),
            notes:data.notes.iter().map(|v|(v.id.as_str(),v)).collect(),
            reviews:data.review_logs.iter().map(|v|(v.id.as_str(),v)).collect(),
            tracks:data.study_tracks.iter().map(|v|(v.id.as_str(),v)).collect() }
    }
}
fn validate_links(subject_id: &str, source: &ErrorSource, index: &SourceContext<'_>) -> StoreResult<()> {
    ensure(index.subjects.contains_key(subject_id), "A matéria do registro não existe.")?;
    match source {
        ErrorSource::Manual {} => Ok(()),
        ErrorSource::Flashcard { flashcard_id, review_log_id } => {
            ensure(index.cards.get(flashcard_id.as_str()).is_some_and(|v| v.subject_id == subject_id), "O cartão da origem não existe ou pertence a outra matéria.")?;
            if let Some(id) = review_log_id {
                ensure(index.reviews.get(id.as_str()).is_some_and(|v| &v.flashcard_id == flashcard_id), "A revisão da origem não corresponde ao cartão.")?;
            }
            Ok(())
        },
        ErrorSource::Note { note_id } => ensure(index.notes.get(note_id.as_str()).is_some_and(|v| v.subject_id == subject_id), "A nota da origem não existe ou pertence a outra matéria."),
        ErrorSource::Diagnostic { track_id, attempt_id, question_id } => {
            let track = index.tracks.get(track_id.as_str()).ok_or_else(|| StoreError::Invalid("A trilha da origem não existe.".into()))?;
            ensure(track.catalog.questions.iter().any(|v| &v.id == question_id), "A questão da origem não existe.")?;
            ensure(track.diagnostics.iter().any(|v| &v.id == attempt_id && v.question_ids.contains(question_id) && v.answers.iter().any(|a| &a.question_id == question_id)), "A resposta do diagnóstico não existe.")
        },
    }
}
pub(crate) fn validate_entries(data: &Snapshot) -> StoreResult<()> {
    ensure(data.error_entries.len() <= 5000, "O caderno atingiu o limite de 5000 registros.")?;
    let mut ids = HashSet::new();
    if data.error_entries.is_empty() { return Ok(()); }
    let index = SourceContext::new(data);
    for entry in &data.error_entries {
        validate_entry(entry)?;
        ensure(ids.insert(entry.id.as_str()), "O caderno contém identificadores duplicados.")?;
        validate_links(&entry.subject_id, &entry.source, &index)?;
    }
    Ok(())
}
// Avoid cutting a non-BMP character in half when limiting a note excerpt.
fn excerpt(value: &str) -> String {
    let mut units = 0;
    value.chars().take_while(|c| { units += c.len_utf16(); units <= 1000 }).collect()
}
fn capture(input: &SaveErrorEntryInput, index: &SourceContext<'_>) -> SourceSnapshot {
    match &input.source {
        ErrorSource::Manual {} => SourceSnapshot { title: input.origin_label.clone(), prompt: input.question.clone(), answer: String::new() },
        ErrorSource::Flashcard { flashcard_id, .. } => {
            let card = index.cards.get(flashcard_id.as_str()).unwrap();
            let subject = index.subjects.get(input.subject_id.as_str()).unwrap();
            SourceSnapshot { title: format!("Flashcard · {}", subject.name), prompt: card.front.clone(), answer: card.back.clone() }
        },
        ErrorSource::Note { note_id } => {
            let note = index.notes.get(note_id.as_str()).unwrap();
            SourceSnapshot { title: note.title.clone(), prompt: excerpt(&note.plain_text), answer: String::new() }
        },
        ErrorSource::Diagnostic { track_id, attempt_id, question_id } => {
            let track = index.tracks.get(track_id.as_str()).unwrap();
            let question = track.catalog.questions.iter().find(|v| &v.id == question_id).unwrap();
            let attempt = track.diagnostics.iter().find(|v| &v.id == attempt_id).unwrap();
            let answer = attempt.answers.iter().find(|v| &v.question_id == question_id).unwrap();
            let selected = answer.choice_index.map_or("Não sei ainda", |i| question.choices[i as usize].as_str());
            SourceSnapshot { title: track.config.name.clone(),
                prompt: format!("{}\n{}", question.prompt, question.choices.iter().enumerate().map(|(i, v)| format!("{}. {}", i + 1, v)).collect::<Vec<_>>().join("\n")),
                answer: format!("Sua resposta: {}\nCorreção: {}\n{}", selected, question.choices[question.correct_index as usize], question.explanation) }
        },
    }
}
/// Source evidence and practice history are owned by the storage service.
/// Retrying an existing practice id returns its original complete entry before
/// checking a stale revision; additional draft edits in such a retry are ignored.
pub(crate) fn build(input: SaveErrorEntryInput, previous: Option<&ErrorEntry>, data: &Snapshot, id: String, now: String) -> StoreResult<ErrorEntry> {
    validate_input(&input)?;
    validation::date(&now)?;
    if let Some(previous) = previous {
        validate_entry(previous)?;
        if let Some(practice) = &input.practice {
            if let Some(saved) = previous.practices.iter().find(|v| v.id == practice.id) {
                ensure(saved.description == practice.description, "Este identificador de prática já possui outra descrição.")?;
                return Ok(previous.clone());
            }
        }
        ensure(input.id.as_ref() == Some(&previous.id) && input.expected_revision == Some(previous.revision), "Este registro foi modificado em outra janela. Recarregue o caderno antes de salvar novamente.")?;
        ensure(previous.revision < validation::MAX_SAFE_INTEGER, "O registro atingiu o limite de revisões.")?;
        ensure(input.subject_id == previous.subject_id && input.source == previous.source, "A matéria e a origem do registro são imutáveis.")?;
    } else {
        ensure(input.id.is_none(), "O registro não existe.")?;
        ensure(data.error_entries.len() < 5000, "O caderno atingiu o limite de 5000 registros.")?;
    }
    let index = SourceContext::new(data);
    validate_links(&input.subject_id, &input.source, &index)?;
    let timestamp = previous.map_or(now.clone(), |v| if v.updated_at > now { v.updated_at.clone() } else { now.clone() });
    let source_snapshot = previous.map_or_else(|| capture(&input, &index), |v| v.source_snapshot.clone());
    let mut practices = previous.map_or_else(Vec::new, |v| v.practices.clone());
    if let Some(practice) = input.practice {
        ensure(practices.len() < 200, "O registro atingiu o limite de práticas.")?;
        practices.push(ErrorPractice { id: practice.id, description: practice.description, created_at: timestamp.clone() });
    }
    let resolved_at = if input.status == "resolved" { Some(previous.and_then(|v| v.resolved_at.clone()).unwrap_or_else(|| timestamp.clone())) } else { None };
    let entry = ErrorEntry { id: previous.map_or(id, |v| v.id.clone()), revision: previous.map_or(1, |v| v.revision + 1),
        subject_id: input.subject_id, origin_label: input.origin_label, question: input.question, correction: input.correction,
        next_action: input.next_action, status: input.status, source: input.source, source_snapshot, practices,
        created_at: previous.map_or(timestamp.clone(), |v| v.created_at.clone()), updated_at: timestamp, resolved_at };
    validate_entry(&entry)?;
    Ok(entry)
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use serde_json::json;
    pub(crate) fn input(subject_id: &str) -> SaveErrorEntryInput {
        serde_json::from_value(json!({ "subjectId":subject_id, "originLabel":"Exercício", "question":"Onde errei?", "correction":"", "nextAction":"", "status":"open", "source":{"kind":"manual"} })).unwrap()
    }
    #[test]
    fn source_contract_is_strict_and_requires_nullable_review_id() {
        assert!(serde_json::from_value::<ErrorSource>(json!({"kind":"flashcard","flashcardId":"card"})).is_err());
        assert!(serde_json::from_value::<ErrorSource>(json!({"kind":"manual","extra":1})).is_err());
        assert!(serde_json::from_value::<ErrorSource>(json!({"kind":"flashcard","flashcardId":"card","reviewLogId":null})).is_ok());
    }
    #[test]
    fn note_excerpt_preserves_utf16_limit_without_broken_surrogate() {
        let value = "a".repeat(999) + "😀fim";
        assert_eq!(excerpt(&value), "a".repeat(999));
        assert_eq!(excerpt(&("a".repeat(998) + "😀fim")).encode_utf16().count(), 1000);
    }
}

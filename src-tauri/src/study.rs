//! Portable private study state. Catalogs contain content only; personal evidence
//! remains in tracks and never depends on an AI provider.
use crate::{error::{StoreError, StoreResult}, models::Snapshot, validation};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet, VecDeque};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogSubject { pub id: String, pub name: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Competency { pub id: String, pub subject_id: String, pub title: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Unit { pub id: String, pub competency_id: String, pub title: String, pub summary: String, pub prerequisites: Vec<String> }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Question { pub id: String, pub competency_id: String, pub prompt: String, pub choices: Vec<String>, pub correct_index: i64, pub explanation: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StudyCatalog {
    pub id: String, pub version: i64, pub title: String, pub description: String,
    pub origin: String, pub license: String, pub demonstrative: bool,
    pub subjects: Vec<CatalogSubject>, pub competencies: Vec<Competency>, pub units: Vec<Unit>, pub questions: Vec<Question>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Difficulty { pub subject_id: String, pub level: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Binding { pub unit_id: String, pub subject_id: String, pub note_ids: Vec<String> }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TrackConfig {
    pub name: String, pub objective: String, pub starting_year: String,
    pub subject_ids: Vec<String>, pub difficulties: Vec<Difficulty>,
    #[serde(deserialize_with = "nullable_date")]
    pub exam_date: Option<String>, pub weekly_minutes: i64,
    pub intensity: String, pub pace: String, pub review_every_days: i64, pub mock_every_weeks: i64,
    pub bindings: Vec<Binding>,
}
fn nullable_date<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> {
    Option::<String>::deserialize(deserializer)
}
fn nullable_choice<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<i64>, D::Error> {
    Option::<i64>::deserialize(deserializer)
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Answer {
    pub question_id: String,
    #[serde(deserialize_with = "nullable_choice")]
    pub choice_index: Option<i64>, pub answered_at: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DiagnosticAttempt {
    pub id: String, pub started_at: String, pub updated_at: String, pub status: String,
    pub question_ids: Vec<String>, pub answers: Vec<Answer>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StudyTrack {
    pub id: String, pub revision: i64, pub created_at: String, pub updated_at: String,
    pub catalog: StudyCatalog, pub config: TrackConfig, pub diagnostics: Vec<DiagnosticAttempt>,
}
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveStudyTrackInput {
    pub id: Option<String>, pub expected_revision: Option<i64>,
    pub catalog: StudyCatalog, pub config: TrackConfig, pub diagnostics: Vec<DiagnosticAttempt>,
}
fn invalid(message: &str) -> StoreError { StoreError::Invalid(message.into()) }
fn ensure(condition: bool, message: &str) -> StoreResult<()> { if condition { Ok(()) } else { Err(invalid(message)) } }
fn range(value: i64, low: i64, high: i64) -> StoreResult<()> { ensure((low..=high).contains(&value), "A configuração da trilha contém um número fora do limite.") }
fn count(value: usize, low: usize, high: usize) -> StoreResult<()> { ensure((low..=high).contains(&value), "A trilha contém uma quantidade de registros inválida.") }
fn member(value: &str, options: &[&str]) -> StoreResult<()> { ensure(options.contains(&value), "A trilha contém uma opção desconhecida.") }
fn unique_ids<'a>(values: impl Iterator<Item = &'a str>) -> StoreResult<HashSet<&'a str>> {
    let mut result = HashSet::new();
    for value in values { validation::id(value)?; ensure(result.insert(value), "A trilha contém identificadores duplicados.")?; }
    Ok(result)
}
fn ordered_dates(first: &str, last: &str) -> StoreResult<()> {
    validation::date(first)?; validation::date(last)?;
    ensure(first <= last, "A trilha contém datas fora de ordem.")
}

pub(crate) fn validate_track(track: &StudyTrack) -> StoreResult<()> {
    validation::id(&track.id)?; range(track.revision, 1, validation::MAX_SAFE_INTEGER - 1)?;
    ordered_dates(&track.created_at, &track.updated_at)?;
    let cat = &track.catalog;
    validation::id(&cat.id)?; range(cat.version, 1, validation::MAX_SAFE_INTEGER - 1)?;
    validation::text(&cat.title, 180, "O título do catálogo", false)?;
    validation::text(&cat.description, 4000, "A descrição do catálogo", false)?;
    validation::text(&cat.origin, 500, "A origem do catálogo", false)?;
    validation::text(&cat.license, 120, "A licença do catálogo", false)?;
    ensure(cat.demonstrative, "Esta versão aceita somente catálogos demonstrativos.")?;
    count(cat.subjects.len(), 1, 32)?; count(cat.competencies.len(), 1, 256)?;
    count(cat.units.len(), 1, 512)?; count(cat.questions.len(), 1, 2048)?;
    let subjects = unique_ids(cat.subjects.iter().map(|v| v.id.as_str()))?;
    for item in &cat.subjects { validation::text(&item.name, 120, "O nome da matéria", false)?; }
    unique_ids(cat.competencies.iter().map(|v| v.id.as_str()))?;
    let competencies: HashMap<_, _> = cat.competencies.iter().map(|v| (v.id.as_str(), v)).collect();
    for item in &cat.competencies {
        validation::text(&item.title, 180, "A competência", false)?;
        ensure(subjects.contains(item.subject_id.as_str()), "O catálogo contém uma competência sem matéria.")?;
    }
    let units = unique_ids(cat.units.iter().map(|v| v.id.as_str()))?;
    let mut degree = HashMap::new(); let mut dependents: HashMap<&str, Vec<&str>> = HashMap::new();
    for unit in &cat.units {
        validation::text(&unit.title, 180, "O título da unidade", false)?;
        validation::text(&unit.summary, 4000, "O resumo da unidade", false)?;
        ensure(competencies.contains_key(unit.competency_id.as_str()), "A unidade não possui competência correspondente.")?;
        count(unit.prerequisites.len(), 0, 512)?;
        let prerequisites = unique_ids(unit.prerequisites.iter().map(String::as_str))?;
        degree.insert(unit.id.as_str(), prerequisites.len());
        for prerequisite in prerequisites {
            ensure(units.contains(prerequisite), "O catálogo contém pré-requisito ausente.")?;
            dependents.entry(prerequisite).or_default().push(unit.id.as_str());
        }
    }
    let mut available: VecDeque<_> = degree.iter().filter(|(_, value)| **value == 0).map(|(key, _)| *key).collect();
    let mut visited = 0;
    while let Some(unit) = available.pop_front() {
        visited += 1;
        if let Some(next) = dependents.get(unit) { for id in next { let remaining = degree.get_mut(id).unwrap(); *remaining -= 1; if *remaining == 0 { available.push_back(*id); } } }
    }
    ensure(visited == units.len(), "O catálogo contém um ciclo de pré-requisitos.")?;
    unique_ids(cat.questions.iter().map(|v| v.id.as_str()))?;
    let questions: HashMap<_, _> = cat.questions.iter().map(|v| (v.id.as_str(), v)).collect();
    for question in &cat.questions {
        ensure(competencies.contains_key(question.competency_id.as_str()), "A questão não possui competência correspondente.")?;
        validation::text(&question.prompt, 4000, "A questão", false)?;
        validation::text(&question.explanation, 4000, "A explicação", false)?;
        count(question.choices.len(), 2, 8)?;
        for choice in &question.choices { validation::text(choice, 1000, "A alternativa", false)?; }
        range(question.correct_index, 0, question.choices.len() as i64 - 1)?;
    }
    let config = &track.config;
    validation::text(&config.name, 120, "O nome da trilha", false)?;
    validation::text(&config.objective, 300, "O objetivo", false)?;
    member(&config.starting_year, &["fundamental", "medio-1", "medio-2", "medio-3", "concluido"])?;
    member(&config.intensity, &["light", "balanced", "intensive"])?;
    member(&config.pace, &["gradual", "regular", "accelerated"])?;
    count(config.subject_ids.len(), 1, 32)?;
    let selected = unique_ids(config.subject_ids.iter().map(String::as_str))?;
    ensure(selected.is_subset(&subjects), "A configuração contém uma matéria ausente do catálogo.")?;
    count(config.difficulties.len(), 0, 32)?;
    unique_ids(config.difficulties.iter().map(|v| v.subject_id.as_str()))?;
    for item in &config.difficulties { ensure(selected.contains(item.subject_id.as_str()), "A dificuldade pertence a uma matéria não selecionada.")?; member(&item.level, &["unknown", "low", "medium", "high"])?; }
    if let Some(date) = &config.exam_date {
        ensure(date.len() == 10 && chrono::NaiveDate::parse_from_str(date, "%Y-%m-%d").is_ok_and(|value| value.format("%Y-%m-%d").to_string() == *date), "A data da prova é inválida.")?;
    }
    range(config.weekly_minutes, 30, 5040)?; range(config.review_every_days, 1, 90)?; range(config.mock_every_weeks, 1, 26)?;
    count(config.bindings.len(), 0, 512)?; unique_ids(config.bindings.iter().map(|v| v.unit_id.as_str()))?;
    for binding in &config.bindings {
        let unit = cat.units.iter().find(|unit| unit.id == binding.unit_id).ok_or_else(|| invalid("O vínculo aponta para uma unidade ausente."))?;
        let competency = competencies[unit.competency_id.as_str()];
        ensure(selected.contains(competency.subject_id.as_str()), "O vínculo pertence a uma matéria não selecionada.")?;
        validation::id(&binding.subject_id)?; count(binding.note_ids.len(), 0, 500)?;
        unique_ids(binding.note_ids.iter().map(String::as_str))?;
    }
    count(track.diagnostics.len(), 0, 200)?; unique_ids(track.diagnostics.iter().map(|v| v.id.as_str()))?;
    ensure(track.diagnostics.iter().filter(|v| v.status == "in-progress").count() <= 1, "A trilha só pode ter um diagnóstico em andamento.")?;
    for attempt in &track.diagnostics {
        ordered_dates(&attempt.started_at, &attempt.updated_at)?;
        member(&attempt.status, &["in-progress", "completed", "skipped"])?;
        count(attempt.question_ids.len(), 1, 2048)?;
        let attempted = unique_ids(attempt.question_ids.iter().map(String::as_str))?;
        ensure(attempted.iter().all(|id| questions.contains_key(id)), "O diagnóstico contém uma questão ausente.")?;
        count(attempt.answers.len(), 0, 2048)?; unique_ids(attempt.answers.iter().map(|v| v.question_id.as_str()))?;
        for answer in &attempt.answers {
            ensure(attempted.contains(answer.question_id.as_str()), "A resposta não pertence ao diagnóstico.")?;
            validation::date(&answer.answered_at)?;
            ensure(answer.answered_at >= attempt.started_at && answer.answered_at <= attempt.updated_at, "A resposta contém uma data fora do diagnóstico.")?;
            if let Some(choice) = answer.choice_index { range(choice, 0, questions[answer.question_id.as_str()].choices.len() as i64 - 1)?; }
        }
        ensure(attempt.status != "completed" || attempt.answers.len() == attempted.len(), "O diagnóstico concluído precisa registrar todas as respostas.")?;
        ensure(attempt.status != "in-progress" || attempt.answers.len() < attempted.len(), "Um diagnóstico com todas as respostas deve ser concluído.")?;
    }
    Ok(())
}

pub(crate) fn validate_tracks(data: &Snapshot) -> StoreResult<()> {
    count(data.study_tracks.len(), 0, 100)?; unique_ids(data.study_tracks.iter().map(|v| v.id.as_str()))?;
    let subjects: HashSet<_> = data.subjects.iter().map(|v| v.id.as_str()).collect();
    let notes: HashMap<_, _> = data.notes.iter().map(|v| (v.id.as_str(), v.subject_id.as_str())).collect();
    for track in &data.study_tracks {
        validate_track(track)?;
        for binding in &track.config.bindings {
            ensure(subjects.contains(binding.subject_id.as_str()), "A trilha contém um vínculo para matéria ausente da biblioteca.")?;
            for note in &binding.note_ids { ensure(notes.get(note.as_str()).copied() == Some(binding.subject_id.as_str()), "A trilha contém uma nota ausente ou de outra matéria.")?; }
        }
    }
    Ok(())
}

pub(crate) fn validate_transition(previous: &StudyTrack, next: &StudyTrack) -> StoreResult<()> {
    ensure(previous.id == next.id && previous.created_at == next.created_at && next.updated_at >= previous.updated_at,
        "A identidade ou origem da trilha não pode ser alterada.")?;
    ensure(previous.catalog == next.catalog, "O catálogo de uma trilha existente não pode ser alterado.")?;
    for old in &previous.diagnostics {
        let current = next.diagnostics.iter().find(|value| value.id == old.id)
            .ok_or_else(|| invalid("O histórico de diagnósticos não pode ser removido."))?;
        ensure(current.started_at == old.started_at && current.question_ids == old.question_ids && current.updated_at >= old.updated_at,
            "O diagnóstico salvo não pode ter sua origem ou questões alteradas.")?;
        ensure(old.status != "completed" || current == old, "Um diagnóstico concluído não pode ser alterado.")?;
        for answer in &old.answers {
            ensure(current.answers.iter().any(|value| value == answer), "As respostas já salvas não podem ser alteradas ou removidas.")?;
        }
    }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::{storage, models::{Accent, SubjectInput, NoteInput}};
    use rusqlite::Connection;
    use serde_json::json;

    pub(crate) fn input() -> SaveStudyTrackInput {
        serde_json::from_value(json!({
            "catalog": {
                "id":"demo", "version":1, "title":"ENEM — Do zero", "description":"Amostra demonstrativa", "origin":"StudySpace", "license":"CC0-1.0", "demonstrative":true,
                "subjects":[{"id":"math","name":"Matemática"}],
                "competencies":[{"id":"basics","subjectId":"math","title":"Fundamentos"},{"id":"advanced","subjectId":"math","title":"Proporções"}],
                "units":[{"id":"unit1","competencyId":"basics","title":"Operações","summary":"Operações básicas","prerequisites":[]},{"id":"unit2","competencyId":"advanced","title":"Proporções","summary":"Razões","prerequisites":["unit1"]}],
                "questions":[{"id":"q1","competencyId":"basics","prompt":"2+2?","choices":["4","5"],"correctIndex":0,"explanation":"Duas duplas somam quatro."},{"id":"q2","competencyId":"advanced","prompt":"O dobro de dois?","choices":["5","4"],"correctIndex":1,"explanation":"2×2=4."}]
            },
            "config":{"name":"Meu ENEM", "objective":"Estudar fundamentos", "startingYear":"medio-1", "subjectIds":["math"], "difficulties":[{"subjectId":"math","level":"unknown"}],"examDate":null,"weeklyMinutes":300,"intensity":"balanced","pace":"gradual","reviewEveryDays":7,"mockEveryWeeks":4,"bindings":[]},
            "diagnostics":[]
        })).unwrap()
    }

    fn memory() -> Connection {
        let mut db = Connection::open_in_memory().unwrap();
        db.pragma_update(None, "foreign_keys", "ON").unwrap();
        storage::migrate(&mut db).unwrap(); db
    }
    fn update(track: &StudyTrack) -> SaveStudyTrackInput {
        SaveStudyTrackInput { id: Some(track.id.clone()), expected_revision: Some(track.revision), catalog: track.catalog.clone(), config: track.config.clone(), diagnostics: track.diagnostics.clone() }
    }
    fn attempt(status: &str) -> DiagnosticAttempt {
        DiagnosticAttempt { id:"attempt".into(), started_at:"2026-10-19T12:00:00.000Z".into(), updated_at:"2026-10-19T12:00:00.000Z".into(), status:status.into(), question_ids:vec!["q1".into(), "q2".into()], answers:Vec::new() }
    }

    #[test]
    fn tracks_persist_without_library_duplicates_and_reject_stale_writes() {
        let mut db = memory();
        let track = storage::save_study_track(&mut db, input()).unwrap();
        assert_eq!(track.revision, 1);
        assert!(storage::get_snapshot(&mut db).unwrap().subjects.is_empty());
        let mut edit = update(&track); edit.config.starting_year = "concluido".into();
        let edited = storage::save_study_track(&mut db, edit).unwrap();
        assert_eq!(edited.revision, 2);
        assert!(edited.diagnostics.is_empty());
        assert!(storage::save_study_track(&mut db, update(&track)).unwrap_err().to_string().contains("outra janela"));
        assert_eq!(storage::get_snapshot(&mut db).unwrap().study_tracks, vec![edited]);
        assert!(storage::export_backup(&mut db).unwrap_err().to_string().contains("versão 4"));
    }

    #[test]
    fn catalog_cycles_invalid_dates_and_library_references_never_publish() {
        let mut db = memory();
        let mut invalid = input(); invalid.catalog.units[0].prerequisites.push("unit2".into());
        assert!(storage::save_study_track(&mut db, invalid).unwrap_err().to_string().contains("ciclo"));
        let mut invalid = input(); invalid.config.exam_date = Some("2026-02-30".into());
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        let mut invalid = input(); invalid.config.bindings.push(Binding {unit_id:"unit1".into(), subject_id:"missing".into(), note_ids:Vec::new()});
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        let subject = storage::create_subject(&mut db, SubjectInput{name:"Matemática".into(),accent:Accent::Blue}).unwrap();
        let note = storage::create_note(&mut db, NoteInput{subject_id:subject.id.clone(),title:"Minha aula".into()}).unwrap();
        let mut valid = input(); valid.config.bindings.push(Binding {unit_id:"unit1".into(),subject_id:subject.id,note_ids:vec![note.id]});
        let track = storage::save_study_track(&mut db, valid).unwrap();
        let mut invalid = update(&track); invalid.catalog.title = "Outro catálogo".into();
        assert!(storage::save_study_track(&mut db, invalid).unwrap_err().to_string().contains("catálogo"));
        assert_eq!(storage::get_snapshot(&mut db).unwrap().study_tracks, vec![track]);
    }

    #[test]
    fn partial_diagnostics_skip_resume_and_complete_with_immutable_evidence() {
        let mut db = memory();
        let mut initial = input(); initial.diagnostics.push(attempt("in-progress"));
        let track = storage::save_study_track(&mut db, initial).unwrap();
        let mut edit = update(&track);
        edit.diagnostics[0].answers.push(Answer{question_id:"q1".into(),choice_index:Some(0),answered_at:"2026-10-19T12:00:00.000Z".into()});
        edit.diagnostics[0].status="skipped".into();
        let paused=storage::save_study_track(&mut db, edit).unwrap();
        let mut edit=update(&paused); edit.diagnostics[0].status="in-progress".into();
        let resumed=storage::save_study_track(&mut db, edit).unwrap();
        let mut invalid=update(&resumed); invalid.diagnostics[0].answers[0].choice_index=Some(1);
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        let mut invalid=update(&resumed); invalid.diagnostics.clear();
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        let mut edit=update(&resumed);
        edit.diagnostics[0].answers.push(Answer{question_id:"q2".into(),choice_index:None,answered_at:"2026-10-19T12:00:00.000Z".into()});
        edit.diagnostics[0].status="completed".into();
        let complete=storage::save_study_track(&mut db, edit).unwrap();
        let mut invalid=update(&complete); invalid.diagnostics[0].status="skipped".into();
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        let mut invalid=update(&complete); invalid.diagnostics[0].question_ids.reverse();
        assert!(storage::save_study_track(&mut db, invalid).is_err());
        assert_eq!(storage::get_snapshot(&mut db).unwrap().study_tracks,vec![complete]);
    }
}

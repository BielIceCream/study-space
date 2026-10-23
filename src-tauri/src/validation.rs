use crate::error::{StoreError, StoreResult};
use crate::models::BackupDocument;
use chrono::{DateTime, SecondsFormat};
use serde::Serialize;
use serde_json::Value;
use std::collections::{HashMap, HashSet};
use std::io::{self, Write};

pub const MAX_SAFE_INTEGER: i64 = 9_007_199_254_740_991;
const MAX_BODY_BYTES: usize = 2 * 1024 * 1024;
const MAX_BACKUP_BYTES: usize = 50 * 1024 * 1024;

fn invalid(message: impl Into<String>) -> StoreError {
    StoreError::Invalid(message.into())
}

/// Uses UTF-16 units to match the TypeScript service's string.length limits.
pub fn text(value: &str, max: usize, label: &str, allow_empty: bool) -> StoreResult<()> {
    if (!allow_empty && value.trim().is_empty()) || value.encode_utf16().count() > max {
        return Err(invalid(format!("{label} deve ter {} a {max} caracteres.", if allow_empty { 0 } else { 1 })));
    }
    if value.contains('\0') {
        return Err(invalid(format!("{label} contém um caractere inválido.")));
    }
    Ok(())
}

pub fn id(value: &str) -> StoreResult<()> {
    text(value, 160, "O identificador", false)
}

pub fn rating(value: u8) -> StoreResult<()> {
    if !(1..=4).contains(&value) {
        return Err(invalid("A avaliação deve ser Errei, Difícil, Bom ou Fácil."));
    }
    Ok(())
}

pub fn revision(value: i64) -> StoreResult<()> {
    if !(1..=MAX_SAFE_INTEGER).contains(&value) {
        return Err(invalid("A revisão da nota é inválida."));
    }
    Ok(())
}

pub fn date(value: &str) -> StoreResult<()> {
    // The backup contract uses precisely the UTC representation emitted by Date.toISOString.
    if value.len() != 24 {
        return Err(invalid("O backup contém uma data inválida; use datas UTC no formato ISO."));
    }
    let parsed = DateTime::parse_from_rfc3339(value)
        .map_err(|_| invalid("O backup contém uma data inválida."))?;
    if parsed.offset().local_minus_utc() != 0
        || parsed.to_rfc3339_opts(SecondsFormat::Millis, true) != value
        || parsed.timestamp_subsec_nanos() >= 1_000_000_000
    {
        return Err(invalid("O backup contém uma data inválida; use datas UTC no formato ISO."));
    }
    Ok(())
}

fn dates(created_at: &str, updated_at: &str) -> StoreResult<()> {
    date(created_at)?;
    date(updated_at)?;
    if updated_at < created_at {
        return Err(invalid("A data de edição não pode ser anterior à data de criação."));
    }
    Ok(())
}

struct SizeLimit {
    size: usize,
    max: usize,
    exceeded: bool,
}

impl Write for SizeLimit {
    fn write(&mut self, bytes: &[u8]) -> io::Result<usize> {
        if bytes.len() > self.max.saturating_sub(self.size) {
            self.exceeded = true;
            return Err(io::Error::new(io::ErrorKind::InvalidData, "limite de tamanho"));
        }
        self.size += bytes.len();
        Ok(bytes.len())
    }

    fn flush(&mut self) -> io::Result<()> {
        Ok(())
    }
}

pub(crate) fn json_size<T: Serialize>(value: &T, max: usize, label: &str) -> StoreResult<usize> {
    // Count streamed bytes without allocating a second, potentially very large document.
    let mut counter = SizeLimit { size: 0, max, exceeded: false };
    if let Err(error) = serde_json::to_writer(&mut counter, value) {
        if counter.exceeded {
            return Err(invalid(format!("{label} excede o limite permitido de {} MiB.", max / 1024 / 1024)));
        }
        return Err(error.into());
    }
    Ok(counter.size)
}

pub fn document(value: &Value) -> StoreResult<()> {
    json_size(value, MAX_BODY_BYTES, "A nota")?;
    let mut nodes = 0;
    let mut stack = vec![(value, 0)];
    while let Some((node, depth)) = stack.pop() {
        nodes += 1;
        if nodes > 100_000 || depth > 64 {
            return Err(invalid("A estrutura da nota é grande ou profunda demais."));
        }
        match node {
            Value::Object(object) => {
                if object.keys().any(|key| key.contains('\0')) {
                    return Err(invalid("A nota contém uma chave inválida."));
                }
                stack.extend(object.values().map(|child| (child, depth + 1)));
            }
            Value::Array(array) => stack.extend(array.iter().map(|child| (child, depth + 1))),
            Value::String(value) if value.contains('\0') => {
                return Err(invalid("A nota contém um caractere inválido."));
            }
            _ => {}
        }
    }
    if value.get("type").and_then(Value::as_str) != Some("doc") {
        return Err(invalid("A nota deve conter um documento válido do editor."));
    }
    rich_node(value)
}

fn rich_node(value: &Value) -> StoreResult<()> {
    let object = value.as_object().ok_or_else(|| invalid("A nota contém um bloco inválido."))?;
    if object.keys().any(|key| !matches!(key.as_str(), "type" | "attrs" | "content" | "marks" | "text")) {
        return Err(invalid("A nota contém campos de bloco desconhecidos."));
    }
    let kind = object.get("type").and_then(Value::as_str)
        .ok_or_else(|| invalid("A nota contém um bloco sem tipo."))?;
    text(kind, 160, "O tipo de bloco", false)?;
    if let Some(attrs) = object.get("attrs") {
        if !attrs.is_object() {
            return Err(invalid("Os atributos de um bloco devem ser um objeto JSON."));
        }
    }
    if let Some(content) = object.get("content") {
        let children = content.as_array().ok_or_else(|| invalid("O conteúdo de um bloco deve ser uma lista."))?;
        for child in children {
            rich_node(child)?;
        }
    }
    if let Some(marks) = object.get("marks") {
        let marks = marks.as_array().ok_or_else(|| invalid("A formatação de um bloco deve ser uma lista."))?;
        for mark in marks {
            let mark = mark.as_object().ok_or_else(|| invalid("A nota contém formatação inválida."))?;
            if mark.keys().any(|key| !matches!(key.as_str(), "type" | "attrs")) {
                return Err(invalid("A nota contém campos de formatação desconhecidos."));
            }
            let kind = mark.get("type").and_then(Value::as_str)
                .ok_or_else(|| invalid("A nota contém formatação sem tipo."))?;
            text(kind, 160, "O tipo de formatação", false)?;
            if mark.get("attrs").is_some_and(|attrs| !attrs.is_object()) {
                return Err(invalid("Os atributos da formatação devem ser um objeto JSON."));
            }
        }
    }
    if kind == "text" && !object.get("text").is_some_and(Value::is_string) {
        return Err(invalid("Um bloco de texto deve conter texto."));
    }
    if let Some(value) = object.get("text") {
        let value = value.as_str().ok_or_else(|| invalid("A nota contém texto inválido."))?;
        text(value, 2_000_000, "O texto do bloco", true)?;
    }
    Ok(())
}

pub fn backup(value: &BackupDocument) -> StoreResult<()> {
    if value.format != "studyspace-backup" || !matches!(value.version,1|2) {
        return Err(invalid("Este arquivo não é um backup StudySpace compatível (versões 1 e 2)."));
    }
    if !value.data.error_entries.is_empty() {
        return Err(invalid("O caderno de erros exige um arquivo .studyspace da versão 7. Exporte o backup portátil para preservar esses dados."));
    }
    if !value.data.review_schedules.is_empty() {
        return Err(invalid("A agenda de revisão exige um arquivo .studyspace da versão 6. Exporte o backup portátil para preservar esses dados."));
    }
    if !value.data.study_planners.is_empty() {
        return Err(invalid("A agenda exige um arquivo .studyspace da versão 5. Exporte o backup portátil para preservar esses dados."));
    }
    if !value.data.study_tracks.is_empty() {
        return Err(invalid("Trilhas e diagnósticos exigem um arquivo .studyspace da versão 4. Exporte o backup de arquivo para preservar esses dados."));
    }
    date(&value.exported_at)?;
    json_size(value, MAX_BACKUP_BYTES, "O backup")?;
    crate::materials::validate_backup(value)?;
    snapshot(&value.data)
}

pub(crate) fn snapshot(data: &crate::models::Snapshot) -> StoreResult<()> {
    if data.subjects.len() > 10_000 || data.notes.len() > 50_000
        || data.flashcards.len() > 200_000 || data.review_logs.len() > 1_000_000
    {
        return Err(invalid("O backup contém mais registros do que o limite permitido."));
    }

    let mut subjects = HashSet::new();
    for subject in &data.subjects {
        id(&subject.id)?;
        text(&subject.name, 120, "O nome da matéria", false)?;
        dates(&subject.created_at, &subject.updated_at)?;
        if !subjects.insert(subject.id.as_str()) {
            return Err(invalid("O backup contém matérias com identificadores duplicados."));
        }
    }

    let mut notes = HashMap::new();
    for note in &data.notes {
        id(&note.id)?;
        id(&note.subject_id)?;
        text(&note.title, 180, "O título da nota", false)?;
        text(&note.plain_text, 2_000_000, "O texto da nota", true)?;
        document(&note.body_json)?;
        revision(note.revision)?;
        dates(&note.created_at, &note.updated_at)?;
        if !subjects.contains(note.subject_id.as_str()) {
            return Err(invalid("O backup contém uma nota sem matéria correspondente."));
        }
        if notes.insert(note.id.as_str(), note.subject_id.as_str()).is_some() {
            return Err(invalid("O backup contém notas com identificadores duplicados."));
        }
    }

    let mut flashcards = HashSet::new();
    for card in &data.flashcards {
        id(&card.id)?;
        id(&card.subject_id)?;
        text(&card.front, 20_000, "A pergunta do cartão", false)?;
        text(&card.back, 20_000, "A resposta do cartão", false)?;
        dates(&card.created_at, &card.updated_at)?;
        if !subjects.contains(card.subject_id.as_str()) {
            return Err(invalid("O backup contém um cartão sem matéria correspondente."));
        }
        if let Some(note_id) = &card.note_id {
            id(note_id)?;
            if notes.get(note_id.as_str()).copied() != Some(card.subject_id.as_str()) {
                return Err(invalid("O backup contém um cartão vinculado a uma nota ausente ou de outra matéria."));
            }
        }
        if !flashcards.insert(card.id.as_str()) {
            return Err(invalid("O backup contém cartões com identificadores duplicados."));
        }
    }

    let mut reviews = HashSet::new();
    let mut sessions = HashSet::new();
    for review in &data.review_logs {
        id(&review.id)?;
        id(&review.flashcard_id)?;
        text(&review.session_id, 160, "A sessão de revisão", false)?;
        rating(review.rating)?;
        date(&review.reviewed_at)?;
        if !flashcards.contains(review.flashcard_id.as_str()) {
            return Err(invalid("O backup contém uma revisão sem cartão correspondente."));
        }
        if !reviews.insert(review.id.as_str())
            || !sessions.insert((review.session_id.as_str(), review.flashcard_id.as_str()))
        {
            return Err(invalid("O backup contém revisões duplicadas."));
        }
    }
    crate::study::validate_tracks(data)?;
    crate::planner::validate_planners(data)?;
    crate::review_schedule::validate_schedules(data)?;
    crate::error_notebook::validate_entries(data)
}

//! Versioned local scheduling rules. Free practice never calls this engine.
use crate::{error::{StoreError, StoreResult}, models::{ReviewLog, Snapshot}, validation};
use chrono::{DateTime, Duration, SecondsFormat};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

const DAY_MINUTES: i64 = 24 * 60;
const INTERVAL_DAYS: [i64; 6] = [1, 3, 7, 14, 30, 60];
const MAX_REPETITIONS: u32 = 1_000_000;

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ReviewSchedule {
    pub flashcard_id: String,
    pub algorithm_version: u8,
    pub stage: u8,
    pub repetitions: u32,
    pub lapses: u32,
    pub first_review_id: String,
    pub introduced_at: String,
    pub last_review_id: String,
    pub last_reviewed_at: String,
    pub due_at: String,
}

fn invalid(message: &str) -> StoreError { StoreError::Invalid(message.into()) }

pub fn validate(value: &ReviewSchedule) -> StoreResult<()> {
    validation::id(&value.flashcard_id)?;
    validation::id(&value.last_review_id)?;
    validation::id(&value.first_review_id)?;
    validation::date(&value.introduced_at)?;
    validation::date(&value.last_reviewed_at)?;
    validation::date(&value.due_at)?;
    if value.algorithm_version != 1 || value.stage > 6
        || !(1..=MAX_REPETITIONS).contains(&value.repetitions) || value.lapses > value.repetitions
        || u32::from(value.stage) > value.repetitions * 2 || (value.stage > 0 && value.lapses == value.repetitions)
        || value.due_at <= value.last_reviewed_at
    {
        return Err(invalid("A agenda de revisão contém regras, contadores ou datas inválidos."));
    }
    let introduction_invalid = if value.repetitions == 1 {
        value.introduced_at != value.last_reviewed_at || value.first_review_id != value.last_review_id
    } else { value.introduced_at >= value.last_reviewed_at || value.first_review_id == value.last_review_id };
    if introduction_invalid {
        return Err(invalid("A entrada do cartão na agenda é inconsistente com as revisões."));
    }
    Ok(())
}

fn interval_minutes(stage: u8, rating: u8) -> StoreResult<i64> {
    validation::rating(rating)?;
    match rating {
        1 if stage == 0 => Ok(10),
        2 if stage == 0 => Ok(60),
        2 if stage <= 6 => Ok((INTERVAL_DAYS[usize::from(stage - 1)] / 2).max(1) * DAY_MINUTES),
        3 if (1..=6).contains(&stage) => Ok(INTERVAL_DAYS[usize::from(stage - 1)] * DAY_MINUTES),
        4 if (2..=6).contains(&stage) => Ok(INTERVAL_DAYS[usize::from(stage - 1)] * DAY_MINUTES),
        _ => Err(invalid("O estágio da revisão não corresponde à última avaliação.")),
    }
}

fn due_after(reviewed_at: &str, minutes: i64) -> StoreResult<String> {
    validation::date(reviewed_at)?;
    let reviewed = DateTime::parse_from_rfc3339(reviewed_at).map_err(|_| invalid("A data da revisão é inválida."))?;
    let due = reviewed.checked_add_signed(Duration::minutes(minutes)).ok_or_else(|| invalid("O vencimento da revisão excede as datas suportadas."))?;
    let result = due.to_rfc3339_opts(SecondsFormat::Millis, true);
    validation::date(&result)?;
    Ok(result)
}

pub fn advance(previous: Option<&ReviewSchedule>, review: &ReviewLog) -> StoreResult<ReviewSchedule> {
    validation::id(&review.id)?;
    validation::id(&review.flashcard_id)?;
    validation::text(&review.session_id, 160, "A sessão de revisão", false)?;
    validation::date(&review.reviewed_at)?;
    validation::rating(review.rating)?;
    if let Some(previous) = previous {
        validate(previous)?;
        if previous.flashcard_id != review.flashcard_id {
            return Err(invalid("A agenda de revisão pertence a outro cartão."));
        }
        if review.id == previous.last_review_id {
            return Err(invalid("Esta revisão já foi aplicada à agenda."));
        }
        if review.reviewed_at < previous.due_at {
            return Err(invalid("Este cartão ainda não venceu. Use a prática livre para estudar antes da próxima revisão."));
        }
    }
    let old_stage = previous.map_or(0, |value| value.stage);
    let stage = match review.rating {
        1 => 0,
        2 => old_stage,
        3 => (old_stage + 1).min(6),
        4 => (old_stage + 2).min(6),
        _ => unreachable!(),
    };
    let schedule = ReviewSchedule {
        flashcard_id: review.flashcard_id.clone(), algorithm_version: 1, stage,
        repetitions: previous.map_or(0, |value| value.repetitions) + 1,
        lapses: previous.map_or(0, |value| value.lapses) + u32::from(review.rating == 1),
        first_review_id: previous.map_or_else(|| review.id.clone(), |value| value.first_review_id.clone()),
        introduced_at: previous.map_or_else(|| review.reviewed_at.clone(), |value| value.introduced_at.clone()),
        last_review_id: review.id.clone(), last_reviewed_at: review.reviewed_at.clone(),
        due_at: due_after(&review.reviewed_at, interval_minutes(stage, review.rating)?)?,
    };
    validate(&schedule)?;
    Ok(schedule)
}

pub fn validate_schedules(data: &Snapshot) -> StoreResult<()> {
    if data.review_schedules.len() > 200_000 {
        return Err(invalid("O backup excede o limite de agendas de revisão."));
    }
    if data.review_schedules.is_empty() { return Ok(()); }
    let cards = data.flashcards.iter().map(|card| card.id.as_str()).collect::<HashSet<_>>();
    let reviews = data.review_logs.iter().map(|review| (review.id.as_str(), review)).collect::<HashMap<_, _>>();
    let mut counts: HashMap<&str, u32> = HashMap::new();
    for review in &data.review_logs { *counts.entry(&review.flashcard_id).or_default() += 1; }
    let mut seen = HashSet::new();
    for schedule in &data.review_schedules {
        validate(schedule)?;
        if !seen.insert(schedule.flashcard_id.as_str()) || !cards.contains(schedule.flashcard_id.as_str()) {
            return Err(invalid("O backup contém agendas de revisão duplicadas ou sem cartão."));
        }
        let review = reviews.get(schedule.last_review_id.as_str()).ok_or_else(|| invalid("A agenda de revisão aponta para uma avaliação ausente."))?;
        let first = reviews.get(schedule.first_review_id.as_str()).ok_or_else(|| invalid("A entrada na agenda aponta para uma avaliação ausente."))?;
        if review.flashcard_id != schedule.flashcard_id || review.reviewed_at != schedule.last_reviewed_at
            || first.flashcard_id != schedule.flashcard_id || first.reviewed_at != schedule.introduced_at
            || schedule.repetitions > counts.get(schedule.flashcard_id.as_str()).copied().unwrap_or(0)
            || (review.rating == 1 && schedule.lapses == 0)
            || due_after(&review.reviewed_at, interval_minutes(schedule.stage, review.rating)?)? != schedule.due_at
        {
            return Err(invalid("A agenda de revisão não corresponde ao histórico do cartão."));
        }
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Deserialize)]
    struct Case { name: String, previous: Option<ReviewSchedule>, review: ReviewLog, expected: ReviewSchedule }

    #[test]
    fn shared_rules_match_browser_vectors() {
        let cases: Vec<Case> = serde_json::from_str(include_str!("../../tests/fixtures/spaced-repetition-v1.json")).unwrap();
        assert!(cases.len() >= 8);
        for case in cases {
            assert_eq!(advance(case.previous.as_ref(), &case.review).unwrap(), case.expected, "{}", case.name);
        }
    }
}

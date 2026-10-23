//! Local agenda validation and atomic persistence contract. Scheduling remains in
//! the shared TypeScript core; native storage never needs a provider or network.
use crate::{error::{StoreError, StoreResult}, models::Snapshot, validation};
use chrono::{Datelike, NaiveDate};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};

#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerDay { pub weekday: i64, pub start_minute: i64, pub minutes: i64 }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct UnitEstimate { pub unit_id: String, pub minutes: i64 }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerConfig {
    pub days: Vec<PlannerDay>, pub block_minutes: i64, pub break_minutes: i64,
    pub mock_minutes: i64, pub unit_estimates: Vec<UnitEstimate>,
}
fn nullable_string<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<String>, D::Error> { Option::<String>::deserialize(deserializer) }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerBlock {
    pub id: String,
    #[serde(deserialize_with = "nullable_string")]
    pub unit_id: Option<String>, pub kind: String, pub date: String,
    pub start_minute: i64, pub minutes: i64, pub break_minutes: i64,
    pub status: String, pub fixed: bool,
    #[serde(deserialize_with = "nullable_string")]
    pub completed_at: Option<String>, pub reason: String,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerWeek {
    pub week_start: String, pub plan_id: String, pub generated_at: String,
    pub rules_version: i64, pub budget_minutes: i64, pub config: PlannerConfig,
    pub blocks: Vec<PlannerBlock>,
}
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct PlannerUndo { pub previous_weeks: Vec<PlannerWeek>, pub previous_backlog: Vec<PlannerBlock>, pub accepted_plan_id: String }
#[derive(Clone, Debug, Deserialize, Serialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct StudyPlanner {
    pub track_id: String, pub revision: i64, pub created_at: String, pub updated_at: String,
    pub config: PlannerConfig, pub weeks: Vec<PlannerWeek>, pub backlog: Vec<PlannerBlock>,
    #[serde(deserialize_with = "nullable_undo")]
    pub undo: Option<PlannerUndo>,
}
fn nullable_undo<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<PlannerUndo>, D::Error> { Option::<PlannerUndo>::deserialize(deserializer) }
#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SaveStudyPlannerInput {
    pub track_id: String, pub expected_revision: Option<i64>,
    pub config: PlannerConfig, pub weeks: Vec<PlannerWeek>, pub backlog: Vec<PlannerBlock>,
    #[serde(deserialize_with = "nullable_undo")]
    pub undo: Option<PlannerUndo>,
}
fn ensure(condition: bool, message: &str) -> StoreResult<()> { if condition { Ok(()) } else { Err(StoreError::Invalid(message.into())) } }
fn range(value: i64, low: i64, high: i64) -> StoreResult<()> { ensure((low..=high).contains(&value), "O planner contém um número fora do limite.") }
fn count(value: usize, high: usize) -> StoreResult<()> { ensure(value <= high, "O planner contém registros além do limite.") }
fn agenda_id(value: &str) -> StoreResult<()> { validation::text(value, 400, "O identificador da agenda", false) }
fn civil(value: &str) -> StoreResult<NaiveDate> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").map_err(|_| StoreError::Invalid("A agenda contém uma data inválida.".into()))?;
    ensure(value.len() == 10 && date.format("%Y-%m-%d").to_string() == value, "A agenda contém uma data inválida.")?;
    Ok(date)
}
fn config(value: &PlannerConfig) -> StoreResult<()> {
    ensure(!value.days.is_empty(), "Selecione pelo menos um dia para estudar.")?; count(value.days.len(),7)?;
    let mut weekdays = HashSet::new();
    for day in &value.days {
        range(day.weekday,0,6)?; range(day.start_minute,0,1439)?; range(day.minutes,1,720)?;
        ensure(day.start_minute + day.minutes <= 1440 && weekdays.insert(day.weekday), "A disponibilidade contém dias repetidos ou ultrapassa a meia-noite.")?;
    }
    range(value.block_minutes,10,120)?; range(value.break_minutes,0,30)?; range(value.mock_minutes,10,240)?;
    count(value.unit_estimates.len(),512)?;
    let mut units=HashSet::new();
    for estimate in &value.unit_estimates { validation::id(&estimate.unit_id)?; range(estimate.minutes,1,1440)?; ensure(units.insert(&estimate.unit_id), "A duração de uma unidade foi informada duas vezes.")?; }
    Ok(())
}
fn weeks(values: &[PlannerWeek]) -> StoreResult<()> {
    count(values.len(),520)?;
    let mut starts=HashSet::new(); let mut ids=HashSet::new(); let mut total=0;
    for week in values {
        let monday=civil(&week.week_start)?;
        ensure(monday.weekday().num_days_from_monday()==0 && starts.insert(&week.week_start), "A semana deve começar na segunda-feira e não pode se repetir.")?;
        agenda_id(&week.plan_id)?; validation::date(&week.generated_at)?; range(week.rules_version,1,1)?;
        range(week.budget_minutes,30,5040)?; config(&week.config)?; count(week.blocks.len(),200)?;
        total+=week.blocks.len(); count(total,10_000)?;
        let mut used=0; let mut intervals: HashMap<&str,Vec<(i64,i64)>>=HashMap::new();
        for block in &week.blocks {
            agenda_id(&block.id)?; ensure(ids.insert(&block.id), "A agenda contém blocos duplicados.")?;
            ensure(["learn","practice","review","mock"].contains(&block.kind.as_str()), "A agenda contém um tipo de bloco desconhecido.")?;
            ensure((block.kind=="mock") == block.unit_id.is_none(), "O bloco precisa identificar uma unidade, exceto no simulado manual.")?;
            if let Some(id)=&block.unit_id { validation::id(id)?; }
            let day=civil(&block.date)?;
            let offset=(day-monday).num_days(); ensure((0..=6).contains(&offset), "Um bloco está fora da semana da agenda.")?;
            range(block.start_minute,0,1439)?; range(block.minutes,1,240)?; range(block.break_minutes,0,30)?;
            let end=block.start_minute+block.minutes+block.break_minutes;
            let window=week.config.days.iter().find(|value|value.weekday==offset);
            ensure(end<=1440 && (block.status=="completed" || window.is_some_and(|value| block.start_minute>=value.start_minute && end<=value.start_minute+value.minutes)), "O bloco e sua pausa precisam caber na disponibilidade diária.")?;
            ensure(["pending","completed"].contains(&block.status.as_str()), "A agenda contém um estado de bloco desconhecido.")?;
            ensure((block.status=="completed") == block.completed_at.is_some(), "A conclusão de um bloco precisa de data, e um bloco pendente não pode ter conclusão.")?;
            if let Some(date)=&block.completed_at { validation::date(date)?; }
            validation::text(&block.reason,2000,"O motivo do bloco",false)?;
            used+=block.minutes+block.break_minutes;
            intervals.entry(&block.date).or_default().push((block.start_minute,end));
        }
        ensure(used<=week.budget_minutes,"Os blocos e pausas ultrapassam o orçamento semanal.")?;
        for slots in intervals.values_mut() { slots.sort_unstable(); ensure(slots.windows(2).all(|pair|pair[0].1<=pair[1].0),"A agenda contém horários sobrepostos.")?; }
    }
    Ok(())
}
fn backlog(values: &[PlannerBlock], scheduled: &[PlannerWeek]) -> StoreResult<()> {
    count(values.len()+scheduled.iter().map(|week|week.blocks.len()).sum::<usize>(),10_000)?;
    let mut ids:HashSet<&str>=scheduled.iter().flat_map(|week|week.blocks.iter()).map(|block|block.id.as_str()).collect();
    for block in values {
        agenda_id(&block.id)?; ensure(ids.insert(&block.id),"A agenda contém tarefas repetidas entre os horários e as pendências.")?;
        civil(&block.date)?; range(block.start_minute,0,1439)?; range(block.minutes,1,240)?; range(block.break_minutes,0,30)?;
        ensure(block.start_minute+block.minutes+block.break_minutes<=1440,"A origem de uma pendência ultrapassa a meia-noite.")?;
        ensure(block.status=="pending" && !block.fixed && block.completed_at.is_none(),"Uma pendência sem horário não pode estar concluída ou fixa.")?;
        ensure(["learn","practice","review","mock"].contains(&block.kind.as_str()),"A pendência contém um tipo desconhecido.")?;
        ensure((block.kind=="mock")==block.unit_id.is_none(),"Somente o simulado manual pode ficar sem unidade.")?;
        if let Some(id)=&block.unit_id { validation::id(id)?; }
        validation::text(&block.reason,2000,"O motivo da pendência",false)?;
    }
    Ok(())
}
pub(crate) fn validate_planner(value: &StudyPlanner) -> StoreResult<()> {
    validation::id(&value.track_id)?; range(value.revision,1,validation::MAX_SAFE_INTEGER-1)?;
    validation::date(&value.created_at)?; validation::date(&value.updated_at)?;
    ensure(value.created_at<=value.updated_at,"A atualização da agenda antecede sua criação.")?;
    config(&value.config)?; weeks(&value.weeks)?; backlog(&value.backlog,&value.weeks)?;
    if let Some(undo)=&value.undo {
        agenda_id(&undo.accepted_plan_id)?; weeks(&undo.previous_weeks)?; backlog(&undo.previous_backlog,&undo.previous_weeks)?;
        ensure(value.weeks.iter().any(|week|week.plan_id==undo.accepted_plan_id),"A proposta para desfazer não está na agenda atual.")?;
        let current:HashMap<_,_>=value.weeks.iter().flat_map(|week|week.blocks.iter()).map(|block|(&block.id,block)).collect();
        for block in undo.previous_weeks.iter().flat_map(|week|week.blocks.iter()).filter(|block|block.status=="completed" || block.fixed) {
            ensure(current.get(&block.id).copied()==Some(block),"Desfazer não pode alterar blocos concluídos ou fixos.")?;
        }
    }
    Ok(())
}
pub(crate) fn validate_planners(data: &Snapshot) -> StoreResult<()> {
    count(data.study_planners.len(),100)?;
    let mut track_ids=HashSet::new();
    for planner in &data.study_planners {
        ensure(track_ids.insert(&planner.track_id),"Uma trilha contém agendas duplicadas.")?;
        validate_planner(planner)?;
        let track=data.study_tracks.iter().find(|track|track.id==planner.track_id).ok_or_else(||StoreError::Invalid("A agenda aponta para uma trilha ausente.".into()))?;
        let units:HashSet<_>=track.catalog.units.iter().map(|unit|unit.id.as_str()).collect();
        let check_config=|value:&PlannerConfig| ensure(value.unit_estimates.iter().all(|estimate|units.contains(estimate.unit_id.as_str())),"A duração estimada aponta para uma unidade ausente.");
        check_config(&planner.config)?;
        for week in planner.weeks.iter().chain(planner.undo.iter().flat_map(|undo|undo.previous_weeks.iter())) {
            check_config(&week.config)?;
            ensure(week.blocks.iter().all(|block|block.unit_id.as_deref().is_none_or(|id|units.contains(id))),"A agenda contém um bloco de uma unidade ausente.")?;
        }
        for block in planner.backlog.iter().chain(planner.undo.iter().flat_map(|undo|undo.previous_backlog.iter())) {
            ensure(block.unit_id.as_deref().is_none_or(|id|units.contains(id)),"Uma pendência aponta para uma unidade ausente.")?;
        }
    }
    Ok(())
}
pub(crate) fn validate_transition(previous: &StudyPlanner,next: &StudyPlanner) -> StoreResult<()> {
    ensure(previous.track_id==next.track_id && previous.created_at==next.created_at && next.updated_at>=previous.updated_at,"A identidade e a origem da agenda precisam ser preservadas.")?;
    let current:HashMap<_,_>=next.weeks.iter().flat_map(|week|week.blocks.iter()).map(|block|(&block.id,block)).collect();
    let mut changed_activity=false;
    for block in previous.weeks.iter().flat_map(|week|week.blocks.iter()).chain(previous.backlog.iter()) {
        let candidate=current.get(&block.id).copied();
        if block.status=="completed" { ensure(candidate==Some(block),"Um bloco concluído não pode ser alterado ou removido.")?; }
        if block.fixed {
            ensure(candidate.is_some_and(|value|value.date==block.date && value.start_minute==block.start_minute && value.minutes==block.minutes && value.break_minutes==block.break_minutes && value.kind==block.kind && value.unit_id==block.unit_id && value.reason==block.reason),"Desfixe o bloco antes de alterar seu horário ou removê-lo.")?;
        }
        if candidate.is_some_and(|value|value.status!=block.status || value.fixed!=block.fixed) { changed_activity=true; }
    }
    if changed_activity { ensure(next.undo.is_none(),"Após concluir ou fixar um bloco, a proposta anterior não pode ser desfeita.")?; }
    Ok(())
}

#[cfg(test)]
pub(crate) mod tests {
    use super::*;
    use crate::storage;
    use rusqlite::Connection;
    use serde_json::json;
    pub(crate) fn input(track_id:&str) -> SaveStudyPlannerInput {
        serde_json::from_value(json!({
            "trackId":track_id,"config":config(),"backlog":[],"undo":null,
            "weeks":[{"weekStart":"2026-10-19","planId":"plan-1","generatedAt":"2026-10-20T12:00:00.000Z","rulesVersion":1,"budgetMinutes":300,"config":config(),"blocks":[{
                "id":"learn-unit1-0","unitId":"unit1","kind":"learn","date":"2026-10-19","startMinute":1140,"minutes":25,"breakMinutes":5,"status":"pending","fixed":false,"completedAt":null,"reason":"Fundamento antes de proporções."
            }]}]
        })).unwrap()
    }
    fn config() -> serde_json::Value { json!({"days":[{"weekday":0,"startMinute":1140,"minutes":120},{"weekday":1,"startMinute":1140,"minutes":120}],"blockMinutes":25,"breakMinutes":5,"mockMinutes":30,"unitEstimates":[{"unitId":"unit1","minutes":50},{"unitId":"unit2","minutes":50}]}) }
    fn memory() -> (Connection,String) {
        let mut db=Connection::open_in_memory().unwrap(); db.pragma_update(None,"foreign_keys","ON").unwrap(); storage::migrate(&mut db).unwrap();
        let track=storage::save_study_track(&mut db,crate::study::tests::input()).unwrap();
        (db,track.id)
    }
    fn update(value:&StudyPlanner) -> SaveStudyPlannerInput { SaveStudyPlannerInput {track_id:value.track_id.clone(),expected_revision:Some(value.revision),config:value.config.clone(),weeks:value.weeks.clone(),backlog:value.backlog.clone(),undo:value.undo.clone()} }

    #[test]
    fn saves_agenda_with_optimistic_revision_and_rejects_missing_track() {
        let (mut db,id)=memory();
        assert!(storage::save_study_planner(&mut db,input("missing")).is_err());
        let planner=storage::save_study_planner(&mut db,input(&id)).unwrap();
        let edited=storage::save_study_planner(&mut db,update(&planner)).unwrap();
        assert_eq!(edited.revision,2);
        assert!(storage::save_study_planner(&mut db,update(&planner)).unwrap_err().to_string().contains("outra janela"));
        assert_eq!(storage::get_snapshot(&mut db).unwrap().study_planners,vec![edited]);
    }

    #[test]
    fn invalid_windows_overlap_budgets_links_and_backlog_rollback_without_publishing() {
        let (mut db,id)=memory();
        let planner=storage::save_study_planner(&mut db,input(&id)).unwrap();
        let mut bad=update(&planner); bad.weeks[0].blocks[0].start_minute=0;
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&planner); bad.weeks[0].budget_minutes=30; bad.weeks[0].blocks[0].minutes=31;
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&planner); let mut duplicate=bad.weeks[0].blocks[0].clone(); duplicate.id="other".into(); bad.weeks[0].blocks.push(duplicate);
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&planner); bad.weeks[0].blocks[0].unit_id=Some("absent".into());
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&planner); bad.backlog.push(bad.weeks[0].blocks[0].clone());
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&planner); let mut waiting=bad.weeks[0].blocks.pop().unwrap(); waiting.fixed=true; bad.backlog.push(waiting);
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        assert_eq!(storage::get_snapshot(&mut db).unwrap().study_planners,vec![planner]);
    }

    #[test]
    fn preserves_fixed_and_completed_slots_and_validates_undo_snapshot() {
        let (mut db,id)=memory();
        let mut initial=input(&id); initial.weeks[0].blocks[0].fixed=true;
        let fixed=storage::save_study_planner(&mut db,initial).unwrap();
        let mut bad=update(&fixed); bad.weeks[0].blocks[0].fixed=false; bad.weeks[0].blocks[0].start_minute+=5;
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut complete=update(&fixed); complete.weeks[0].blocks[0].status="completed".into(); complete.weeks[0].blocks[0].completed_at=Some("2026-10-20T12:00:00.000Z".into());
        let complete=storage::save_study_planner(&mut db,complete).unwrap();
        let mut bad=update(&complete); bad.weeks[0].blocks.clear(); assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&complete); bad.weeks[0].blocks[0].reason="Alterado".into(); assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut bad=update(&complete); bad.undo=Some(PlannerUndo{previous_weeks:vec![],previous_backlog:vec![],accepted_plan_id:"unknown-plan".into()});
        assert!(storage::save_study_planner(&mut db,bad).is_err());
        let mut historical=update(&complete); historical.weeks[0].config.days.remove(0);
        let historical=storage::save_study_planner(&mut db,historical).unwrap();
        assert_eq!(historical.weeks[0].blocks[0],complete.weeks[0].blocks[0]);
    }
}

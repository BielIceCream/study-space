import { describe, expect, it } from 'vitest';
import { DEMO_CATALOG, defaultConfig } from '../study/demo';
import type { StudyTrack } from '../study/types';
import type { PlannerConfig, SaveStudyPlannerInput, StudyPlanner } from './types';
import { acceptPreview, buildPreview, completeBlock, defaultPlannerConfig, toggleFixed, undoPreview, weekStartFor } from './engine';
import { plannerSchema, savePlannerSchema, validatePlannerTransition } from './validation';

const clock = {date:'2026-10-19',minute:480,iso:'2026-10-19T11:00:00.000Z'};
function track(): StudyTrack { return {id:'track',revision:1,createdAt:clock.iso,updatedAt:clock.iso,catalog:structuredClone(DEMO_CATALOG),config:defaultConfig(),diagnostics:[]}; }
function config(t: StudyTrack): PlannerConfig { return {...defaultPlannerConfig(t),days:Array.from({length:7},(_,weekday) => ({weekday,startMinute:540,minutes:120}))}; }
function stored(input: SaveStudyPlannerInput, old?: StudyPlanner): StudyPlanner { return plannerSchema.parse({trackId:input.trackId,config:input.config,weeks:input.weeks,backlog:input.backlog,undo:input.undo,revision:(old?.revision??0)+1,createdAt:old?.createdAt??clock.iso,updatedAt:clock.iso}); }
function seed() { const t=track(), c=config(t); const preview=buildPreview(t,undefined,c,clock.date,clock); const p=stored(acceptPreview(t.id,undefined,c,preview)); return {t,c,p}; }
const allIds = (p: StudyPlanner) => [...p.weeks.flatMap(w=>w.blocks),...p.backlog].map(b=>b.id);

describe('planner semanal e replanejamento determinísticos',()=>{
  it('gera mesma proposta, respeita janelas, pausas e orçamento e reserva simulado',()=>{
    const t=track(),c=config(t); const a=buildPreview(t,undefined,c,clock.date,clock);
    expect(buildPreview(t,undefined,c,clock.date,clock)).toEqual(a);
    expect(a.canAccept).toBe(true); expect(a.week.blocks.some(b=>b.kind==='mock')).toBe(true);
    expect(a.week.blocks.reduce((s,b)=>s+b.minutes+b.breakMinutes,0)).toBeLessThanOrEqual(t.config.weeklyMinutes);
    expect(savePlannerSchema.safeParse(acceptPreview(t.id,undefined,c,a)).success).toBe(true);
    expect(a.backlog.length).toBeGreaterThan(0);
  });
  it('não agenda passado, respeita dias livres e informa janelas insuficientes',()=>{
    const t=track(),c=config(t); c.days=[{weekday:0,startMinute:540,minutes:60},{weekday:2,startMinute:600,minutes:60}];
    const p=buildPreview(t,undefined,c,clock.date,{...clock,minute:580});
    expect(p.week.blocks.every(b=>b.date==='2026-10-21'||(b.date===clock.date&&b.startMinute>=580))).toBe(true);
    expect(p.unallocatedMinutes).toBeGreaterThan(0); expect(p.warnings.join(' ')).toContain('sem horário');
    expect(buildPreview(t,undefined,c,'2026-10-12',clock).week.blocks).toEqual([]);
  });
  it('pré-requisitos são planejados antes dos dependentes; série não concede domínio',()=>{
    const t=track();t.config.weeklyMinutes=1800;t.config.startingYear='concluido'; const c=config(t);
    const a=buildPreview(t,undefined,c,clock.date,clock);
    for(const unit of t.catalog.units){
      const dependent=a.week.blocks.filter(b=>b.unitId===unit.id&&b.kind==='learn');
      for(const prerequisite of unit.prerequisites){
        const bases=a.week.blocks.filter(b=>b.unitId===prerequisite&&b.kind==='learn');
        if(dependent.length){expect(bases.reduce((s,b)=>s+b.minutes,0)).toBeGreaterThanOrEqual(50);
          const last=bases.at(-1)!; const first=dependent[0];
          expect(`${first.date}:${String(first.startMinute).padStart(4,'0')}` >= `${last.date}:${String(last.startMinute+last.minutes+last.breakMinutes).padStart(4,'0')}`).toBe(true);
        }
      }
    }
    const earlier=structuredClone(t);earlier.config.startingYear='fundamental';expect(buildPreview(earlier,undefined,c,clock.date,clock)).toEqual(a);
  });
  it('aceitar duas vezes não duplica blocos; cancelar não muda a agenda',()=>{
    const {t,c,p}=seed(); const before=structuredClone(p);
    const preview=buildPreview(t,p,c,clock.date,clock); expect(p).toEqual(before);
    const a=stored(acceptPreview(t.id,p,c,preview),p);
    const twice=stored(acceptPreview(t.id,a,c,preview),a);
    expect(twice.weeks).toEqual(a.weeks);expect(allIds(twice).length).toBe(new Set(allIds(twice)).size);
  });
  it('concluídos e fixos são preservados; conflito de janela impede aceite',()=>{
    const {t,c,p}=seed();const complete=stored(completeBlock(p,p.weeks[0].blocks[0].id,clock.iso),p);
    const fixed=stored(toggleFixed(complete,complete.weeks[0].blocks[1].id),complete);
    const reduced={...c,days:[{weekday:1,startMinute:540,minutes:60}]};
    const blocked=buildPreview(t,fixed,reduced,clock.date,clock);expect(blocked.canAccept).toBe(false);
    expect(()=>acceptPreview(t.id,fixed,reduced,blocked)).toThrow('conflitos');
    const unlocked=stored(toggleFixed(fixed,fixed.weeks[0].blocks[1].id),fixed);
    const preview=buildPreview(t,unlocked,reduced,clock.date,clock);expect(preview.canAccept).toBe(true);
    const next=stored(acceptPreview(t.id,unlocked,reduced,preview),unlocked);
    expect(()=>validatePlannerTransition(unlocked,next)).not.toThrow();
    expect(next.weeks[0].blocks.find(b=>b.status==='completed')).toEqual(complete.weeks[0].blocks[0]);
    expect(next.backlog.length).toBeGreaterThan(0);
  });
  it('reagendar move IDs existentes, deixa sobras sem horário e desfaz sem apagar história',()=>{
    const {t,c,p}=seed();const later={...clock,date:'2026-10-26',iso:'2026-10-26T11:00:00.000Z'};
    const reduced={...c,days:[{weekday:0,startMinute:540,minutes:60}]};
    const preview=buildPreview(t,p,reduced,later.date,later);expect(preview.movedCount).toBeGreaterThan(0);
    const next=stored(acceptPreview(t.id,p,reduced,preview),p);
    expect(new Set(allIds(next)).size).toBe(allIds(next).length);
    expect(allIds(p).every(id=>allIds(next).includes(id))).toBe(true);
    const undone=stored(undoPreview(next),next);expect(undone.weeks).toEqual(p.weeks);expect(undone.backlog).toEqual(p.backlog);
    const finished=stored(completeBlock(next,next.weeks.find(w=>w.weekStart===later.date)!.blocks[0].id,later.iso),next);
    expect(finished.undo).toBeNull();expect(()=>undoPreview(finished)).toThrow();
  });
  it('conta capacidade parcial até a prova e informa prazo impossível',()=>{
    const t=track();t.config.weeklyMinutes=600;t.config.examDate=clock.date;
    const c={...config(t),days:[{weekday:0,startMinute:540,minutes:600}]};
    expect(buildPreview(t,undefined,c,clock.date,clock).warnings.join(' ')).not.toContain('Até a data da prova');
    t.config.examDate='2026-10-18';expect(buildPreview(t,undefined,c,clock.date,clock).warnings.join(' ')).toContain('Até a data da prova');
  });
  it('revisa a partir da conclusão real no dia local, sem antecipar o intervalo',()=>{
    const {t,c,p}=seed();t.config.reviewEveryDays=3;p.undo=null;
    const root=t.catalog.units[0].id;
    for(const block of p.weeks[0].blocks)if(block.kind==='learn'&&block.unitId===root){block.status='completed';block.completedAt='2026-10-23T02:30:00.000Z';}
    const preview=buildPreview(t,p,c,clock.date,{date:'2026-10-23',minute:480,iso:'2026-10-23T11:00:00.000Z'});
    const review=preview.week.blocks.find(block=>block.kind==='review'&&block.unitId===root);
    expect(review?.date).toBe('2026-10-25');
  });
  it('simulado atrasado reinicia a frequência na data da conclusão, não do horário antigo',()=>{
    const {t,c,p}=seed();t.config.mockEveryWeeks=1;p.undo=null;
    const mock=p.weeks[0].blocks.find(block=>block.kind==='mock')!;
    mock.status='completed';mock.completedAt='2026-10-25T12:00:00.000Z';
    const preview=buildPreview(t,p,c,'2026-10-26',{date:'2026-10-26',minute:480,iso:'2026-10-26T11:00:00.000Z'});
    expect(preview.week.blocks.find(block=>block.kind==='mock')?.date).toBe('2026-11-01');
  });
  it('não perde alterações só no backlog quando os blocos da semana continuam iguais',()=>{
    const {t,c,p}=seed();const fixed=structuredClone(p);for(const b of fixed.weeks[0].blocks)b.fixed=true;fixed.undo=null;
    const changed=structuredClone(t);changed.config.subjectIds=['matematica'];changed.config.difficulties=changed.config.difficulties.filter(d=>d.subjectId==='matematica');
    const a=buildPreview(t,fixed,c,clock.date,clock),b=buildPreview(changed,fixed,c,clock.date,clock);
    if(JSON.stringify(a.backlog)!==JSON.stringify(b.backlog))expect(a.week.planId).not.toBe(b.week.planId);
  });
  it('rejeita semanas/dias inválidos, IDs repetidos e registros completos sem data',()=>{
    expect(weekStartFor('2026-10-25')).toBe('2026-10-19');const {t,c,p}=seed();
    expect(()=>buildPreview(t,undefined,c,'2026-10-20',clock)).toThrow();
    expect(()=>buildPreview(t,undefined,{...c,days:[c.days[0],c.days[0]]},clock.date,clock)).toThrow();
    const bad=structuredClone(p);bad.backlog.push(structuredClone(bad.weeks[0].blocks[0]));expect(plannerSchema.safeParse(bad).success).toBe(false);
    const missing=structuredClone(p);missing.weeks[0].blocks[0].status='completed';expect(plannerSchema.safeParse(missing).success).toBe(false);
  });
});

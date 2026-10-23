import { createRequire } from 'node:module';
import initSqlJs from 'sql.js';
import { afterEach, describe, expect, it } from 'vitest';
import { DEMO_CATALOG, defaultConfig } from '../../domain/study/demo';
import { acceptPreview, buildPreview, completeBlock, defaultPlannerConfig, undoPreview } from '../../domain/planner/engine';
import type { SaveStudyPlannerInput, StudyPlanner } from '../../domain/planner/types';
import type { StorageService } from '../../shared/types';
import { readBackupArchive, createBackupArchive } from '../backup-archive';
import { readBackupFile } from '../backup-files';
import { MemoryPersistence } from './persistence';
import { createSQLiteStorage } from './sqlite';

const require = createRequire(import.meta.url);
const sql = initSqlJs({ locateFile: () => require.resolve('sql.js/dist/sql-wasm.wasm') });
const time = '2026-10-19T08:00:00.000Z';
const clock = { date:'2026-10-19', minute:480, iso:time };
const stores: StorageService[] = [];
async function open(persistence = new MemoryPersistence()) {
  const store = await createSQLiteStorage({ persistence, initializeSqlite:() => sql, now:() => time });
  stores.push(store); return store;
}
const edit = (planner: StudyPlanner): SaveStudyPlannerInput => ({ trackId:planner.trackId, expectedRevision:planner.revision, config:planner.config, weeks:planner.weeks, backlog:planner.backlog, undo:planner.undo });
async function seed(store: StorageService) {
  const track = await store.saveStudyTrack({ catalog:DEMO_CATALOG, config:defaultConfig(), diagnostics:[] });
  const config = defaultPlannerConfig(track);
  config.days = Array.from({length:7},(_,weekday) => ({weekday,startMinute:540,minutes:120}));
  const preview = buildPreview(track,undefined,config,clock.date,clock);
  expect(preview.canAccept).toBe(true); expect(preview.week.blocks.length).toBeGreaterThan(1);
  const planner = await store.saveStudyPlanner(acceptPreview(track.id,undefined,config,preview));
  return { track, planner };
}
afterEach(async () => { await Promise.all(stores.splice(0).map(store => store.close())); });

describe('agenda local persistida', () => {
  it('prévia não escreve; aceite, conclusão e undo sobrevivem a reinício e backup v5', async () => {
    const persistence = new MemoryPersistence(); const store = await open(persistence);
    const {planner} = await seed(store);
    const expected = await store.getSnapshot();
    const raw = (await persistence.load())!;
    const track = expected.studyTracks![0];
    buildPreview(track,planner,planner.config,'2026-10-26',clock);
    expect(await persistence.load()).toEqual(raw);
    expect(await (await open(new MemoryPersistence(raw))).getSnapshot()).toEqual(expected);
    const file = new File([await store.exportBackupArchive()],'qualquer-nome');
    const archive = await readBackupFile(file) as Awaited<ReturnType<typeof readBackupArchive>>;
    expect(archive.manifest.version).toBe(5);
    await expect(createBackupArchive({...archive.manifest,version:4},archive.readMaterial)).rejects.toThrow('v5');
    await expect(store.exportBackup()).rejects.toThrow('.studyspace');
    const destination = await open(); await destination.restoreBackupArchive(archive);
    expect(await destination.getSnapshot()).toEqual(expected);
    const reverted = await destination.saveStudyPlanner(undoPreview(planner));
    expect(reverted.weeks).toEqual([]);
    const completed = await store.saveStudyPlanner(completeBlock(planner,planner.weeks[0].blocks[0].id,time));
    expect(completed.undo).toBeNull();
    expect(await (await open(new MemoryPersistence(await persistence.load()))).getSnapshot()).toEqual(await store.getSnapshot());
  });

  it('impede concorrência, apagar concluídos e publicar gravação com falha', async () => {
    const persistence = new MemoryPersistence(); const first = await open(persistence); const second = await open(persistence);
    const {planner} = await seed(first);
    const completed = await first.saveStudyPlanner(completeBlock(planner,planner.weeks[0].blocks[0].id,time));
    await expect(second.saveStudyPlanner(edit(planner))).rejects.toThrow('outra janela');
    const invalid = edit(completed); invalid.weeks=structuredClone(completed.weeks); invalid.weeks[0].blocks.shift(); invalid.undo=null;
    await expect(first.saveStudyPlanner(invalid)).rejects.toThrow();
    const before = (await persistence.load())!;
    persistence.failNextSave=true;
    await expect(first.saveStudyPlanner(edit(completed))).rejects.toThrow();
    expect(await persistence.load()).toEqual(before);
    expect((await first.getSnapshot()).studyPlanners).toEqual([completed]);
  });

  it('recusa referências, excesso de orçamento e colisões sem alterar a agenda', async () => {
    const store = await open(); const {planner}=await seed(store); const expected=await store.getSnapshot();
    const missing = edit(planner); missing.trackId='ausente'; delete missing.expectedRevision;
    await expect(store.saveStudyPlanner(missing)).rejects.toThrow();
    const overlap = structuredClone(edit(planner)); overlap.weeks[0].blocks[1].date=overlap.weeks[0].blocks[0].date; overlap.weeks[0].blocks[1].startMinute=overlap.weeks[0].blocks[0].startMinute;
    await expect(store.saveStudyPlanner(overlap)).rejects.toThrow();
    const overBudget=structuredClone(edit(planner)); overBudget.weeks[0].budgetMinutes=30;
    await expect(store.saveStudyPlanner(overBudget)).rejects.toThrow();
    expect(await store.getSnapshot()).toEqual(expected);
  });

  it('migração 3→6 mantém cópia exata e trilhas se a publicação falhar', async () => {
    const persistence=new MemoryPersistence(); const store=await open(persistence);
    await store.saveStudyTrack({catalog:DEMO_CATALOG,config:defaultConfig(),diagnostics:[]});
    const expected=await store.getSnapshot(); const SQL=await sql;
    const db=new SQL.Database((await persistence.load())!); db.run('DROP TABLE error_entries; DROP TABLE review_schedules; DROP TABLE study_planners; PRAGMA user_version=3');
    const bytes=db.export(); db.close(); await persistence.save(bytes); persistence.failNextSave=true;
    await expect(open(persistence)).rejects.toThrow(); expect(await persistence.load()).toEqual(bytes);
    const copies=await persistence.listRecovery(); expect(copies).toHaveLength(1);
    expect(copies[0]).toMatchObject({schemaVersion:3,targetSchemaVersion:6});
    expect((await persistence.loadRecovery(copies[0].id))?.bytes).toEqual(bytes);
    expect(await (await open(persistence)).getSnapshot()).toEqual(expected);
    expect(await persistence.listRecovery()).toHaveLength(1);
  });
});

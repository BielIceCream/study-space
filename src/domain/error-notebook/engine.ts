import { z } from 'zod';
import type { Snapshot } from '../../shared/types';
import type { ErrorEntry, ErrorSource, SaveErrorEntryInput } from './types';

const text = (max: number, required = false) => z.string().max(max).refine(value => !value.includes('\0') && (!required || value.trim().length > 0), 'O texto está vazio ou contém um caractere inválido.');
const id = text(160, true);
const utc = z.string().refine(value => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString() === value, 'A data precisa ser válida em UTC.');
const sourceSchema = z.discriminatedUnion('kind', [
  z.object({ kind:z.literal('manual') }).strict(),
  z.object({ kind:z.literal('flashcard'), flashcardId:id, reviewLogId:id.nullable() }).strict(),
  z.object({ kind:z.literal('note'), noteId:id }).strict(),
  z.object({ kind:z.literal('diagnostic'), trackId:id, attemptId:id, questionId:id }).strict(),
]);
const fields = { subjectId:id, originLabel:text(180,true), question:text(2000,true), correction:text(5000), nextAction:text(2000), status:z.enum(['open','resolved']), source:sourceSchema };
export const saveErrorEntrySchema = z.object({ ...fields, id:id.optional(), expectedRevision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER - 1).optional(), practice:z.object({id,description:text(1000,true)}).strict().optional() }).strict().superRefine((value, context) => {
  if ((value.id === undefined) !== (value.expectedRevision === undefined)) context.addIssue({code:'custom',message:'Informe o registro e sua revisão juntos.'});
  if (value.status === 'resolved' && (!value.correction.trim() || !value.nextAction.trim())) context.addIssue({code:'custom',message:'Preencha a correção e a próxima ação antes de resolver o erro.'});
  if (!value.id && value.practice) context.addIssue({code:'custom',message:'Salve o registro antes de acrescentar uma prática.'});
});
export const errorEntrySchema = z.object({
  ...fields, id, revision:z.number().int().min(1).max(Number.MAX_SAFE_INTEGER),
  sourceSnapshot:z.object({title:text(300,true),prompt:text(20000),answer:text(20000)}).strict(),
  practices:z.array(z.object({id,description:text(1000,true),createdAt:utc}).strict()).max(200),
  createdAt:utc, updatedAt:utc, resolvedAt:utc.nullable(),
}).strict().superRefine((value, context) => {
  if (value.createdAt > value.updatedAt || (value.status === 'open') !== (value.resolvedAt === null) || (value.resolvedAt !== null && (value.resolvedAt < value.createdAt || value.resolvedAt > value.updatedAt)) || (value.status === 'resolved' && (!value.correction.trim() || !value.nextAction.trim()))) context.addIssue({code:'custom',message:'O estado ou as datas do registro são inconsistentes.'});
  const seen = new Set<string>(); let previous = value.createdAt;
  for (const practice of value.practices) {
    if (seen.has(practice.id) || practice.createdAt < previous || practice.createdAt > value.updatedAt) context.addIssue({code:'custom',message:'O histórico de práticas está inconsistente.'});
    seen.add(practice.id); previous = practice.createdAt;
  }
});
function parse<T>(schema:z.ZodType<T>, value:unknown):T {
  const result = schema.safeParse(value);
  if (!result.success) throw new Error(result.error.issues[0]?.message ?? 'O registro de erro é inválido.');
  return result.data;
}
function context(data:Snapshot) {
  return { subjects:new Map(data.subjects.map(item=>[item.id,item])), cards:new Map(data.flashcards.map(item=>[item.id,item])), notes:new Map(data.notes.map(item=>[item.id,item])), reviews:new Map(data.reviewLogs.map(item=>[item.id,item])), tracks:new Map((data.studyTracks??[]).map(item=>[item.id,item])) };
}
function capture(subjectId:string, source:ErrorSource, originLabel:string, question:string, index:ReturnType<typeof context>):ErrorEntry['sourceSnapshot'] {
  const subject = index.subjects.get(subjectId);
  if (!subject) throw new Error('A matéria do registro não existe.');
  if (source.kind === 'manual') return { title:originLabel,prompt:question,answer:'' };
  if (source.kind === 'flashcard') {
    const card = index.cards.get(source.flashcardId);
    if (!card || card.subjectId !== subjectId || (source.reviewLogId !== null && index.reviews.get(source.reviewLogId)?.flashcardId !== card.id)) throw new Error('O cartão ou a revisão não corresponde à matéria do registro.');
    return {title:`Flashcard · ${subject.name}`,prompt:card.front,answer:card.back};
  }
  if (source.kind === 'note') {
    const note = index.notes.get(source.noteId);
    if (!note || note.subjectId !== subjectId) throw new Error('A nota não corresponde à matéria do registro.');
    let prompt = note.plainText.slice(0,1000);
    if (/[\uD800-\uDBFF]$/.test(prompt)) prompt = prompt.slice(0,-1);
    return {title:note.title,prompt,answer:''};
  }
  const track = index.tracks.get(source.trackId);
  const attempt = track?.diagnostics.find(item=>item.id===source.attemptId);
  const answer = attempt?.answers.find(item=>item.questionId===source.questionId);
  const item = track?.catalog.questions.find(item=>item.id===source.questionId);
  if (!track || !attempt || !answer || !item || !attempt.questionIds.includes(item.id)) throw new Error('A tentativa ou a questão do diagnóstico não existe.');
  return {title:track.config.name,prompt:`${item.prompt}\n${item.choices.map((choice,i)=>`${i+1}. ${choice}`).join('\n')}`,answer:`Sua resposta: ${answer.choiceIndex === null ? 'Não sei ainda' : item.choices[answer.choiceIndex]}\nCorreção: ${item.choices[item.correctIndex]}\n${item.explanation}`};
}
export function validateErrorLinks(entries:ErrorEntry[], data:Snapshot):void {
  if (entries.length > 5000) throw new Error('O caderno aceita até 5.000 registros.');
  if (!entries.length) return;
  const index = context(data), ids = new Set<string>();
  for (const value of entries) {
    const entry = parse(errorEntrySchema,value);
    if (ids.has(entry.id)) throw new Error('Há registros duplicados no caderno de erros.');
    ids.add(entry.id); capture(entry.subjectId,entry.source,entry.originLabel,entry.question,index);
    // The captured text intentionally remains valid when the live source changes.
  }
}
export function buildErrorEntry(current:ErrorEntry|undefined, input:SaveErrorEntryInput, data:Snapshot, time:string, newId:string):ErrorEntry {
  const value = parse(saveErrorEntrySchema,input); parse(utc,time);
  if (current && value.practice) {
    const existing = current.practices.find(item=>item.id===value.practice!.id);
    if (existing) { if (existing.description !== value.practice.description) throw new Error('O identificador já pertence a outra prática.'); return current; }
  }
  if (current && current.revision !== value.expectedRevision) throw new Error('Este registro mudou em outra janela. Atualize os dados antes de salvar.');
  if (value.id && !current) throw new Error('O registro de erro não foi encontrado.');
  if (current && (current.subjectId !== value.subjectId || JSON.stringify(current.source) !== JSON.stringify(value.source))) throw new Error('A matéria e a fonte original não podem ser alteradas.');
  if (!current && (data.errorEntries?.length??0) >= 5000) throw new Error('O caderno aceita até 5.000 registros.');
  const updatedAt = current && time < current.updatedAt ? current.updatedAt : time;
  const { practice, expectedRevision: _expected, id: _id, ...editable } = value;
  const entry = parse(errorEntrySchema, {
    ...editable, id:current?.id??newId, revision:(current?.revision??0)+1,
    sourceSnapshot:current?.sourceSnapshot??capture(value.subjectId,value.source,value.originLabel,value.question,context(data)),
    practices:[...(current?.practices??[]),...(practice?[{...practice,createdAt:updatedAt}]:[])],
    createdAt:current?.createdAt??updatedAt,updatedAt,resolvedAt:value.status==='resolved'?(current?.resolvedAt??updatedAt):null,
  });
  validateErrorLinks([entry],data);
  return entry;
}

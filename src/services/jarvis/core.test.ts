import { beforeEach, describe, expect, it, vi } from 'vitest';
import { askJarvis, clearJarvisConversation, listJarvisModels, transcribeAudio } from './client';
import { buildStudyContext } from './context';
import { validateJarvisActions } from './tools';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => mocks);
const snapshot = {
  subjects: [{ id: 'subject-1', name: 'Física' }, { id: 'subject-2', name: 'História' }],
  notes: [{ id: 'note-1', subjectId: 'subject-1', title: 'Newton', plainText: 'CONTEÚDO PRIVADO DA NOTA' }],
  documents: [{ id: 'doc-1', subjectId: 'subject-1', fileName: 'Newton.pdf', pages: [{ text: 'não deve ir sozinho' }] }, { id: 'doc-2', subjectId: 'subject-2', fileName: 'História.pdf', pages: [] }],
};
const card = { id: 'card-1', subjectId: 'subject-1', front: 'Pergunta real', back: 'Resposta real' };
const excerpt = { documentId: 'doc-1', title: 'Título fornecido pelo modelo', page: 1, text: 'Primeira lei de Newton.' };
const context = (shareContent = false) => buildStudyContext(snapshot, { subjectId: 'subject-1', noteId: 'note-1', activeCard: card, selectedExcerpts: [excerpt], shareContent });
const success = { text: 'Resposta real', conversationId: 'conversation-1', references: [], actions: [], status: 'success' };

describe('contexto e ações JARVIS', () => {
  it('só inclui texto após consentimento e não lê todos os documentos', () => {
    const privateContext = context();
    expect(privateContext.activeNote?.excerpt).toBeUndefined();
    expect(privateContext.activeCard?.front).toBeUndefined();
    expect(privateContext.excerpts).toEqual([]);
    expect(privateContext.documents.map(document => document.id)).toEqual(['doc-1']);
    expect(JSON.stringify(privateContext)).not.toContain('não deve ir sozinho');
    expect(context(true).excerpts).toEqual([{ ...excerpt, title: 'Newton.pdf' }]);
  });
  it('limita trechos e rejeita páginas e documentos fora da seleção', () => {
    const result = buildStudyContext(snapshot, { subjectId: 'subject-1', shareContent: true, selectedExcerpts: [excerpt, { ...excerpt, page: 2 }, { ...excerpt, documentId: 'missing' }, { ...excerpt, text: 'x'.repeat(10_000) }] });
    expect(result.excerpts).toHaveLength(2);
    expect(result.excerpts[1].text).toHaveLength(3_000);
  });
  it('aceita apenas ferramentas e IDs permitidos', () => {
    const values = [
      { name: 'shell', args: { command: 'anything' } },
      { name: 'open_flashcards', args: { subjectId: 'invented' } },
      { name: 'open_flashcards', args: { subjectId: 'subject-1', destructive: true } },
      { name: 'start_review', args: {} },
      { name: 'study_feedback', args: { cardId: 'invented', answer: 'Minha resposta' } },
      { name: 'read_active_card', args: {} },
    ];
    expect(validateJarvisActions(values, context())).toEqual([{ name: 'start_review', args: {} }]);
    expect(validateJarvisActions(values, context(true))).toEqual([{ name: 'start_review', args: {} }, { name: 'read_active_card', args: {} }]);
  });
  it('gera apenas propostas limitadas para a matéria ativa com fontes autorizadas', () => {
    const proposal = { name: 'propose_flashcards', args: { subjectId: 'subject-1', cards: [{ front: ' Pergunta real ', back: ' Resposta real ' }, { front: 'Pergunta real', back: 'Resposta real' }] } };
    expect(validateJarvisActions([proposal], context(true))).toEqual([{ name: 'propose_flashcards', args: { subjectId: 'subject-1', cards: [{ front: 'Pergunta real', back: 'Resposta real' }] } }]);
    expect(validateJarvisActions([proposal], context())).toEqual([]);
    const noSources = { ...context(true), activeNote: undefined, excerpts: [] };
    expect(validateJarvisActions([proposal], noSources)).toEqual([]);
    expect(validateJarvisActions([proposal], { ...context(true), activeSubject: undefined })).toEqual([]);
    for (const args of [
      { subjectId: 'invented', cards: proposal.args.cards },
      { subjectId: 'subject-2', cards: proposal.args.cards },
      { subjectId: 'subject-1', cards: [] },
      { subjectId: 'subject-1', cards: Array.from({ length: 21 }, () => ({ front: 'Pergunta', back: 'Resposta' })) },
      { subjectId: 'subject-1', cards: [{ front: '   ', back: 'Resposta' }] },
      { subjectId: 'subject-1', cards: [{ front: 'x'.repeat(20_001), back: 'Resposta' }] },
      { subjectId: 'subject-1', cards: [{ front: 'Pergunta', back: 'Resposta', destructive: true }] },
      { subjectId: 'subject-1', cards: proposal.args.cards, write: true },
    ]) expect(validateJarvisActions([{ name: 'propose_flashcards', args }], context(true))).toEqual([]);
  });
});

describe('cliente JARVIS nativo', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.isTauri.mockReturnValue(true); clearJarvisConversation(); });
  it('funciona sem credencial ou rede sem resposta fingida', async () => {
    mocks.isTauri.mockReturnValue(false);
    expect((await askJarvis('Oi', context())).status).toBe('offline');
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.isTauri.mockReturnValue(true); mocks.invoke.mockResolvedValue(false);
    expect((await askJarvis('Oi', context())).status).toBe('not_configured');
    expect(mocks.invoke.mock.calls).toEqual([['jarvis_has_api_key']]);
  });
  it('remove ações e referências fabricadas e mantém histórico somente no mesmo contexto autorizado', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'jarvis_has_api_key' ? true : { ...success, actions: [{ name: 'shell', args: {} }, { name: 'start_review', args: {} }], references: [{ documentId: 'invented', page: 12, excerpt: 'fabricado' }] }));
    const first = await askJarvis('Explique', context(true), 'conversation-1', { model: 'models/live-example' });
    expect(first.actions).toEqual([{ name: 'start_review', args: {} }]); expect(first.references).toEqual([]);
    await askJarvis('Continue', context(true), 'conversation-1', { model: 'models/live-example' });
    const secondPayload = mocks.invoke.mock.calls.filter(call => call[0] === 'jarvis_chat')[1][1].input;
    expect(secondPayload.history).toHaveLength(2);
    await askJarvis('Agora sem notas', context(), 'conversation-1', { model: 'models/live-example' });
    const thirdPayload = mocks.invoke.mock.calls.filter(call => call[0] === 'jarvis_chat')[2][1].input;
    expect(thirdPayload.history).toEqual([]);
    expect(JSON.stringify(thirdPayload)).not.toContain('CONTEÚDO PRIVADO');
  });
  it('cancela a operação nativa e ignora sua conclusão tardia', async () => {
    let finish!: (value: unknown) => void;
    mocks.invoke.mockImplementation((command: string) => command === 'jarvis_list_models' ? new Promise(resolve => { finish = resolve; }) : Promise.resolve());
    const controller = new AbortController();
    const pending = listJarvisModels(controller.signal);
    controller.abort();
    await expect(pending).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.invoke.mock.calls.some(call => call[0] === 'jarvis_cancel_request')).toBe(true);
    finish([]);
  });
  it('preserva perguntas e respostas gerais nos follow-ups sem compartilhar materiais', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'jarvis_has_api_key' ? true : { ...success, text: 'Explicação geral da primeira lei de Newton.' }));
    await askJarvis('O que é a primeira lei de Newton?', context(), 'general-session', { model: 'models/live-example' });
    await askJarvis('Dê outro exemplo', context(), 'general-session', { model: 'models/live-example' });
    const payload = mocks.invoke.mock.calls.filter(call => call[0] === 'jarvis_chat')[1][1].input;
    expect(payload.history).toEqual([
      { role: 'user', text: 'O que é a primeira lei de Newton?' },
      { role: 'model', text: 'Explicação geral da primeira lei de Newton.' },
    ]);
    expect(payload.context.contentShared).toBe(false);
    expect(payload.context.excerpts).toEqual([]);
    expect(JSON.stringify(payload)).not.toContain('CONTEÚDO PRIVADO');
  });
  it('limita áudio e envia formato real para o backend sem chave no payload', async () => {
    const input = { audioBase64: 'AQID', mimeType: 'audio/webm;codecs=opus', durationMs: 1000, model: 'models/live-example' };
    await expect(transcribeAudio({ ...input, durationMs: 30_001 })).rejects.toThrow('30 segundos');
    expect(mocks.invoke).not.toHaveBeenCalled();
    mocks.invoke.mockResolvedValue('Abra meus flashcards');
    expect(await transcribeAudio(input)).toBe('Abra meus flashcards');
    expect(mocks.invoke.mock.calls[0][1].input).toMatchObject({ mimeType: 'audio/webm', language: 'pt-BR', durationMs: 1000 });
    expect(mocks.invoke.mock.calls[0][1].input).not.toHaveProperty('apiKey');
  });
});

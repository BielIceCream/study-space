import { useEffect, useRef, useState } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { localConfiguration, type LocalProvider } from '../../services/jarvis/local';
import { Mic, Send, Settings, Square, Volume2, X } from 'lucide-react';
import type { Flashcard, Snapshot } from '../../shared/types';
import type { JarvisAction, JarvisExcerpt, JarvisModel, JarvisReference } from '../../services/jarvis/types';
import { askJarvis, clearJarvisConversation, listJarvisModels, testJarvisConnection } from '../../services/jarvis/client';
import { buildStudyContext } from '../../services/jarvis/context';
import { jarvisDesktopCredentials } from '../../services/jarvis/desktop-credentials';
import { JarvisVoiceController } from '../../services/jarvis/voice';
import type { JarvisVoiceSnapshot } from '../../services/jarvis/voice-types';
import { messageFrom } from '../../shared/utils';
import './jarvis.css';

export interface JarvisStudyRequest { id: string; excerpts: JarvisExcerpt[]; intent?: string }
interface Turn { id: string; role: 'user' | 'assistant'; text: string; references?: JarvisReference[] }
interface ModelCatalogEntry { status: 'loading' | 'ready' | 'error'; models: JarvisModel[]; error?: string; loadedAt?: number }
const preference = (key: string) => { try { return localStorage.getItem(`studyspace.jarvis.${key}`) ?? ''; } catch { return ''; } };
const savePreference = (key: string, value: string) => { try { localStorage.setItem(`studyspace.jarvis.${key}`, value); } catch { /* Preferences are optional. */ } };
const modelCount = (count: number) => `${count} ${count === 1 ? 'modelo' : 'modelos'}`;
export function JarvisPanel({ snapshot, subjectId, noteId, activeCard, studyRequest, onAction }: { snapshot: Snapshot; subjectId?: string; noteId?: string; activeCard?: Flashcard | null; studyRequest?: JarvisStudyRequest; onAction: (action: JarvisAction) => Promise<string | void> }) {
  const native = isTauri();
  const [open, setOpen] = useState(false);
  const [settings, setSettings] = useState(false);
  const [key, setKey] = useState('');
  const [configured, setConfigured] = useState(false);
  const [provider, setProvider] = useState(() => preference('provider') || 'gemini');
  const [providers, setProviders] = useState<LocalProvider[]>([]);
  const [toolsEnabled, setToolsEnabled] = useState(true);
  const [transcriptionSetting, setTranscriptionSetting] = useState('auto');
  const [model, setModel] = useState(() => preference('model'));
  const [modelCatalog, setModelCatalog] = useState<Record<string, ModelCatalogEntry>>({});
  const [input, setInput] = useState('');
  const [share, setShare] = useState(false);
  const [sharedScope, setSharedScope] = useState('');
  const [selection, setSelection] = useState<{ scope: string; excerpts: JarvisExcerpt[] } | null>(null);
  const [turns, setTurns] = useState<Turn[]>([]);
  const [busy, setBusy] = useState(false);
  const [configBusy, setConfigBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [voice, setVoice] = useState<JarvisVoiceSnapshot | null>(null);
  const controller = useRef<JarvisVoiceController | null>(null);
  const abort = useRef<AbortController | null>(null);
  const configAbort = useRef<AbortController | null>(null);
  const seenStudyRequest = useRef<string | undefined>(undefined);
  const conversation = useRef(crypto.randomUUID());
  const history = useRef<HTMLDivElement>(null);
  const operation = useRef(0);
  const sending = useRef(false);
  const catalogRef = useRef<Record<string, ModelCatalogEntry>>({});
  const modelJobs = useRef(new Map<string, Promise<JarvisModel[]>>());
  const modelVersions = useRef<Record<string, number>>({});
  const catalogAbort = useRef<AbortController | null>(null);
  const modelJobSignals = useRef(new Map<string, AbortSignal | undefined>());
  const editedModels = useRef(new Set<string>());
  const contextScope = JSON.stringify([provider, subjectId, noteId, activeCard?.id]);
  const selectedProvider = providers.find(item => item.id === provider);
  const catalogKey = native ? 'gemini' : provider;
  const catalogEntry = modelCatalog[catalogKey];
  const models = catalogEntry?.models ?? [];
  const modelsLoading = catalogEntry?.status === 'loading';
  const nativeConfigured = native && configured;
  const transcriptionProvider = transcriptionSetting === 'auto'
    ? (['gemini', 'groq', 'openai'].includes(provider) && selectedProvider?.configured ? provider : ['groq', 'openai', 'gemini'].find(id => providers.find(item => item.id === id)?.configured) || 'none')
    : transcriptionSetting;
  const transcriptionLabel = native ? 'Gemini' : providers.find(item => item.id === transcriptionProvider)?.name ?? 'não configurada';
  const previousScope = useRef(contextScope);
  const selectedExcerpts = selection?.scope === contextScope ? selection.excerpts : [];
  const contentShared = share && sharedScope === contextScope;
  useEffect(() => {
    if (!open || controller.current) return;
    const instance = new JarvisVoiceController(); controller.current = instance;
    let active = true;
    const unsubscribe = instance.subscribe(setVoice);
    void instance.initialize().then(() => {
      if (preference('voice')) instance.setVoice(preference('voice'));
      if (preference('volume')) instance.setVolume(Number(preference('volume')));
      instance.setMuted(preference('muted') === 'true');
    });
    if (native) void jarvisDesktopCredentials.isConfigured().then(value => { if (active) setConfigured(value); }).catch(cause => { if (active) setNotice(messageFrom(cause)); });
    if (!native) void localConfiguration().then(config => {
      if (!active) return;
      const choices = config.providers ?? [];
      setProviders(choices);
      const id = choices.some(item => item.id === preference('provider')) ? preference('provider') : config.provider || 'gemini';
      const chosen = choices.find(item => item.id === id);
      setProvider(id); setConfigured(chosen?.configured ?? config.configured); setToolsEnabled(chosen?.tools ?? true);
      setTranscriptionSetting(config.transcriptionSetting || 'auto');
      const raw = preference(`model.${id}`) || chosen?.model || (id === 'gemini' ? config.model || preference('model') : '');
      const next = id === 'gemini' && raw && !raw.startsWith('models/') ? `models/${raw}` : raw;
      setModel(next);
    }).catch(() => undefined);
    return () => { active = false; unsubscribe(); instance.dispose(); controller.current = null; };
  }, [open]);
  useEffect(() => {
    if (!open) return;
    const request = new AbortController();
    catalogAbort.current = request;
    setModelCatalog({ ...catalogRef.current });
    const ids = native ? (nativeConfigured ? ['gemini'] : []) : providers.filter(item => item.configured).map(item => item.id);
    const ordered = [...new Set([catalogKey, ...ids])].filter(id => ids.includes(id));
    let cursor = 0;
    const worker = async () => {
      while (!request.signal.aborted && cursor < ordered.length) {
        const id = ordered[cursor++];
        try { await fetchProviderModels(id, request.signal); } catch { /* Each provider has its own visible state. */ }
      }
    };
    void worker(); void worker();
    return () => {
      request.abort();
      if (catalogAbort.current === request) catalogAbort.current = null;
      for (const [id, entry] of Object.entries(catalogRef.current)) if (entry.status === 'loading' && modelJobSignals.current.get(id) === request.signal) {
        delete catalogRef.current[id]; modelJobs.current.delete(id); modelJobSignals.current.delete(id); modelVersions.current[id] = (modelVersions.current[id] ?? 0) + 1;
      }
    };
  }, [open, providers, native, nativeConfigured]);
  useEffect(() => {
    if (!open || !configured || catalogRef.current[catalogKey] || modelJobs.current.size >= 3 || !catalogAbort.current) return;
    void fetchProviderModels(catalogKey, catalogAbort.current.signal).catch(() => undefined);
  }, [open, configured, catalogKey, modelCatalog]);
  useEffect(() => {
    if (!open || model || editedModels.current.has(catalogKey) || catalogEntry?.status !== 'ready' || !catalogEntry.models.length) return;
    const next = catalogEntry.models[0].id;
    setModel(next); savePreference(native ? 'model' : `model.${provider}`, next);
  }, [open, model, catalogKey, catalogEntry, native, provider]);
  useEffect(() => {
    setShare(false);
    if (studyRequest && studyRequest.id !== seenStudyRequest.current) {
      seenStudyRequest.current = studyRequest.id;
      setSelection({ scope: contextScope, excerpts: studyRequest.excerpts });
      setOpen(true);
      setInput(studyRequest.intent === 'Conversar' ? '' : `${studyRequest.intent ?? 'Explique'} o trecho selecionado.`);
    } else if (previousScope.current !== contextScope || !studyRequest) {
      setSelection(null);
    }
    previousScope.current = contextScope;
  }, [studyRequest?.id, contextScope]);
  useEffect(() => { history.current?.scrollTo({ top: history.current.scrollHeight }); }, [turns, busy]);
  useEffect(() => () => { abort.current?.abort(); configAbort.current?.abort(); controller.current?.dispose(); clearJarvisConversation(conversation.current); }, []);
  function cancel() { operation.current += 1; abort.current?.abort(); controller.current?.cancel(); setBusy(false); sending.current = false; }
  function close() { cancel(); configAbort.current?.abort(); setConfigBusy(false); setKey(''); setShare(false); setSelection(null); setOpen(false); }
  async function send(message = input) {
    if (!message.trim() || sending.current) return;
    sending.current = true; setBusy(true); setError(''); setInput(''); controller.current?.cancel();
    const serial = ++operation.current;
    const request = new AbortController(); abort.current = request;
    setTurns(previous => [...previous.slice(-19), { id: crypto.randomUUID(), role: 'user', text: message }]);
    try {
      const context = buildStudyContext(snapshot, { subjectId, noteId, activeCard: activeCard ?? undefined, selectedExcerpts, page: selectedExcerpts[0]?.page, shareContent: contentShared });
      const result = await askJarvis(message, context, conversation.current, { model, provider: native ? undefined : provider, tools: toolsEnabled, signal: request.signal });
      if (serial !== operation.current) return;
      let answer = result.text;
      for (const action of result.actions) {
        if (request.signal.aborted) break;
        try { const outcome = await onAction(action); if (outcome) answer += `\n\n${outcome}`; }
        catch (cause) { answer += `\n\nA ação não foi concluída: ${messageFrom(cause)}`; }
      }
      if (serial !== operation.current) return;
      setTurns(previous => [...previous.slice(-19), { id: crypto.randomUUID(), role: 'assistant', text: answer, references: result.references }]);
      if (result.status === 'not_configured') setSettings(true);
      setBusy(false); sending.current = false;
      if (result.status === 'success') void controller.current?.speak(answer).catch(() => undefined);
    } catch (cause) { if (!request.signal.aborted) setError(messageFrom(cause)); }
    finally { if (serial === operation.current) { setBusy(false); sending.current = false; } }
  }
  async function configure(task: (signal: AbortSignal) => Promise<void>) {
    configAbort.current?.abort();
    const request = new AbortController(); configAbort.current = request;
    setConfigBusy(true); setError(''); setNotice('');
    try { await task(request.signal); } catch (cause) { if (!request.signal.aborted) setError(messageFrom(cause)); } finally { if (!request.signal.aborted) setConfigBusy(false); }
  }
  function updateCatalog(id: string, entry: ModelCatalogEntry) {
    catalogRef.current[id] = entry; setModelCatalog({ ...catalogRef.current });
  }
  async function fetchProviderModels(id: string, signal?: AbortSignal, force = false): Promise<JarvisModel[]> {
    const cached = catalogRef.current[id];
    if (!force && cached?.status === 'ready' && Date.now() - (cached.loadedAt ?? 0) < 10 * 60_000) return cached.models;
    const pending = modelJobs.current.get(id);
    if (pending) return pending;
    const version = (modelVersions.current[id] ?? 0) + 1; modelVersions.current[id] = version;
    modelJobSignals.current.set(id, signal);
    updateCatalog(id, { status: 'loading', models: cached?.models ?? [] });
    const task = (async () => {
      try {
        const available = await listJarvisModels(signal, native ? undefined : id);
        if (!signal?.aborted && modelVersions.current[id] === version) updateCatalog(id, { status: 'ready', models: available, loadedAt: Date.now() });
        return available;
      } catch (cause) {
        if (!signal?.aborted && modelVersions.current[id] === version) updateCatalog(id, { status: 'error', models: cached?.models ?? [], error: messageFrom(cause) });
        throw cause;
      } finally { if (modelVersions.current[id] === version) { modelJobs.current.delete(id); modelJobSignals.current.delete(id); } }
    })();
    modelJobs.current.set(id, task);
    return task;
  }
  async function loadModels(signal?: AbortSignal, force = false): Promise<void> {
    await fetchProviderModels(catalogKey, signal, force);
  }
  function selectModel(value: string) {
    editedModels.current.add(catalogKey); setModel(value); savePreference(native ? 'model' : `model.${provider}`, value);
  }
  function changeProvider(id: string) {
    cancel(); configAbort.current?.abort(); setConfigBusy(false);
    clearJarvisConversation(conversation.current); conversation.current = crypto.randomUUID();
    setTurns([]); setShare(false); setError(''); setNotice('Nova conversa com o provedor selecionado.');
    const choice = providers.find(item => item.id === id);
    setProvider(id); savePreference('provider', id); setConfigured(choice?.configured ?? false); setToolsEnabled(choice?.tools ?? true);
    editedModels.current.delete(id);
    setModel(preference(`model.${id}`) || choice?.model || '');
  }
  async function listen() {
    if (!native && transcriptionProvider === 'none') { setSettings(true); setNotice('Para usar o microfone, configure a chave de Gemini, Groq ou OpenAI no arquivo config/.env.'); return; }
    if (!model) { setSettings(true); setNotice(modelsLoading ? 'Carregando os modelos. Aguarde e escolha uma opção para conversar.' : 'Escolha um modelo de conversa antes de usar o microfone.'); return; }
    try { const transcript = await controller.current?.startListening(model, native ? undefined : provider); if (transcript) await send(transcript); } catch { /* Voice snapshot presents the actionable error. */ }
  }
  if (!open) return <button data-mission-control="jarvis" className="button secondary jarvis-launch" onClick={() => setOpen(true)} aria-label="Abrir JARVIS"><Mic size={16} />JARVIS</button>;
  return <section data-mission-control="jarvis" className="jarvis-panel" aria-label="Assistente JARVIS"><div className="jarvis-heading"><strong>JARVIS</strong><button className="icon-button" aria-label="Configurar JARVIS" aria-expanded={settings} onClick={() => setSettings(value => !value)}><Settings size={17} /></button><button className="icon-button" aria-label="Fechar JARVIS" onClick={close}><X size={18} /></button></div>
    {settings ? <div className="jarvis-settings">{!native && <label>Provedor de IA<select className="input" aria-label="Provedor de IA" value={provider} disabled={busy || configBusy} onChange={event => changeProvider(event.target.value)}>{providers.map(item => <option key={item.id} value={item.id}>{item.name} · {modelCatalog[item.id]?.status === 'ready' ? modelCount(modelCatalog[item.id].models.length) : item.local ? 'local' : item.configured ? 'chave configurada' : 'chave pendente'}</option>)}</select></label>}<p className="jarvis-state">{native ? (configured ? 'Chave protegida pelo Windows.' : 'Configure sua chave Gemini no aplicativo Windows.') : (configured ? (selectedProvider?.local ? 'Servidor local selecionado; use Testar conexão para verificar.' : 'Chave do provedor carregada de config/.env pelo servidor local.') : `Preencha ${selectedProvider?.keyVariable ?? 'GEMINI_API_KEY'} em config/.env e reabra este painel.`)}</p>{native && <label>Chave Gemini<input className="input" type="password" autoComplete="off" value={key} onChange={event => setKey(event.target.value)} placeholder="Sua chave de API" /></label>}<div className="jarvis-settings-actions">{native && <><button className="button secondary" disabled={!key.trim() || configBusy} onClick={() => void configure(async signal => { const secret = key; setKey(''); await jarvisDesktopCredentials.save(secret); if (signal.aborted) return; setConfigured(true); await loadModels(signal, true); if (signal.aborted) return; setNotice('Chave salva com proteção do Windows.'); })}>Salvar chave</button><button className="text-button" disabled={configBusy || !configured} onClick={() => void configure(async signal => { await jarvisDesktopCredentials.clear(); if (signal.aborted) return; setConfigured(false); setKey(''); catalogRef.current = {}; setModelCatalog({}); setNotice('Chave removida.'); })}>Remover chave</button></>}<button className="text-button" disabled={configBusy || modelsLoading} onClick={() => void configure(signal => loadModels(signal, true))}>{modelsLoading ? 'Carregando modelos…' : 'Atualizar modelos'}</button></div><p className="jarvis-model-status" role="status">{modelsLoading ? 'Carregando as opções automaticamente…' : catalogEntry?.status === 'error' ? catalogEntry.error : models.length ? `${modelCount(models.length)} ${models.length === 1 ? 'disponível' : 'disponíveis'}. Escolha uma opção abaixo.` : configured ? 'Nenhum modelo disponível na lista. Você pode informar o ID manualmente.' : 'Adicione a chave deste provedor para carregar os modelos automaticamente.'}</p><label>Modelo<select className="input" aria-label="Modelo" value={model} onChange={event => selectModel(event.target.value)}><option value="">{modelsLoading ? 'Carregando modelos…' : 'Selecione um modelo'}</option>{model && !models.some(item => item.id === model) && <option value={model}>{model} (ID salvo)</option>}{models.map(item => <option key={item.id} value={item.id}>{item.displayName}</option>)}</select></label>{!native && <><details className="jarvis-model-manual"><summary>Informar ID do modelo manualmente</summary><label>ID do modelo (manual)<input className="input" aria-label="ID do modelo" value={model} maxLength={256} placeholder="ID fornecido pelo serviço" onChange={event => selectModel(event.target.value)} /></label></details><label><span><input type="checkbox" checked={toolsEnabled} disabled={!selectedProvider?.tools} onChange={event => setToolsEnabled(event.target.checked)} /> Usar ações JARVIS (modelo com ferramentas)</span></label><p className="jarvis-state">Microfone: transcrição por {transcriptionLabel}. A leitura em voz usa o Windows local.</p></>}<button className="button secondary" disabled={!model || configBusy} onClick={() => void configure(async signal => { const result = await testJarvisConnection(model, signal, native ? undefined : provider); if (signal.aborted) return; setNotice(result.message); })}>{configBusy && !modelsLoading ? 'Conectando…' : 'Testar conexão'}</button><label>Voz local<select className="input" value={voice?.voiceId ?? ''} onChange={event => { controller.current?.setVoice(event.target.value); savePreference('voice', event.target.value); }}><option value="">Selecione uma voz</option>{voice?.voices.filter(item => item.local).map(item => <option key={item.id} value={item.id}>{item.name} · {item.language}</option>)}</select></label><button className="button secondary" disabled={!voice?.voiceId || voice.status === 'speaking'} onClick={() => void controller.current?.speak('Olá! Esta é a voz local do StudySpace.').catch(() => undefined)}>Testar voz local</button><label>Volume<input type="range" min="0" max="1" step="0.05" value={voice?.volume ?? 0.8} onChange={event => { controller.current?.setVolume(Number(event.target.value)); savePreference('volume', event.target.value); }} /></label><label><span><input type="checkbox" checked={voice?.muted ?? false} onChange={event => { controller.current?.setMuted(event.target.checked); savePreference('muted', String(event.target.checked)); }} /> Silenciar respostas</span></label></div> : <><div className="jarvis-history" ref={history} role="log" aria-live="polite">{!turns.length && <p className="jarvis-state">Converse sobre seus estudos ou peça para abrir flashcards e iniciar uma revisão.</p>}{turns.map(turn => <div className={`jarvis-turn ${turn.role}`} key={turn.id}><small>{turn.role === 'user' ? 'Você' : 'JARVIS'}</small>{turn.text}{turn.references?.map((reference, i) => <small key={i}>Fonte: {reference.title} · página {reference.page}</small>)}{turn.role === 'assistant' && <button className="text-button" onClick={() => void controller.current?.speak(turn.text).catch(() => undefined)}><Volume2 size={14} />Ouvir resposta</button>}</div>)}{busy && <p className="jarvis-state" role="status">Consultando {native ? 'Gemini' : selectedProvider?.name ?? 'IA'}…</p>}</div><label className="jarvis-consent"><input type="checkbox" checked={contentShared} onChange={event => { setShare(event.target.checked); setSharedScope(contextScope); }} /> Compartilhar nesta conversa o conteúdo da nota/cartão ativo{selectedExcerpts.length ? ` e ${selectedExcerpts.length} trecho(s) selecionado(s)` : ''}.</label>{selectedExcerpts.length > 0 && <ul className="jarvis-sources" aria-label="Trechos que podem ser compartilhados">{selectedExcerpts.map((excerpt, index) => <li key={`${excerpt.documentId}-${excerpt.page}-${index}`}>{excerpt.title} - p. {excerpt.page} - {Math.min(excerpt.text.trim().length, 3000)} caracteres</li>)}</ul>}<form className="jarvis-compose" onSubmit={event => { event.preventDefault(); void send(); }}><textarea className="input" aria-label="Mensagem para JARVIS" placeholder="Escreva ou use o microfone…" maxLength={8000} value={input} onChange={event => setInput(event.target.value)} /><div className="jarvis-compose-actions"><button className="button secondary jarvis-mic" type="button" aria-label={voice?.status === 'listening' ? 'Parar gravação' : !native && transcriptionProvider === 'none' ? 'Configurar microfone' : 'Falar com JARVIS'} aria-pressed={voice?.status === 'listening'} title={!native && transcriptionProvider === 'none' ? 'Clique para configurar a transcrição do microfone' : `Clique para gravar. Transcrição por ${transcriptionLabel}.`} disabled={busy || voice?.status === 'transcribing'} onClick={() => voice?.status === 'listening' ? controller.current?.finishListening() : void listen()}>{voice?.status === 'listening' ? <Square size={18} /> : <Mic size={18} />}<span>{voice?.status === 'listening' ? 'Parar gravação' : voice?.status === 'transcribing' ? 'Transcrevendo…' : !native && transcriptionProvider === 'none' ? 'Configurar microfone' : 'Falar'}</span></button><button className="button primary" aria-label="Enviar mensagem" disabled={busy || !input.trim()}><Send size={18} /><span>Enviar</span></button></div></form><p className="jarvis-mic-help">{!native && transcriptionProvider === 'none' ? 'Clique em Configurar microfone para ativar a entrada por voz.' : `Clique em Falar para gravar até 30 segundos. O áudio será transcrito por ${transcriptionLabel}.`}</p></>}
    <div className="jarvis-voice"><span role="status">{voice?.status === 'listening' ? 'Ouvindo…' : voice?.status === 'transcribing' ? 'Transcrevendo…' : voice?.status === 'speaking' ? 'Falando…' : 'Voz sob seu controle'}</span>{voice?.status === 'listening' && <meter className="jarvis-level" value={voice.level} min={0} max={1} aria-label="Nível do microfone" />}{(busy || ['listening', 'transcribing', 'speaking'].includes(voice?.status ?? '')) && <button className="text-button" onClick={cancel}><Square size={13} />Interromper</button>}</div>{notice && <p className="jarvis-state" role="status">{notice}</p>}{(error || voice?.error) && <p className="form-error" role="alert">{error || voice?.error}</p>}
  </section>;
}

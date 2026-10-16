import { invoke, isTauri } from '@tauri-apps/api/core';
import { jarvisDesktopCredentials } from './desktop-credentials';
import { sanitizeStudyContext } from './context';
import { validateJarvisActions } from './tools';
import { isLocalRuntime, localRequest } from './local';
import type { JarvisConnectionResult, JarvisHistoryTurn, JarvisModel, JarvisRequestOptions, JarvisResponse, JarvisStudyContext, JarvisTranscriptionInput } from './types';

const histories = new Map<string, { scope: string; turns: JarvisHistoryTurn[] }>();
const MAX_CONVERSATIONS = 8;
const MAX_TURNS = 12;
const abortError = () => new DOMException('Solicitação cancelada.', 'AbortError');
const requireDesktop = () => { if (!isTauri()) throw new Error('O Gemini está disponível no aplicativo Windows. Seus estudos continuam disponíveis offline.'); };
const requestId = () => crypto.randomUUID();

/** Cancellation aborts the native HTTP future as well as the awaiting UI promise. */
async function nativeRequest<T>(command: string, input: Record<string, unknown>, signal?: AbortSignal, timeoutMs = 45_000): Promise<T> {
  if (!isTauri()) return localRequest<T>(command, input, signal);
  requireDesktop();
  if (signal?.aborted) throw abortError();
  const id = typeof input.requestId === 'string' ? input.requestId : requestId();
  const timeout = Math.max(1_000, Math.min(90_000, timeoutMs));
  let timer: ReturnType<typeof setTimeout> | undefined;
  let onAbort: (() => void) | undefined;
  const request = invoke<T>(command, { input: { ...input, requestId: id, timeoutMs: timeout } });
  const stop = () => { void invoke('jarvis_cancel_request', { requestId: id }).catch(() => undefined); };
  const interrupt = new Promise<never>((_, reject) => {
    onAbort = () => { stop(); reject(abortError()); };
    signal?.addEventListener('abort', onAbort, { once: true });
    timer = setTimeout(() => { stop(); reject(new Error('O Gemini demorou demais para responder. Tente novamente.')); }, timeout + 1_000);
  });
  try { return await Promise.race([request, interrupt]); }
  finally { if (timer) clearTimeout(timer); if (onAbort) signal?.removeEventListener('abort', onAbort); }
}

export async function listJarvisModels(signal?: AbortSignal, provider?: string): Promise<JarvisModel[]> {
  return nativeRequest('jarvis_list_models', isTauri() ? {} : { provider }, signal, 20_000);
}

export async function testJarvisConnection(model: string, signal?: AbortSignal, provider?: string): Promise<JarvisConnectionResult> {
  return nativeRequest('jarvis_test_connection', { model, ...(!isTauri() ? { provider } : {}) }, signal, 25_000);
}

export function clearJarvisConversation(conversationId?: string): void {
  if (conversationId) histories.delete(conversationId); else histories.clear();
}

export async function askJarvis(message: string, studyContext: JarvisStudyContext, conversationId: string = requestId(), options: JarvisRequestOptions = {}): Promise<JarvisResponse> {
  const response = (status: JarvisResponse['status'], text: string): JarvisResponse => ({ text, conversationId, references: [], actions: [], status });
  if (options.signal?.aborted) return response('cancelled', 'Solicitação cancelada.');
  if (!message.trim()) return response('error', 'Escreva uma mensagem para conversar com o JARVIS.');
  if (message.length > 8_000) return response('error', 'Sua mensagem está muito longa. Envie até 8.000 caracteres por vez.');
  if (!isTauri() && !isLocalRuntime()) return response('offline', 'Abra o StudySpace pelo iniciador local para configurar o Gemini. Seus materiais continuam disponíveis offline.');
  try {
    if (!await jarvisDesktopCredentials.isConfigured(options.provider)) return response('not_configured', isTauri() ? 'Configure sua chave do Gemini nas configurações do JARVIS.' : 'Adicione a chave do provedor escolhido em config/.env e reabra o painel JARVIS.');
    if (options.signal?.aborted) return response('cancelled', 'Solicitação cancelada.');
    if (!options.model) return response('not_configured', 'Busque os modelos disponíveis e selecione um nas configurações do JARVIS.');
    const context = sanitizeStudyContext(studyContext);
    const scope = JSON.stringify([options.provider ?? 'gemini', options.model, context]);
    const previous = histories.get(conversationId);
    const history = previous?.scope === scope ? previous.turns : [];
    const result = await nativeRequest<JarvisResponse>('jarvis_chat', {
      message: message.trim(), context, conversationId, model: options.model,
      ...(!isTauri() ? { provider: options.provider, tools: options.tools } : {}),
      // The scope comparison excludes old material after a consent or source change,
      // while preserving follow-ups in a general conversation without shared materials.
      history,
    }, options.signal, options.timeoutMs);
    if (options.signal?.aborted) return response('cancelled', 'Solicitação cancelada.');
    if (!result || typeof result.text !== 'string' || result.status !== 'success') throw new Error('A IA devolveu uma resposta inválida. Tente novamente.');
    const safe: JarvisResponse = {
      text: result.text.slice(0, 32_000), conversationId, status: 'success',
      actions: validateJarvisActions(result.actions, context),
      references: Array.isArray(result.references) ? result.references.filter(reference => context.excerpts.some(excerpt => excerpt.documentId === reference.documentId && excerpt.page === reference.page && excerpt.text === reference.excerpt)).slice(0, 8) : [],
    };
    const next = [...history, { role: 'user' as const, text: message.trim() }, { role: 'model' as const, text: safe.text.slice(0, 8_000) }].slice(-MAX_TURNS);
    histories.delete(conversationId);
    histories.set(conversationId, { scope, turns: next });
    while (histories.size > MAX_CONVERSATIONS) histories.delete(histories.keys().next().value!);
    return safe;
  } catch (cause) {
    if (options.signal?.aborted || (cause instanceof DOMException && cause.name === 'AbortError') || String(cause).includes('Solicitação cancelada')) return response('cancelled', 'Solicitação cancelada.');
    // Native messages are fixed, redacted errors, never provider bodies or credentials.
    return response('error', typeof cause === 'string' ? cause : cause instanceof Error ? cause.message : 'Não foi possível conversar com a IA. Tente novamente.');
  }
}

export async function transcribeAudio(input: JarvisTranscriptionInput, signal?: AbortSignal): Promise<string> {
  if (!Number.isFinite(input.durationMs) || input.durationMs <= 0 || input.durationMs > 30_000) throw new Error('Grave um áudio de até 30 segundos.');
  if (input.audioBase64.length > Math.ceil(10 * 1024 * 1024 / 3) * 4) throw new Error('O áudio ultrapassa o limite de 10 MiB.');
  return nativeRequest<string>('jarvis_transcribe', { ...input, mimeType: input.mimeType.split(';')[0].trim().toLowerCase(), language: input.language ?? 'pt-BR' }, signal, 45_000);
}

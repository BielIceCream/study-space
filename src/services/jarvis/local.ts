export interface LocalProvider { id: string; name: string; keyVariable: string; configured: boolean; model: string; local: boolean; tools: boolean }
export interface LocalConfiguration { configured: boolean; provider: string; providers: LocalProvider[]; transcriptionProvider: string; transcriptionSetting: string; model: string; voiceEnabled: boolean; voiceId: string; volume: number }
export const isLocalRuntime = () => typeof location !== 'undefined' && location.hostname === '127.0.0.1' && location.port === '1420';

export async function localConfiguration(): Promise<LocalConfiguration> {
  const response = await fetch('/__studyspace_local__/config', { cache: 'no-store' });
  if (!response.ok) throw new Error('Abra o StudySpace pelo iniciador local atualizado.');
  return response.json();
}

export async function localRequest<T>(command: string, input: Record<string, unknown> = {}, signal?: AbortSignal): Promise<T> {
  if (!isLocalRuntime()) throw new Error('Abra o StudySpace pelo iniciador local.');
  const response = await fetch('/__studyspace_local__/jarvis', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-StudySpace-Local': '1' },
    body: JSON.stringify({ command, input }), signal,
  });
  const result = await response.json();
  if (!response.ok) throw new Error(typeof result.error === 'string' ? result.error : 'Não foi possível concluir o pedido local.');
  return result;
}

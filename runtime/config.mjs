import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';
import { resolveProviders } from './providers.mjs';

export const configPath = resolve(dirname(fileURLToPath(import.meta.url)), '../config/.env');
export function configuration() {
  const values = existsSync(configPath) ? parseEnv(readFileSync(configPath, 'utf8')) : {};
  const providers = resolveProviders(values);
  const activeProvider = (values.AI_PROVIDER || 'gemini').trim().toLowerCase();
  const active = providers.find(item => item.id === activeProvider);
  if (!active) throw new Error('AI_PROVIDER inválido em config\\.env.');
  const transcriptionSetting = (values.TRANSCRIPTION_PROVIDER || 'auto').trim().toLowerCase();
  const transcriptionProvider = transcriptionSetting === 'auto'
    ? (['gemini', 'groq', 'openai'].includes(activeProvider) && active.configured ? activeProvider : providers.find(item => ['groq', 'openai', 'gemini'].includes(item.id) && item.configured)?.id || 'none')
    : transcriptionSetting;
  const number = (key, fallback, low, high) => {
    const value = values[key]?.trim();
    return value && Number.isFinite(Number(value)) ? Math.max(low, Math.min(high, Number(value))) : fallback;
  };
  return {
    providers, activeProvider, transcriptionProvider, transcriptionSetting,
    transcriptionModels: { groq: values.GROQ_TRANSCRIPTION_MODEL || 'whisper-large-v3-turbo', openai: values.OPENAI_TRANSCRIPTION_MODEL || 'whisper-1', gemini: values.GEMINI_TRANSCRIPTION_MODEL || values.GEMINI_MODEL || '' },
    apiKey: (values.GEMINI_API_KEY || '').trim(),
    model: (values.GEMINI_MODEL || '').trim(),
    voiceEnabled: !['false', '0', 'off'].includes((values.LOCAL_VOICE_ENABLED || 'true').toLowerCase()),
    voiceId: values.LOCAL_VOICE_ID || '',
    volume: number('LOCAL_VOICE_VOLUME', 0.8, 0, 1),
    rate: Math.round(number('LOCAL_VOICE_RATE', 0, -10, 10)),
  };
}
export function publicConfiguration() {
  const config = configuration();
  const current = config.providers.find(item => item.id === config.activeProvider);
  return {
    provider: current.id, configured: current.configured, model: current.model,
    providers: config.providers.map(({ id, name, prefix, configured, model, local, tools }) => ({ id, name, keyVariable: prefix + '_API_KEY', configured, model, local: Boolean(local), tools })),
    transcriptionProvider: config.transcriptionProvider,
    transcriptionSetting: config.transcriptionSetting,
    voiceEnabled: config.voiceEnabled, voiceId: config.voiceId, volume: config.volume,
  };
}

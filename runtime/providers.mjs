export const catalog = [
  { id: 'gemini', name: 'Google Gemini', prefix: 'GEMINI', protocol: 'gemini', base: 'https://generativelanguage.googleapis.com/v1beta' },
  { id: 'openai', name: 'OpenAI', prefix: 'OPENAI', protocol: 'openai', base: 'https://api.openai.com/v1' },
  { id: 'groq', name: 'Groq', prefix: 'GROQ', protocol: 'openai', base: 'https://api.groq.com/openai/v1' },
  { id: 'xai', name: 'xAI / Grok', prefix: 'XAI', protocol: 'openai', base: 'https://api.x.ai/v1' },
  { id: 'nvidia', name: 'NVIDIA NIM', prefix: 'NVIDIA', protocol: 'openai', base: 'https://integrate.api.nvidia.com/v1' },
  { id: 'anthropic', name: 'Anthropic / Claude', prefix: 'ANTHROPIC', protocol: 'anthropic', base: 'https://api.anthropic.com/v1' },
  { id: 'deepseek', name: 'DeepSeek', prefix: 'DEEPSEEK', protocol: 'openai', base: 'https://api.deepseek.com' },
  { id: 'mistral', name: 'Mistral', prefix: 'MISTRAL', protocol: 'openai', base: 'https://api.mistral.ai/v1' },
  { id: 'openrouter', name: 'OpenRouter', prefix: 'OPENROUTER', protocol: 'openai', base: 'https://openrouter.ai/api/v1' },
  { id: 'together', name: 'Together AI', prefix: 'TOGETHER', protocol: 'openai', base: 'https://api.together.ai/v1' },
  { id: 'fireworks', name: 'Fireworks AI', prefix: 'FIREWORKS', protocol: 'openai', base: 'https://api.fireworks.ai/inference/v1' },
  { id: 'cerebras', name: 'Cerebras', prefix: 'CEREBRAS', protocol: 'openai', base: 'https://api.cerebras.ai/v1' },
  { id: 'ollama', name: 'Ollama (local)', prefix: 'OLLAMA', protocol: 'openai', base: 'http://127.0.0.1:11434/v1', local: true },
  { id: 'lmstudio', name: 'LM Studio (local)', prefix: 'LMSTUDIO', protocol: 'openai', base: 'http://127.0.0.1:1234/v1', local: true },
  { id: 'custom', name: 'API compatível personalizada', prefix: 'CUSTOM', protocol: 'openai', base: '', custom: true },
];

export function validateBase(value) {
  let url;
  try { url = new URL(value); } catch { throw new Error('Confira o endereço BASE_URL em config\\.env.'); }
  const loopback = ['127.0.0.1', 'localhost', '[::1]'].includes(url.hostname);
  if ((url.protocol !== 'https:' && !(url.protocol === 'http:' && loopback)) || url.username || url.password || url.search || url.hash)
    throw new Error('BASE_URL deve usar HTTPS ou HTTP no próprio computador, sem credenciais, query ou fragmento.');
  return url.toString().replace(/\/$/, '');
}

export function resolveProviders(values) {
  return catalog.map(item => {
    const key = (values[item.prefix + '_API_KEY'] || '').trim();
    const rawBase = item.local || item.custom ? (values[item.prefix + '_BASE_URL'] || item.base).trim() : item.base;
    return {
      ...item, key, base: rawBase,
      configured: item.local ? true : item.custom ? Boolean(rawBase) : Boolean(key),
      model: (values[item.prefix + '_MODEL'] || '').trim(),
      tools: !['false', '0', 'off'].includes((values[item.prefix + '_TOOLS'] || 'true').toLowerCase()),
    };
  });
}

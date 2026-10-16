import { invoke, isTauri } from '@tauri-apps/api/core';
import { localRequest } from './local';

function requireDesktop(): void {
  if (!isTauri()) throw new Error('O armazenamento seguro da chave do JARVIS está disponível no aplicativo Windows.');
}

// Compatibility bridge for the existing JARVIS implementation when supplied.
// The secret is never persisted by JavaScript or returned from the native layer.
export const jarvisDesktopCredentials = {
  async isConfigured(provider?: string): Promise<boolean> {
    if (!isTauri()) return localRequest<boolean>('jarvis_has_api_key', { provider });
    requireDesktop();
    return invoke<boolean>('jarvis_has_api_key');
  },
  async save(apiKey: string): Promise<void> {
    requireDesktop();
    await invoke<void>('jarvis_set_api_key', { apiKey });
  },
  async clear(): Promise<void> {
    requireDesktop();
    await invoke<void>('jarvis_clear_api_key');
  },
};

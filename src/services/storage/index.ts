import { invoke, isTauri } from '@tauri-apps/api/core';
import type { StorageService } from '../../shared/types';
import { createNativeStorage } from './native';

export async function createStorage(): Promise<StorageService> {
  if (isTauri()) {
    const storage = createNativeStorage(invoke);
    await storage.getSnapshot();
    return storage;
  }
  const { createBrowserStorage } = await import('./browser');
  return createBrowserStorage();
}

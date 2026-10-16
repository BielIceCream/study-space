import { beforeEach, describe, expect, it, vi } from 'vitest';
import { jarvisDesktopCredentials } from './desktop-credentials';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => mocks);

describe('ponte de credenciais JARVIS para Windows', () => {
  beforeEach(() => { mocks.invoke.mockReset(); mocks.isTauri.mockReturnValue(true); });

  it('consulta apenas presença da credencial e envia operações específicas ao backend', async () => {
    mocks.invoke.mockResolvedValueOnce(true).mockResolvedValueOnce(undefined).mockResolvedValueOnce(undefined);
    expect(await jarvisDesktopCredentials.isConfigured()).toBe(true);
    await jarvisDesktopCredentials.save('only-an-example-test-value');
    await jarvisDesktopCredentials.clear();
    expect(mocks.invoke.mock.calls).toEqual([
      ['jarvis_has_api_key'],
      ['jarvis_set_api_key', { apiKey: 'only-an-example-test-value' }],
      ['jarvis_clear_api_key'],
    ]);
  });

  it('recusa armazenamento no navegador sem criar fallback em texto puro', async () => {
    mocks.isTauri.mockReturnValue(false);
    await expect(jarvisDesktopCredentials.save('example')).rejects.toThrow('aplicativo Windows');
    await expect(jarvisDesktopCredentials.isConfigured()).rejects.toThrow('iniciador local');
    await expect(jarvisDesktopCredentials.clear()).rejects.toThrow('aplicativo Windows');
    expect(mocks.invoke).not.toHaveBeenCalled();
  });
});

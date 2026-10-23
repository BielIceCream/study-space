import { createRoot } from 'react-dom/client';
import './fonts.css';
import './styles.css';
import App from './App';
import { isTauri } from '@tauri-apps/api/core';
import { RecoveryCopies } from './features/settings/RecoveryCopies';
import { downloadBackup } from './services/backup-files';
import { createStorage } from './services/storage';
import { messageFrom } from './shared/utils';

const root = createRoot(document.getElementById('root')!);
root.render(<div className="startup-screen"><span className="startup-dot" /><p>Abrindo seu espaço de estudo…</p></div>);
void createStorage().then(storage => root.render(<App storage={storage} />)).catch(error => {
  root.render(<div className="startup-screen"><h1>Seu espaço precisa de atenção</h1><p role="alert">{messageFrom(error)}</p><p>Seus dados foram preservados. Verifique o armazenamento disponível e tente novamente.</p><button className="button primary" onClick={() => window.location.reload()}>Tentar novamente</button>{!isTauri() && <RecoveryCopies listCopies={listStartupRecoveryCopies} onExportRecovery={exportStartupRecoveryCopy} />}{isTauri() && <p>As cópias de recuperação ficam na pasta privada do aplicativo. Consulte as instruções de recuperação para preservá-las antes de alterar o banco.</p>}</div>);
});

async function listStartupRecoveryCopies() {
  const { listBrowserRecoveryCopies } = await import('./services/storage/browser');
  return listBrowserRecoveryCopies();
}

async function exportStartupRecoveryCopy(id: string) {
  const { exportBrowserRecoveryCopy } = await import('./services/storage/browser');
  downloadBackup(await exportBrowserRecoveryCopy(id));
}

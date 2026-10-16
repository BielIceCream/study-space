import { useRef, useState } from 'react';
import { Download, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { ErrorMessage, Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import { readBackupFile } from '../../services/backup-files';

export function BackupModal({ empty, onClose, onExport, onRestore }: {
  empty: boolean; onClose: () => void; onExport: () => Promise<void>; onRestore: (backup: unknown) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null); setSuccess(false);
    try { await action(); setSuccess(true); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { setBusy(false); }
  };
  return <Modal title="Seu conhecimento fica com você" description="As matérias, notas e avaliações são salvas localmente. Guarde uma cópia para levar a outro dispositivo." onClose={onClose} busy={busy}>
    <div className="storage-notice"><span><HardDrive size={23} strokeWidth={1.5} /></span><div><strong>Armazenamento local · SQLite</strong><p>No aplicativo Windows, o banco fica na pasta privada do app. No navegador, fica no armazenamento deste perfil.</p></div></div>
    <div className="backup-action"><div><h3>Exportar uma cópia</h3><p>Um arquivo JSON legível com todos os dados do seu espaço.</p></div><button className="button secondary" onClick={() => void run(onExport)} disabled={busy}><Download size={16} />Exportar backup</button></div>
    <div className="backup-action"><div><h3>Restaurar seu espaço</h3><p>{empty ? 'Importe um backup do StudySpace em sua biblioteca vazia.' : 'A restauração exige uma biblioteca vazia para proteger seus dados atuais.'}</p></div><button className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy || !empty}><Upload size={16} />Importar backup</button><input ref={inputRef} type="file" accept=".json,application/json" aria-label="Arquivo de backup" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void run(async () => onRestore(await readBackupFile(file))); event.target.value = ''; }} /></div>
    <p className="backup-privacy"><ShieldCheck size={15} />O backup contém suas notas. Guarde o arquivo em um lugar seguro.</p>
    {error && <ErrorMessage>{error}</ErrorMessage>}{success && <p className="form-success" role="status">Operação concluída. Ao exportar, confirme que o arquivo foi salvo na pasta de downloads.</p>}
    <div className="modal-actions"><button className="button primary" onClick={onClose} disabled={busy}>Concluir</button></div>
  </Modal>;
}

import { useRef, useState } from 'react';
import { Download, HardDrive, ShieldCheck, Upload } from 'lucide-react';
import { ErrorMessage, Modal } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';
import { readBackupFile } from '../../services/backup-files';
import type { RecoveryMetadata } from '../../services/storage/recovery';
import { RecoveryCopies } from './RecoveryCopies';

export function BackupModal({ empty, onClose, onExport, onRestore, listRecoveryCopies, onExportRecovery }: {
  empty: boolean; onClose: () => void; onExport: () => Promise<void>; onRestore: (backup: unknown) => Promise<void>;
  listRecoveryCopies: () => Promise<RecoveryMetadata[]>; onExportRecovery: (id: string) => Promise<void>;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [actionBusy, setBusy] = useState(false);
  const [recoveryBusy, setRecoveryBusy] = useState(false);
  const busy = actionBusy || recoveryBusy;
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true); setError(null); setSuccess(false);
    try { await action(); setSuccess(true); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { setBusy(false); }
  };
  return <Modal title="Seu conhecimento fica com você" description="As matérias, notas e avaliações são salvas localmente. Guarde uma cópia para levar a outro dispositivo." onClose={onClose} busy={busy} className="backup-modal">
    <div className="storage-notice"><span><HardDrive size={23} strokeWidth={1.5} /></span><div><strong>Armazenamento local · SQLite</strong><p>No aplicativo Windows, o banco fica na pasta privada do app. No navegador, fica no armazenamento deste perfil.</p></div></div>
    <div className="backup-action"><div><h3>Exportar uma cópia</h3><p>Backup escalável (.studyspace) com matérias, notas salvas, cartões, avaliações, trilhas, diagnósticos e materiais originais separados. Até 256 MiB por arquivo, com manifesto de até 50 MiB. Cada documento pode ter até 32 MiB; cada imagem, até 8 MiB.</p></div><button className="button secondary" onClick={() => void run(onExport)} disabled={busy}><Download size={16} />Exportar backup</button></div>
    <div className="backup-action"><div><h3>Restaurar seu espaço</h3><p>{empty ? 'Importe um backup .studyspace ou JSON antigo (v1/v2, até 50 MiB) em sua biblioteca vazia.' : 'A restauração exige uma biblioteca vazia para proteger seus dados atuais.'}</p></div><button className="button secondary" onClick={() => inputRef.current?.click()} disabled={busy || !empty}><Upload size={16} />Importar backup</button><input ref={inputRef} type="file" accept=".studyspace,.json,application/json,application/octet-stream" aria-label="Arquivo de backup" hidden onChange={event => { const file = event.target.files?.[0]; if (file) void run(async () => onRestore(await readBackupFile(file))); event.target.value = ''; }} /></div>
    <RecoveryCopies listCopies={listRecoveryCopies} onExportRecovery={onExportRecovery} busy={busy} onBusyChange={setRecoveryBusy} />
    <p className="backup-privacy"><ShieldCheck size={15} />O backup contém seus estudos, sem chaves de API ou configurações do JARVIS. Guarde o arquivo em um lugar seguro.</p>
    {actionBusy && <p className="form-success" role="status">Preparando e verificando o backup. Mantenha esta janela aberta.</p>}
    {error && <ErrorMessage>{error}</ErrorMessage>}{success && <p className="form-success" role="status">Operação concluída. Ao exportar, confirme que o arquivo foi salvo na pasta de downloads.</p>}
    <div className="modal-actions"><button className="button primary" onClick={onClose} disabled={busy}>Concluir</button></div>
  </Modal>;
}

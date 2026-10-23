import { useEffect, useId, useRef, useState } from 'react';
import { Download } from 'lucide-react';
import type { RecoveryMetadata } from '../../services/storage/recovery';
import { ErrorMessage } from '../../shared/ui';
import { messageFrom } from '../../shared/utils';

export function RecoveryCopies({ listCopies, onExportRecovery, busy = false, onBusyChange }: {
  listCopies: () => Promise<RecoveryMetadata[]>;
  onExportRecovery: (id: string) => Promise<void>;
  busy?: boolean;
  onBusyChange?: (busy: boolean) => void;
}) {
  const headingId = useId();
  const [copies, setCopies] = useState<RecoveryMetadata[]>([]);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  const [exportingId, setExportingId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const exporting = useRef(false);
  useEffect(() => {
    let active = true;
    setLoading(true); setError(null);
    void listCopies().then(result => { if (active) setCopies(result.slice(0, 3)); })
      .catch(cause => { if (active) setError(messageFrom(cause)); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [listCopies, attempt]);

  const exportCopy = async (id: string) => {
    if (busy || exporting.current) return;
    exporting.current = true;
    setExportingId(id); setError(null); setSuccess(false); onBusyChange?.(true);
    try { await onExportRecovery(id); setSuccess(true); }
    catch (cause) { setError(messageFrom(cause)); }
    finally { exporting.current = false; setExportingId(null); onBusyChange?.(false); }
  };
  const locked = busy || exportingId !== null;
  return <section className="backup-action recovery-copies" aria-labelledby={headingId} aria-busy={loading || exportingId !== null}>
    <h3 id={headingId}>Proteção antes de migrações</h3>
    <p>Antes de atualizar o formato do banco, o StudySpace guarda uma cópia local verificada. São mantidas até 3 cópias. Continue exportando seus backups para um lugar seguro.</p>
    {loading ? <p role="status">Procurando cópias de recuperação…</p> : copies.length > 0 ? <ul className="recovery-copy-list">{copies.map(copy => <li key={copy.id}>
      <div><strong><time dateTime={copy.createdAt}>{formatDate(copy.createdAt)}</time></strong><span>Banco v{copy.schemaVersion} → v{copy.targetSchemaVersion} · {formatSize(copy.byteLength)}</span></div>
      <button className="button secondary" disabled={locked} onClick={() => void exportCopy(copy.id)} aria-label={`Baixar cópia recuperada de ${formatDate(copy.createdAt)}`}><Download size={16} />{exportingId === copy.id ? 'Verificando cópia…' : 'Baixar cópia recuperada'}</button>
    </li>)}</ul> : !error && <p>Nenhuma cópia de recuperação disponível. Elas são criadas somente quando o formato do banco precisa mudar.</p>}
    <p>Baixar uma cópia não altera sua biblioteca. Para recuperar os estudos, importe o arquivo .studyspace em uma biblioteca vazia de outro perfil ou dispositivo.</p>
    {exportingId !== null && <p className="form-success" role="status">Verificando e preparando a cópia de recuperação. Aguarde o download.</p>}
    {error && <><ErrorMessage>{error}</ErrorMessage>{!loading && copies.length === 0 && <button className="button secondary" disabled={locked} onClick={() => setAttempt(value => value + 1)}>Procurar cópias novamente</button>}</>}
    {success && <p className="form-success" role="status">Cópia preparada. Confirme que o arquivo foi salvo na pasta de downloads.</p>}
  </section>;
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? 'Data indisponível' : new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short', timeStyle: 'short' }).format(date);
}

function formatSize(bytes: number) {
  if (bytes < 1024) return `${bytes} B`;
  const divisor = bytes < 1024 * 1024 ? 1024 : 1024 * 1024;
  return `${(bytes / divisor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} ${divisor === 1024 ? 'KiB' : 'MiB'}`;
}

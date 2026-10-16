// Public metadata only. Credentials stay in the certificate store or Azure auth.
import { join } from 'node:path';

export function signingConfig(root, environment = process.env) {
  const mode = environment.STUDYSPACE_SIGNING_MODE ?? 'none';
  if (mode === 'none') return null;
  if (!['certificate', 'artifact'].includes(mode)) throw new Error('STUDYSPACE_SIGNING_MODE deve ser none, certificate ou artifact.');
  const publisher = environment.STUDYSPACE_PUBLISHER?.trim();
  if (!publisher || /[\r\n\\/]/.test(publisher)) throw new Error('Informe STUDYSPACE_PUBLISHER com o nome publico real do editor.');
  if (mode === 'certificate' && !/^[a-fA-F0-9]{40}$/.test(environment.STUDYSPACE_CERTIFICATE_THUMBPRINT ?? '')) {
    throw new Error('Informe o thumbprint do certificado de assinatura instalado no Windows.');
  }
  if (mode === 'artifact' && (!environment.STUDYSPACE_SIGNING_DLIB || !environment.STUDYSPACE_SIGNING_METADATA)) {
    throw new Error('Artifact Signing exige DLIB e arquivo de metadados do perfil Public Trust.');
  }
  return { bundle: { publisher, windows: { signCommand: {
    cmd: 'powershell.exe',
    args: ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(root, 'scripts/desktop/sign-windows.ps1'), '-FilePath', '%1'],
  } } } };
}

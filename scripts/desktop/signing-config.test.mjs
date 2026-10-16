import test from 'node:test';
import assert from 'node:assert/strict';
import { signingConfig } from './signing-config.mjs';

test('unsigned build has no signing callback or invented certificate', () => {
  assert.equal(signingConfig('C:/StudySpace', {}), null);
});
test('signed build rejects missing identity and signing credentials', () => {
  assert.throws(() => signingConfig('C:/StudySpace', { STUDYSPACE_SIGNING_MODE: 'certificate' }), /editor/);
  assert.throws(() => signingConfig('C:/StudySpace', { STUDYSPACE_SIGNING_MODE: 'certificate', STUDYSPACE_PUBLISHER: 'Editor' }), /thumbprint/);
  assert.throws(() => signingConfig('C:/StudySpace', { STUDYSPACE_SIGNING_MODE: 'artifact', STUDYSPACE_PUBLISHER: 'Editor' }), /DLIB/);
  assert.throws(() => signingConfig('C:/StudySpace', { STUDYSPACE_SIGNING_MODE: 'other' }), /SIGNING_MODE/);
});
test('callback preserves paths with spaces and does not embed Azure credentials', () => {
  const config = signingConfig('C:/Projeto Estudar', {
    STUDYSPACE_SIGNING_MODE: 'artifact', STUDYSPACE_PUBLISHER: 'Editor',
    STUDYSPACE_SIGNING_DLIB: 'C:/Signing/Dlib.dll', STUDYSPACE_SIGNING_METADATA: 'C:/Signing/metadata.json', AZURE_CLIENT_SECRET: 'secret-test-value',
  });
  assert.equal(config.bundle.publisher, 'Editor');
  assert.equal(config.bundle.windows.signCommand.args.at(-1), '%1');
  assert.ok(config.bundle.windows.signCommand.args.includes('C:\\Projeto Estudar\\scripts\\desktop\\sign-windows.ps1') || config.bundle.windows.signCommand.args.includes('C:/Projeto Estudar/scripts/desktop/sign-windows.ps1'));
  assert.ok(!JSON.stringify(config).includes('secret-test-value'));
});

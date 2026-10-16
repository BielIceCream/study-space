param([string]$FilePath, [switch]$CheckOnly)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-trust.ps1')
$signTool = Get-StudySpaceSignTool
$mode = $env:STUDYSPACE_SIGNING_MODE
if ($mode -notin @('certificate', 'artifact')) { throw 'Selecione certificate ou artifact para assinar.' }
if (-not $env:STUDYSPACE_PUBLISHER) { throw 'Nome publico real do editor nao configurado.' }
$timestampUrl = $env:STUDYSPACE_TIMESTAMP_URL
if ($mode -eq 'artifact' -and -not $timestampUrl) { $timestampUrl = 'http://timestamp.acs.microsoft.com' }
$timestampUri = $null
if (-not [Uri]::TryCreate($timestampUrl, [UriKind]::Absolute, [ref]$timestampUri) -or $timestampUri.Scheme -notin @('http', 'https')) { throw 'Configure o timestamp RFC3161 recomendado pelo emissor do certificado.' }
$signArguments = @('sign', '/fd', 'SHA256', '/tr', $timestampUrl, '/td', 'SHA256', '/d', 'StudySpace')
if ($mode -eq 'certificate') {
  $thumbprint = $env:STUDYSPACE_CERTIFICATE_THUMBPRINT
  if ($thumbprint -notmatch '^[a-fA-F0-9]{40}$') { throw 'Thumbprint invalido.' }
  $certificate = Get-Item -LiteralPath "Cert:\CurrentUser\My\$thumbprint" -ErrorAction Stop
  if (-not $certificate.HasPrivateKey -or $certificate.NotAfter -lt (Get-Date) -or $certificate.NotBefore -gt (Get-Date) -or $certificate.Subject -eq $certificate.Issuer) { throw 'Certificado de assinatura indisponivel, fora da validade ou autoassinado.' }
  if ($certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false) -ne $env:STUDYSPACE_PUBLISHER) { throw 'Nome do editor nao coincide com o certificado.' }
  $signArguments += @('/s', 'My', '/sha1', $thumbprint)
} else {
  if (-not $env:STUDYSPACE_SIGNING_DLIB -or -not $env:STUDYSPACE_SIGNING_METADATA) { throw 'Artifact Signing exige DLIB e metadados.' }
  $dlib = (Resolve-Path -LiteralPath $env:STUDYSPACE_SIGNING_DLIB).Path
  $dlibSignature = Get-AuthenticodeSignature -LiteralPath $dlib
  if ($dlibSignature.Status -ne 'Valid' -or $dlibSignature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(,|$)') { throw 'DLIB precisa ter assinatura Microsoft valida.' }
  $metadataPath = (Resolve-Path -LiteralPath $env:STUDYSPACE_SIGNING_METADATA).Path
  $metadata = Get-Content -LiteralPath $metadataPath -Encoding UTF8 -Raw | ConvertFrom-Json
  $endpoint = [Uri]$metadata.Endpoint
  if ($endpoint.Scheme -ne 'https' -or $endpoint.Host -notmatch '^[a-z0-9-]+\.codesigning\.azure\.net$' -or -not $metadata.CodeSigningAccountName -or -not $metadata.CertificateProfileName) { throw 'Metadados Artifact Signing invalidos.' }
  $signArguments += @('/dlib', $dlib, '/dmdf', $metadataPath)
}
if ($CheckOnly) { Write-Output 'Ferramentas e configuracao de assinatura verificadas; nenhum arquivo foi assinado.'; exit 0 }
if (-not $FilePath) { throw 'Arquivo de assinatura nao informado.' }
$targetFile = (Resolve-Path -LiteralPath $FilePath).Path
if ([IO.Path]::GetExtension($targetFile) -notin @('.exe', '.dll')) { throw 'Assinatura restrita a binarios PE do build.' }
& $signTool @signArguments $targetFile | Out-Host
if ($LASTEXITCODE -ne 0) { throw 'O servico de assinatura recusou o arquivo. Build interrompido.' }
$result = Test-StudySpaceBinary $targetFile $true $env:STUDYSPACE_PUBLISHER
$result['path'] = $targetFile
if ($env:STUDYSPACE_SIGNING_LOG) { $result | ConvertTo-Json -Compress | Add-Content -LiteralPath $env:STUDYSPACE_SIGNING_LOG -Encoding UTF8 }
Write-Output "Assinatura e timestamp verificados: $($result.file)."

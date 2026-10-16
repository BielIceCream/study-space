# CI only. Private material is accepted exclusively via GitHub Actions secrets.
$ErrorActionPreference = 'Stop'
if ($env:GITHUB_ACTIONS -ne 'true' -or -not $env:RUNNER_TEMP -or -not $env:GITHUB_ENV) { throw 'Preparacao de assinatura restrita ao runner GitHub Actions.' }
if ($env:STUDYSPACE_SIGNING_MODE -eq 'none') { exit 0 }
if (-not $env:STUDYSPACE_PUBLISHER) { throw 'Configure a variavel publica STUDYSPACE_PUBLISHER do editor validado.' }
$stageDirectory = Join-Path $env:RUNNER_TEMP 'studyspace-signing'
New-Item -ItemType Directory -Path $stageDirectory -Force | Out-Null
if ($env:STUDYSPACE_SIGNING_MODE -eq 'certificate') {
  if (-not $env:WINDOWS_CERTIFICATE -or -not $env:WINDOWS_CERTIFICATE_PASSWORD) { throw 'Secrets de certificado ausentes. Nenhuma assinatura foi realizada.' }
  $pfxPath = Join-Path $stageDirectory 'certificate.pfx'
  $before = @(Get-ChildItem -LiteralPath Cert:\CurrentUser\My | ForEach-Object { $_.Thumbprint })
  try {
    [IO.File]::WriteAllBytes($pfxPath, [Convert]::FromBase64String($env:WINDOWS_CERTIFICATE))
    $password = ConvertTo-SecureString -String $env:WINDOWS_CERTIFICATE_PASSWORD -AsPlainText -Force
    $certificates = @(Import-PfxCertificate -FilePath $pfxPath -CertStoreLocation Cert:\CurrentUser\My -Password $password)
    $owned = @($certificates | Where-Object { $_.Thumbprint -notin $before } | ForEach-Object { $_.Thumbprint })
    $owned | Set-Content -LiteralPath (Join-Path $stageDirectory 'imported-thumbprints.txt') -Encoding ASCII
    $signer = @($certificates | Where-Object { $_.HasPrivateKey })
    if ($signer.Count -ne 1) { throw 'Era esperado um certificado de assinatura com chave privada.' }
    "STUDYSPACE_CERTIFICATE_THUMBPRINT=$($signer[0].Thumbprint)" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding UTF8
  } finally {
    if (Test-Path -LiteralPath $pfxPath) {
      $resolvedPfx = (Resolve-Path -LiteralPath $pfxPath).Path
      $resolvedStage = (Resolve-Path -LiteralPath $stageDirectory).Path
      if ([IO.Path]::GetDirectoryName($resolvedPfx) -ne $resolvedStage) { throw 'Destino de limpeza invalido.' }
      Remove-Item -LiteralPath $resolvedPfx
    }
    $password = $null
  }
} elseif ($env:STUDYSPACE_SIGNING_MODE -eq 'artifact') {
  foreach ($value in @($env:AZURE_CLIENT_ID, $env:AZURE_CLIENT_SECRET, $env:AZURE_TENANT_ID, $env:STUDYSPACE_ARTIFACT_ENDPOINT, $env:STUDYSPACE_ARTIFACT_ACCOUNT, $env:STUDYSPACE_ARTIFACT_PROFILE)) {
    if (-not $value) { throw 'Configure os secrets Azure e as variaveis do perfil Public Trust antes de assinar.' }
  }
  $env:NUGET_SIGNATURE_VALIDATION_MODE = 'require'
  & nuget install Microsoft.ArtifactSigning.Client -Version 1.0.146 -Source https://api.nuget.org/v3/index.json -OutputDirectory $stageDirectory -NonInteractive -Verbosity quiet
  if ($LASTEXITCODE -ne 0) { throw 'Falha na obtencao do cliente oficial Artifact Signing.' }
  $package = Join-Path $stageDirectory 'Microsoft.ArtifactSigning.Client.1.0.146'
  & nuget verify -Signatures (Join-Path $package 'Microsoft.ArtifactSigning.Client.1.0.146.nupkg') -Verbosity quiet
  if ($LASTEXITCODE -ne 0) { throw 'Assinatura do pacote NuGet reprovada.' }
  $dlibPath = Join-Path $package 'bin\x64\Azure.CodeSigning.Dlib.dll'
  if (-not (Test-Path -LiteralPath $dlibPath)) { throw 'DLIB x64 nao encontrada no pacote verificado.' }
  $metadataPath = Join-Path $stageDirectory 'metadata.json'
  @{ Endpoint = $env:STUDYSPACE_ARTIFACT_ENDPOINT; CodeSigningAccountName = $env:STUDYSPACE_ARTIFACT_ACCOUNT; CertificateProfileName = $env:STUDYSPACE_ARTIFACT_PROFILE; ExcludeCredentials = @('ManagedIdentityCredential', 'WorkloadIdentityCredential', 'SharedTokenCacheCredential', 'VisualStudioCredential', 'VisualStudioCodeCredential', 'AzureCliCredential', 'AzurePowerShellCredential', 'AzureDeveloperCliCredential', 'InteractiveBrowserCredential') } | ConvertTo-Json | Set-Content -LiteralPath $metadataPath -Encoding UTF8
  "STUDYSPACE_SIGNING_DLIB=$dlibPath" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding UTF8
  "STUDYSPACE_SIGNING_METADATA=$metadataPath" | Add-Content -LiteralPath $env:GITHUB_ENV -Encoding UTF8
} else { throw 'Modo de assinatura invalido.' }

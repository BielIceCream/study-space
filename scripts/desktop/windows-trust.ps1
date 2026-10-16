# Shared release checks; no security configuration changes.
function Get-StudySpaceSignTool {
  $toolPath = $env:STUDYSPACE_SIGNTOOL
  if (-not $toolPath) {
    $sdkBin = Join-Path ${env:ProgramFiles(x86)} 'Windows Kits\10\bin'
    foreach ($sdkVersion in (Get-ChildItem -LiteralPath $sdkBin -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)) {
      $candidate = Join-Path $sdkVersion.FullName 'x64\signtool.exe'
      if (Test-Path -LiteralPath $candidate -PathType Leaf) { $toolPath = $candidate; break }
    }
  }
  if (-not $toolPath -or -not (Test-Path -LiteralPath $toolPath -PathType Leaf)) { throw 'SignTool do Windows SDK nao encontrado.' }
  $signature = Get-AuthenticodeSignature -LiteralPath $toolPath
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(,|$)') { throw 'SignTool precisa ter assinatura Microsoft valida.' }
  return $toolPath
}

function Test-StudySpaceBinary([string]$FilePath, [bool]$RequireSigned, [string]$Publisher) {
  $signature = Get-AuthenticodeSignature -LiteralPath $FilePath
  $result = [ordered]@{ file = [IO.Path]::GetFileName($FilePath); sha256 = (Get-FileHash -LiteralPath $FilePath -Algorithm SHA256).Hash.ToLowerInvariant(); authenticode = $signature.Status.ToString(); publisher = $null; timestamp = $false }
  if ($signature.Status -eq 'NotSigned' -and -not $RequireSigned) { return $result }
  if ($signature.Status -ne 'Valid') { throw "Assinatura invalida ou ausente: $($result.file), $($result.authenticode)." }
  $certificate = $signature.SignerCertificate
  if ($certificate.Subject -eq $certificate.Issuer) { throw 'Certificado autoassinado nao atende a distribuicao publica.' }
  $result.publisher = $certificate.GetNameInfo([Security.Cryptography.X509Certificates.X509NameType]::SimpleName, $false)
  if ($Publisher -and $result.publisher -ne $Publisher) { throw "O editor do certificado nao coincide com STUDYSPACE_PUBLISHER: $($result.file)." }
  $eku = @($certificate.Extensions | Where-Object { $_.Oid.Value -eq '2.5.29.37' } | ForEach-Object { $_.EnhancedKeyUsages } | Where-Object { $_.Value -eq '1.3.6.1.5.5.7.3.3' })
  if ($eku.Count -eq 0) { throw 'Certificado sem uso explicito de assinatura de codigo.' }
  $result.timestamp = $null -ne $signature.TimeStamperCertificate
  if (-not $result.timestamp) { throw "Timestamp ausente: $($result.file)." }
  $signTool = Get-StudySpaceSignTool
  & $signTool verify /pa /all /v /tw $FilePath | Out-Host
  if ($LASTEXITCODE -ne 0) { throw "SignTool reprovou a assinatura/cadeia: $($result.file)." }
  return $result
}

param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'), [switch]$RequireSigned)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'windows-trust.ps1')
$projectDirectory = (Resolve-Path -LiteralPath $ProjectRoot).Path
$releaseDirectory = Join-Path $projectDirectory 'release\windows'
$version = (Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if($version -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$'){throw 'Versao invalida.'}
$versionDirectory = Join-Path $releaseDirectory $version
if(Test-Path -LiteralPath $versionDirectory -PathType Container){$releaseDirectory=$versionDirectory}
if (-not (Test-Path -LiteralPath $releaseDirectory -PathType Container)) { throw 'Nenhuma distribuicao Windows gerada; verificacao nao executada.' }
if (@(Get-ChildItem -LiteralPath $releaseDirectory -Directory).Count -gt 0) { throw 'A distribuicao deve ser plana; pastas nao inventariadas nao serao publicadas.' }
$requireTrusted = $RequireSigned -or ($env:STUDYSPACE_SIGNING_MODE -in @('certificate', 'artifact'))
if ($requireTrusted -and -not $env:STUDYSPACE_PUBLISHER) { throw 'Informe o editor esperado para verificar as assinaturas.' }
$checksumFile = Join-Path $releaseDirectory 'SHA256SUMS.txt'
$checkedFiles = @()
foreach ($line in (Get-Content -LiteralPath $checksumFile)) {
  if ($line -notmatch '^([a-fA-F0-9]{64})  ([a-zA-Z0-9_.-]+)$') { throw 'Manifesto SHA256 invalido.' }
  $expectedHash = $Matches[1]
  $name = $Matches[2]
  if ($name -notmatch ('^StudySpace_' + [regex]::Escape($version) + '_x64(?:-setup(?:-offline)?\.exe|\.exe|-sem-instalacao\.zip)$')) { throw 'Arquivo inesperado no manifesto.' }
  $filePath = Join-Path $releaseDirectory $name
  if ((Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $expectedHash) { throw "SHA256 divergente: $name" }
  $checkedFiles += $name
}
if ($checkedFiles.Count -lt 3 -or @($checkedFiles | Select-Object -Unique).Count -ne $checkedFiles.Count) { throw 'Manifesto incompleto ou duplicado.' }
foreach ($file in (Get-ChildItem -LiteralPath $releaseDirectory -File)) {
  if ($file.Name -notin $checkedFiles -and $file.Name -notin @('SHA256SUMS.txt', 'verification.json')) { throw "Arquivo nao inventariado na distribuicao: $($file.Name)" }
}
$binaryResults = @()
foreach ($name in ($checkedFiles | Where-Object { $_ -like '*.exe' })) {
  $filePath = Join-Path $releaseDirectory $name
  $binaryResults += Test-StudySpaceBinary $filePath $requireTrusted $env:STUDYSPACE_PUBLISHER
  $fileVersion = [Diagnostics.FileVersionInfo]::GetVersionInfo($filePath)
  if ($fileVersion.ProductName -ne 'StudySpace') { throw "Nome de produto inesperado: $name" }
  $numericVersion = $version.Split('-')[0].Split('+')[0]
  if ($fileVersion.ProductVersion -notmatch ('^' + [regex]::Escape($numericVersion) + '(?:\.0)?$')) { throw "Versao PE divergente: $name" }
}
Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Join-Path $releaseDirectory "StudySpace_${version}_x64-sem-instalacao.zip"))
try {
  if ($zip.Entries.Count -ne 2 -or @($zip.Entries | Where-Object { $_.FullName -notin @('StudySpace.exe', 'LEIA-ME.txt') }).Count -ne 0) { throw 'ZIP contem arquivos inesperados.' }
  $stream = $zip.GetEntry('StudySpace.exe').Open()
  $algorithm = [Security.Cryptography.SHA256]::Create()
  try { $zipExecutableHash = [BitConverter]::ToString($algorithm.ComputeHash($stream)).Replace('-', '').ToLowerInvariant() }
  finally { $stream.Dispose(); $algorithm.Dispose() }
  $application = $binaryResults | Where-Object { $_.file -eq "StudySpace_${version}_x64.exe" }
  if (-not $application -or $zipExecutableHash -ne $application.sha256) { throw 'O executavel do ZIP difere do aplicativo verificado.' }
} finally { $zip.Dispose() }
$signingRecords = @()
if ($requireTrusted) {
  if (-not $env:STUDYSPACE_SIGNING_LOG -or -not (Test-Path -LiteralPath $env:STUDYSPACE_SIGNING_LOG)) { throw 'Falta evidencia da assinatura dos binarios internos do NSIS.' }
  $signingRecords = @(Get-Content -LiteralPath $env:STUDYSPACE_SIGNING_LOG -Encoding UTF8 | ForEach-Object { $_ | ConvertFrom-Json })
  if (@($signingRecords | Where-Object { $_.file -match 'uninst' -and $_.authenticode -eq 'Valid' -and $_.timestamp }).Count -eq 0) { throw 'Assinatura do desinstalador NSIS nao confirmada.' }
  foreach ($record in $signingRecords) {
    if ($record.authenticode -ne 'Valid' -or -not $record.timestamp -or $record.publisher -ne $env:STUDYSPACE_PUBLISHER) { throw 'Registro de assinatura interna reprovado.' }
    if ((Test-Path -LiteralPath $record.path) -and (Get-FileHash -LiteralPath $record.path -Algorithm SHA256).Hash -ne $record.sha256) { throw 'Binario alterado depois da assinatura.' }
  }
}
$report = [ordered]@{ verifiedAtUtc = [DateTime]::UtcNow.ToString('o'); version = $version; integrity = 'passed'; signaturesRequired = $requireTrusted; binaries = $binaryResults; nsisSigning = @($signingRecords | Select-Object file,sha256,authenticode,publisher,timestamp); defender = 'not-executed'; smartAppControlRuntime = 'not-executed'; smartScreen = 'not-executed'; installUninstall = 'not-executed' }
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath (Join-Path $releaseDirectory 'verification.json') -Encoding UTF8
Write-Output "Integridade SHA256 e ZIP verificadas. Assinaturas exigidas: $requireTrusted. Relatorio: $(Join-Path $releaseDirectory 'verification.json')"

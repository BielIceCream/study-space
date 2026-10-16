param([Parameter(Mandatory = $true)][string]$ProjectRoot, [switch]$OfflineWebView)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
$defaultReleaseDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory 'release\windows'))
$releaseDirectory = $defaultReleaseDirectory
$stageDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory '.cache\portable-stage'))
foreach ($targetDirectory in @($releaseDirectory, $stageDirectory)) {
  if (-not $targetDirectory.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destino fora do projeto.' }
}
$buildDirectory = Join-Path $projectDirectory 'src-tauri\target\x86_64-pc-windows-msvc\release'
$application = Join-Path $buildDirectory 'studyspace.exe'
if (-not (Test-Path -LiteralPath $application -PathType Leaf)) { throw 'O aplicativo .exe ainda não foi compilado.' }
$version = (Get-Content -Encoding UTF8 -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw | ConvertFrom-Json).version
if ($version -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$') { throw 'Versão inválida.' }
# Preserve earlier installers. A mixed/blocked folder is never replaced or cleaned.
if (Test-Path -LiteralPath $defaultReleaseDirectory) {
  $priorFiles = @(Get-ChildItem -LiteralPath $defaultReleaseDirectory -File | Where-Object { $_.Name -eq 'BUILD-STATUS.txt' -or ($_.Name -match '^StudySpace_.*\.(exe|zip)$' -and $_.Name -notlike "StudySpace_${version}_*") })
  if ($priorFiles.Count -gt 0) { $releaseDirectory = [IO.Path]::GetFullPath((Join-Path $defaultReleaseDirectory $version)) }
}
if (-not $releaseDirectory.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destino de release fora do projeto.' }
$installers = @(Get-ChildItem -LiteralPath (Join-Path $buildDirectory 'bundle\nsis') -Filter "StudySpace_${version}_x64-setup.exe" -File)
if ($installers.Count -ne 1) { throw 'Era esperado exatamente um instalador NSIS da versão atual.' }
New-Item -ItemType Directory -Path $releaseDirectory, $stageDirectory -Force | Out-Null
$installerFile = if ($OfflineWebView) { "StudySpace_${version}_x64-setup-offline.exe" } else { "StudySpace_${version}_x64-setup.exe" }
$installerPath = Join-Path $releaseDirectory $installerFile
$executablePath = Join-Path $releaseDirectory "StudySpace_${version}_x64.exe"
$zipPath = Join-Path $releaseDirectory "StudySpace_${version}_x64-sem-instalacao.zip"
Copy-Item -LiteralPath $installers[0].FullName -Destination $installerPath
Copy-Item -LiteralPath $application -Destination $executablePath
Copy-Item -LiteralPath $application -Destination (Join-Path $stageDirectory 'StudySpace.exe')
$portableReadme = @"
StudySpace $version - executavel sem instalacao

Abra StudySpace.exe. Ele nao inicia um terminal nem exige Node ou servidor.
O WebView2 Evergreen do Windows deve estar instalado.

Esta distribuicao e portatil quanto ao programa, mas os dados ficam no perfil
Windows: %APPDATA%\app.studyspace.desktop. Os dados nao acompanham um pendrive.
O instalador $installerFile cria atalhos e instala WebView2
quando necessario. O instalador .exe e diferente do aplicativo .exe.

Use Dados e backup para transferir estudos da versao de navegador.
As chaves do JARVIS ficam no Gerenciador de Credenciais do Windows, nunca no ZIP.
Consulte docs/WINDOWS.md para a situacao e as limitacoes da integracao JARVIS.
"@
$readmePath = Join-Path $stageDirectory 'LEIA-ME.txt'
Set-Content -Encoding UTF8 -LiteralPath $readmePath -Value $portableReadme
Compress-Archive -LiteralPath (Join-Path $stageDirectory 'StudySpace.exe'), $readmePath -DestinationPath $zipPath -Force
$checksums = @($installerPath, $executablePath, $zipPath) | ForEach-Object { "$( (Get-FileHash -LiteralPath $_ -Algorithm SHA256).Hash.ToLowerInvariant() )  $([IO.Path]::GetFileName($_))" }
Set-Content -Encoding ASCII -LiteralPath (Join-Path $releaseDirectory 'SHA256SUMS.txt') -Value $checksums
Write-Output "Artefatos gerados em $releaseDirectory"

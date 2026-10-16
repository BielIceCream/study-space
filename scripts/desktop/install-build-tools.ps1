# Official additive installation; never uninstalls components or restarts Windows.
# https://learn.microsoft.com/visualstudio/install/use-command-line-parameters-to-install-visual-studio
param(
  [string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'),
  [switch]$CheckOnly
)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
if (-not (Test-Path -LiteralPath (Join-Path $projectDirectory 'src-tauri\Cargo.toml'))) { throw 'Raiz do StudySpace invalida.' }
$programFilesDirectory = ${env:ProgramFiles(x86)}
if (-not $programFilesDirectory) { throw 'Este script exige Windows x64.' }
$installerDirectory = Join-Path $programFilesDirectory 'Microsoft Visual Studio\Installer'
$vswherePath = Join-Path $installerDirectory 'vswhere.exe'
$sdkDirectory = Join-Path $programFilesDirectory 'Windows Kits\10'

function Get-CppInstallation {
  if (Test-Path -LiteralPath $vswherePath) {
    $installation = & $vswherePath -latest -products '*' -requires Microsoft.VisualStudio.Component.VC.Tools.x86.x64 -property installationPath
    if ($LASTEXITCODE -ne 0) { throw 'Falha ao consultar o Visual Studio.' }
    return ($installation -join '').Trim()
  }
  return ''
}

function Test-WindowsSdk {
  $versions = @(Get-ChildItem -LiteralPath (Join-Path $sdkDirectory 'Include') -Directory -ErrorAction SilentlyContinue)
  foreach ($sdkVersion in $versions) {
    $headers = Test-Path -LiteralPath (Join-Path $sdkVersion.FullName 'um\Windows.h')
    $ucrtHeaders = Test-Path -LiteralPath (Join-Path $sdkVersion.FullName 'ucrt\stdio.h')
    $kernelLibrary = Test-Path -LiteralPath (Join-Path $sdkDirectory "Lib\$($sdkVersion.Name)\um\x64\kernel32.lib")
    $ucrtLibrary = Test-Path -LiteralPath (Join-Path $sdkDirectory "Lib\$($sdkVersion.Name)\ucrt\x64\ucrt.lib")
    if ($headers -and $ucrtHeaders -and $kernelLibrary -and $ucrtLibrary) { return $true }
  }
  return $false
}

function Assert-MicrosoftSignature([string]$Executable) {
  $signature = Get-AuthenticodeSignature -LiteralPath $Executable
  if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch '(^|,\s*)O=Microsoft Corporation(,|$)') {
    throw 'O instalador nao possui uma assinatura Microsoft valida. Ele nao sera executado.'
  }
}

$cppInstallation = Get-CppInstallation
$sdkAvailable = Test-WindowsSdk
if ($cppInstallation -and $sdkAvailable) {
  Write-Output 'MSVC x64 e Windows SDK ja disponiveis; nenhuma instalacao adicional necessaria.'
  exit 0
}
Write-Output "MSVC x64 disponivel: $([bool]$cppInstallation). Windows SDK disponivel: $sdkAvailable."
if ($CheckOnly) { exit 1 }
$identity = [Security.Principal.WindowsIdentity]::GetCurrent()
$principal = New-Object Security.Principal.WindowsPrincipal($identity)
if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) {
  throw 'Execute npm.cmd run desktop:setup em um PowerShell como administrador, fora da sessao restrita do Codex. O instalador grava configuracoes em AppData e Program Files.'
}

$components = '--add Microsoft.VisualStudio.Workload.VCTools --add Microsoft.VisualStudio.Component.VC.Tools.x86.x64 --add Microsoft.VisualStudio.Component.Windows11SDK.26100'
$existingInstances = @()
if (Test-Path -LiteralPath $vswherePath) {
  $instancesJson = & $vswherePath -latest -products Microsoft.VisualStudio.Product.BuildTools -version '[17.0,18.0)' -format json -utf8
  if ($LASTEXITCODE -ne 0) { throw 'Falha ao localizar o Build Tools existente.' }
  $existingInstances = @($instancesJson -join "`n" | ConvertFrom-Json)
}
if ($existingInstances.Count -gt 0) {
  $instance = $existingInstances[0]
  $installerPath = Join-Path $installerDirectory 'setup.exe'
  $installerArgs = 'modify --installPath "{0}" --channelId {1} {2} --quiet --norestart' -f $instance.installationPath, $instance.channelId, $components
} else {
  $downloadDirectory = [IO.Path]::GetFullPath((Join-Path $projectDirectory '.cache\installers'))
  if (-not $downloadDirectory.StartsWith($projectDirectory + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) { throw 'Destino fora do projeto.' }
  New-Item -ItemType Directory -Path $downloadDirectory -Force | Out-Null
  $installerPath = Join-Path $downloadDirectory 'vs_buildtools_2022.exe'
  if (-not (Test-Path -LiteralPath $installerPath)) {
    Write-Output 'Baixando o instalador oficial do Visual Studio Build Tools 2022...'
    Invoke-WebRequest -UseBasicParsing -Uri 'https://aka.ms/vs/17/release/vs_buildtools.exe' -OutFile $installerPath
  }
  $installerArgs = '{0} --quiet --wait --norestart' -f $components
}
Assert-MicrosoftSignature $installerPath
Write-Output 'Instalando os componentes C++ x64 e Windows SDK. Isso pode levar varios minutos.'
$installerProcess = Start-Process -FilePath $installerPath -ArgumentList $installerArgs -WorkingDirectory $projectDirectory -WindowStyle Hidden -PassThru -Wait
$installerExitCode = $installerProcess.ExitCode
if ($installerExitCode -eq 3010) {
  Write-Output 'Instalacao concluida. O Windows solicita reinicializacao antes da compilacao; nenhuma reinicializacao foi iniciada.'
  exit 3010
}
if ($installerExitCode -ne 0) { throw "Instalador terminou com codigo $installerExitCode. Consulte os logs dd_* em TEMP." }
$confirmationDeadline = (Get-Date).AddSeconds(45)
do {
  $cppInstallation = Get-CppInstallation
  $sdkAvailable = Test-WindowsSdk
  if ($cppInstallation -and $sdkAvailable) { break }
  Write-Output "Aguardando confirmacao dos componentes: MSVC=$([bool]$cppInstallation), SDK=$sdkAvailable."
  Start-Sleep -Seconds 2
} while ((Get-Date) -lt $confirmationDeadline)
if (-not $cppInstallation -or -not $sdkAvailable) {
  throw "O instalador terminou, mas a confirmacao continua pendente: MSVC=$([bool]$cppInstallation), SDK=$sdkAvailable. Execute novamente npm.cmd run desktop:setup para conferir; consulte os logs dd_* em TEMP se algum componente continuar ausente."
}
Write-Output 'MSVC x64 e Windows SDK instalados e confirmados. Reabra o terminal e execute npm.cmd run desktop:check.'

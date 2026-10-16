# Scan final payloads; preserves Defender settings and checks for remediation changes.
param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'), [switch]$RequireDefender)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath $ProjectRoot).Path
$releaseDirectory = Join-Path $projectDirectory 'release\windows'
$version=(Get-Content -LiteralPath (Join-Path $projectDirectory 'package.json') -Raw -Encoding UTF8 | ConvertFrom-Json).version
if($version -notmatch '^\d+\.\d+\.\d+([.-][a-zA-Z0-9.-]+)?$'){throw 'Versao invalida.'}
$versionDirectory=Join-Path $releaseDirectory $version
if(Test-Path -LiteralPath $versionDirectory -PathType Container){$releaseDirectory=$versionDirectory}
$reportPath = Join-Path $releaseDirectory 'verification.json'
$report = Get-Content -LiteralPath $reportPath -Encoding UTF8 -Raw | ConvertFrom-Json
if($report.version -ne $version){throw 'A distribuicao atual ainda nao foi gerada/verificada; arquivos anteriores foram preservados.'}
$platformDirectory = Join-Path $env:ProgramData 'Microsoft\Windows Defender\Platform'
$platforms = @(Get-ChildItem -LiteralPath $platformDirectory -Directory -ErrorAction SilentlyContinue | Sort-Object Name -Descending)
$scanner = if ($platforms.Count -gt 0) { Join-Path $platforms[0].FullName 'MpCmdRun.exe' } else { Join-Path $env:ProgramFiles 'Windows Defender\MpCmdRun.exe' }
if (-not (Test-Path -LiteralPath $scanner -PathType Leaf)) {
  $report.defender = 'not-executed: scanner unavailable'
  $report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $reportPath -Encoding UTF8
  if ($RequireDefender) { throw 'Microsoft Defender indisponivel; verificacao obrigatoria nao executada.' }
  Write-Output 'Microsoft Defender indisponivel; varredura nao executada.'
  exit 0
}
$signature = Get-AuthenticodeSignature -LiteralPath $scanner
if ($signature.Status -ne 'Valid' -or $signature.SignerCertificate.Subject -notmatch 'O=Microsoft Corporation(,|$)') { throw 'Assinatura Microsoft do scanner nao confirmada.' }
$before = @{}
foreach ($file in (Get-ChildItem -LiteralPath $releaseDirectory -File | Where-Object { $_.Extension -in @('.exe', '.zip') })) { $before[$file.FullName] = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash }
$scanOutput = & $scanner -Scan -ScanType 3 -File $releaseDirectory 2>&1
$scanExitCode = $LASTEXITCODE
$scanOutput | ForEach-Object { Write-Output $_ }
$logDirectory = Join-Path $projectDirectory '.cache\windows-diagnostics'
New-Item -ItemType Directory -Path $logDirectory -Force | Out-Null
$scanOutput | Set-Content -LiteralPath (Join-Path $logDirectory 'defender-release-scan.log') -Encoding UTF8
$unchanged = $true
foreach ($filePath in $before.Keys) {
  if (-not (Test-Path -LiteralPath $filePath) -or (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash -ne $before[$filePath]) { $unchanged = $false }
}
$passed = $scanExitCode -eq 0 -and $unchanged
$report.defender = if ($passed) { 'passed: scan completed; payload hashes unchanged' } else { "failed: scan exit=$scanExitCode; payload unchanged=$unchanged" }
$report | Add-Member -NotePropertyName defenderScannedAtUtc -NotePropertyValue ([DateTime]::UtcNow.ToString('o')) -Force
$report | ConvertTo-Json -Depth 7 | Set-Content -LiteralPath $reportPath -Encoding UTF8
if (-not $passed) { throw 'Varredura Defender falhou ou alterou/quarentenou um artefato. Distribuicao interrompida.' }
Write-Output 'Defender concluiu a varredura e os hashes dos artefatos continuam iguais.'

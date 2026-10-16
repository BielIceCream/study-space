# Read-only Windows diagnostics. Never changes policies, exclusions or certificates.
param([string]$ProjectRoot = (Join-Path $PSScriptRoot '..\..'), [int]$Days = 2)
$ErrorActionPreference = 'Stop'
$projectDirectory = (Resolve-Path -LiteralPath $ProjectRoot).Path.TrimEnd('\', '/')
$outputDirectory = Join-Path $projectDirectory '.cache\windows-diagnostics'
New-Item -ItemType Directory -Path $outputDirectory -Force | Out-Null
$report = [ordered]@{ collectedAtUtc = [DateTime]::UtcNow.ToString('o'); policyChanges = $false; codeIntegrity = @(); defender = $null }
try {
  $report.sacState = (Get-ItemProperty -LiteralPath 'HKLM:\SYSTEM\CurrentControlSet\Control\CI\Policy' -Name VerifiedAndReputablePolicyState).VerifiedAndReputablePolicyState
} catch { $report.sacState = 'unavailable' }
try {
  $events = @(Get-WinEvent -FilterHashtable @{ LogName = 'Microsoft-Windows-CodeIntegrity/Operational'; Id = 3076,3077; StartTime = (Get-Date).AddDays(-$Days) } -MaxEvents 200 -ErrorAction Stop)
  foreach ($event in $events) {
    $eventXml = [xml]$event.ToXml()
    $data = @{}
    foreach ($entry in $eventXml.Event.EventData.Data) { $data[$entry.Name] = $entry.InnerText }
    $devicePath = $data['File Name']
    if (-not $devicePath) { continue }
    $projectMarker = $projectDirectory.Substring(2) + '\'
    $markerIndex = $devicePath.IndexOf($projectMarker, [StringComparison]::OrdinalIgnoreCase)
    if ($markerIndex -lt 0) { continue }
    $relativePath = $devicePath.Substring($markerIndex + $projectMarker.Length)
    $filePath = [IO.Path]::GetFullPath((Join-Path $projectDirectory $relativePath))
    if (-not $filePath.StartsWith($projectDirectory + '\', [StringComparison]::OrdinalIgnoreCase)) { continue }
    $signatureStatus = 'file-not-present'
    $currentHash = $null
    if (Test-Path -LiteralPath $filePath -PathType Leaf) {
      $signatureStatus = (Get-AuthenticodeSignature -LiteralPath $filePath).Status.ToString()
      $currentHash = (Get-FileHash -LiteralPath $filePath -Algorithm SHA256).Hash.ToLowerInvariant()
    }
    $eventHash = $data['SHA256 Flat Hash']
    if (-not $eventHash) { $eventHash = '' }
    $report.codeIntegrity += [ordered]@{
      eventId = $event.Id; recordId = $event.RecordId; utc = $event.TimeCreated.ToUniversalTime().ToString('o')
      file = $relativePath.Replace('\', '/'); process = [IO.Path]::GetFileName($data['Process Name'])
      policy = $data.PolicyName; status = $data.Status; eventSha256 = $eventHash.ToLowerInvariant()
      currentSha256 = $currentHash; hashMatchesEvent = ($currentHash -eq $eventHash); authenticode = $signatureStatus
    }
  }
  $report.codeIntegrityRead = 'passed'
} catch {
  $report.codeIntegrityRead = if ($_.FullyQualifiedErrorId -like 'NoMatchingEventsFound*') { 'no-matching-events' } else { 'unavailable' }
}
try {
  $status = Get-MpComputerStatus -ErrorAction Stop
  $report.defender = @{ status = 'read'; antivirusEnabled = $status.AntivirusEnabled; realtimeEnabled = $status.RealTimeProtectionEnabled; signatureVersion = $status.AntivirusSignatureVersion; scan = 'not-executed' }
} catch { $report.defender = @{ status = 'unavailable'; reason = $_.Exception.Message; scan = 'not-executed' } }
$reportPath = Join-Path $outputDirectory 'security.json'
$report | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $reportPath -Encoding UTF8
Write-Output "Diagnostico salvo em $reportPath"
foreach ($entry in $report.codeIntegrity) { Write-Output "Evento $($entry.eventId), $($entry.utc): $($entry.file), $($entry.policy), Authenticode=$($entry.authenticode), SHA256 confere=$($entry.hashMatchesEvent)." }
Write-Output "Defender: $($report.defender.status). Nenhuma politica foi alterada."

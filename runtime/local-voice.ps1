$ErrorActionPreference = 'Stop'
[Console]::InputEncoding = New-Object System.Text.UTF8Encoding($false)
[Console]::OutputEncoding = New-Object System.Text.UTF8Encoding($false)
$taskInput = [Console]::In.ReadToEnd() | ConvertFrom-Json
Add-Type -AssemblyName System.Speech
$taskSpeech = New-Object System.Speech.Synthesis.SpeechSynthesizer
try {
    if ($taskInput.operation -eq 'list') {
        $taskVoices = @($taskSpeech.GetInstalledVoices() | Where-Object Enabled | ForEach-Object {
            @{ id = $_.VoiceInfo.Name; name = $_.VoiceInfo.Name; language = $_.VoiceInfo.Culture.Name; local = $true }
        })
        ConvertTo-Json -InputObject $taskVoices -Compress
    } elseif ($taskInput.operation -eq 'synthesize') {
        if ($taskInput.voiceId) { $taskSpeech.SelectVoice([string]$taskInput.voiceId) }
        $taskSpeech.Rate = [Math]::Max(-10, [Math]::Min(10, [int]$taskInput.rate))
        $taskMemory = New-Object System.IO.MemoryStream
        try {
            $taskSpeech.SetOutputToWaveStream($taskMemory)
            $taskSpeech.Speak([string]$taskInput.text)
            @{ audioBase64 = [Convert]::ToBase64String($taskMemory.ToArray()); mimeType = 'audio/wav' } | ConvertTo-Json -Compress
        } finally { $taskMemory.Dispose() }
    } else { throw 'Operacao de voz invalida.' }
} finally { $taskSpeech.Dispose() }

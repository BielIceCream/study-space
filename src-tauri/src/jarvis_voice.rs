//! Offline speech synthesis through installed Windows WinRT voices.
use serde::{Deserialize, Serialize};

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JarvisVoice {
    id: String,
    name: String,
    language: String,
    local: bool,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct JarvisSynthesisInput {
    text: String,
    voice_id: String,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct JarvisSynthesizedAudio {
    audio_base64: String,
    mime_type: String,
}

#[tauri::command]
pub async fn jarvis_list_voices() -> Result<Vec<JarvisVoice>, String> {
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(platform::list_voices)
            .await
            .map_err(|_| "O serviço de vozes do Windows foi interrompido.".to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("A síntese local do JARVIS está disponível somente no Windows.".into())
    }
}

#[tauri::command]
pub async fn jarvis_synthesize(input: JarvisSynthesisInput) -> Result<JarvisSynthesizedAudio, String> {
    if input.text.trim().is_empty() || input.text.chars().count() > 8_000 {
        return Err("A fala deve conter entre 1 e 8000 caracteres.".into());
    }
    if input.voice_id.is_empty() || input.voice_id.len() > 2_048 {
        return Err("Selecione uma voz local válida.".into());
    }
    #[cfg(windows)]
    {
        tauri::async_runtime::spawn_blocking(move || platform::synthesize(input))
            .await
            .map_err(|_| "O serviço de síntese do Windows foi interrompido.".to_string())?
    }
    #[cfg(not(windows))]
    {
        Err("A síntese local do JARVIS está disponível somente no Windows.".into())
    }
}

#[cfg(windows)]
mod platform {
    use super::*;
    use base64::{engine::general_purpose::STANDARD, Engine};
    use windows::{
        core::HSTRING,
        Media::SpeechSynthesis::{SpeechSynthesisStream, SpeechSynthesizer},
        Storage::Streams::DataReader,
        Win32::System::WinRT::{RoInitialize, RoUninitialize, RO_INIT_MULTITHREADED},
    };

    // Every blocking pool thread initializes WinRT and balances initialization.
    struct Apartment;
    impl Apartment {
        fn new() -> Result<Self, String> {
            unsafe { RoInitialize(RO_INIT_MULTITHREADED) }.map_err(win_error)?;
            Ok(Self)
        }
    }
    impl Drop for Apartment {
        fn drop(&mut self) { unsafe { RoUninitialize() }; }
    }
    struct Synthesizer(SpeechSynthesizer);
    impl Drop for Synthesizer {
        fn drop(&mut self) { let _ = self.0.Close(); }
    }
    struct Stream(SpeechSynthesisStream);
    impl Drop for Stream {
        fn drop(&mut self) { let _ = self.0.Close(); }
    }
    struct Reader(DataReader);
    impl Drop for Reader {
        fn drop(&mut self) { let _ = self.0.Close(); }
    }

    fn win_error(error: windows::core::Error) -> String {
        format!("Não foi possível acessar a síntese de voz local do Windows: {error}")
    }

    pub fn list_voices() -> Result<Vec<JarvisVoice>, String> {
        let _apartment = Apartment::new()?;
        let installed = SpeechSynthesizer::AllVoices().map_err(win_error)?;
        let mut voices = Vec::new();
        for index in 0..installed.Size().map_err(win_error)? {
            let voice = installed.GetAt(index).map_err(win_error)?;
            voices.push(JarvisVoice {
                id: voice.Id().map_err(win_error)?.to_string(),
                name: voice.DisplayName().map_err(win_error)?.to_string(),
                language: voice.Language().map_err(win_error)?.to_string(),
                local: true,
            });
        }
        Ok(voices)
    }

    pub fn synthesize(input: JarvisSynthesisInput) -> Result<JarvisSynthesizedAudio, String> {
        let _apartment = Apartment::new()?;
        let installed = SpeechSynthesizer::AllVoices().map_err(win_error)?;
        let mut selected = None;
        for index in 0..installed.Size().map_err(win_error)? {
            let voice = installed.GetAt(index).map_err(win_error)?;
            if voice.Id().map_err(win_error)?.to_string() == input.voice_id {
                selected = Some(voice);
                break;
            }
        }
        let voice = selected.ok_or_else(|| "A voz selecionada não está mais instalada no Windows. Atualize a lista de vozes.".to_string())?;
        let synth = Synthesizer(SpeechSynthesizer::new().map_err(win_error)?);
        synth.0.SetVoice(&voice).map_err(win_error)?;
        // Blocking WinRT joins happen only on the blocking thread, never on the UI.
        let stream = Stream(synth.0.SynthesizeTextToStreamAsync(&HSTRING::from(input.text))
            .map_err(win_error)?.join().map_err(win_error)?);
        let size = stream.0.Size().map_err(win_error)?;
        if size == 0 || size > 64 * 1024 * 1024 {
            return Err("O áudio gerado é vazio ou excedeu o limite local de 64 MiB.".into());
        }
        let reader = Reader(DataReader::CreateDataReader(&stream.0.GetInputStreamAt(0).map_err(win_error)?)
            .map_err(win_error)?);
        let loaded = reader.0.LoadAsync(size as u32).map_err(win_error)?.join().map_err(win_error)?;
        if loaded as u64 != size {
            return Err("O Windows retornou um áudio incompleto. Tente ouvir novamente.".into());
        }
        let mut bytes = vec![0u8; loaded as usize];
        reader.0.ReadBytes(&mut bytes).map_err(win_error)?;
        if bytes.len() < 12 || &bytes[0..4] != b"RIFF" || &bytes[8..12] != b"WAVE" {
            return Err("O Windows retornou um formato de fala diferente de WAV.".into());
        }
        Ok(JarvisSynthesizedAudio { audio_base64: STANDARD.encode(bytes), mime_type: "audio/wav".into() })
    }
}

#[cfg(test)]
#[path = "jarvis_voice/tests.rs"]
mod tests;

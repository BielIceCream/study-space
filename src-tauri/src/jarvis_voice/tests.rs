//! Environment-dependent probes; these are deliberately absent from routine CI.
//!
//! Run on Windows with `cargo test windows_local_voice_probe -- --ignored --nocapture`.
//! To retain the generated WAV, set STUDYSPACE_VOICE_PROBE_PATH to an absolute
//! file directly inside <workspace>/.cache/mission-2.4. Never saves credentials.
//! Playback is a separate manual step: SoundPlayer.PlaySync verifies software
//! playback completion, not that a person heard sound or that speakers work.

#[cfg(windows)]
#[test]
#[ignore = "Uses actual Windows WinRT and installed voices; run explicitly on a Windows workstation"]
fn windows_local_voice_probe() {
    use super::{platform, JarvisSynthesisInput};
    use base64::{engine::general_purpose::STANDARD, Engine};
    use std::{fs, io::Write, path::PathBuf};

    let voices = platform::list_voices().expect("Actual WinRT voice enumeration failed");
    println!("VOICE_PROBE installed_count={}", voices.len());
    for voice in &voices {
        println!("VOICE_PROBE installed_language={} local={}", voice.language, voice.local);
    }
    let Some(voice) = voices.iter().find(|voice| voice.language.eq_ignore_ascii_case("pt-BR")) else {
        println!("VOICE_PROBE status=PT_BR_UNAVAILABLE synthesis=NOT_RUN playback=NOT_RUN");
        return;
    };
    let audio = platform::synthesize(JarvisSynthesisInput {
        text: "JARVIS pronto para estudar.".into(),
        voice_id: voice.id.clone(),
    }).expect("Actual local pt-BR WinRT synthesis failed");
    assert_eq!(audio.mime_type, "audio/wav");
    let bytes = STANDARD.decode(&audio.audio_base64).expect("WinRT WAV base64 must decode");
    assert!(bytes.len() > 44, "A WAV header alone is not speech audio");
    assert_eq!(&bytes[..4], b"RIFF");
    assert_eq!(&bytes[8..12], b"WAVE");
    println!("VOICE_PROBE status=PT_BR_WAV_GENERATED language={} bytes={} riff=true wave=true playback=NOT_RUN", voice.language, bytes.len());

    if let Some(output) = std::env::var_os("STUDYSPACE_VOICE_PROBE_PATH") {
        let workspace = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
            .parent().expect("Tauri directory has a workspace parent")
            .canonicalize().expect("Workspace must exist");
        let cache = workspace.join(".cache").canonicalize().expect("Workspace cache must exist");
        assert!(cache.starts_with(&workspace), "Cache directory must stay within workspace");
        let allowed = cache.join("mission-2.4");
        fs::create_dir_all(&allowed).expect("Cannot create workspace voice probe directory");
        let allowed = allowed.canonicalize().expect("Probe directory must resolve");
        assert!(allowed.starts_with(&workspace), "Probe directory must stay within workspace");
        let output = PathBuf::from(output);
        assert!(output.is_absolute(), "Probe WAV path must be explicit and absolute");
        let parent = output.parent().expect("Probe WAV must have a parent")
            .canonicalize().expect("Probe output parent must already exist");
        assert_eq!(parent, allowed, "Probe WAV must be directly inside workspace .cache/mission-2.4");
        assert_eq!(output.extension().and_then(|value| value.to_str()), Some("wav"));
        let checked_output = allowed.join(output.file_name().expect("Probe WAV must have a filename"));
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&checked_output)
            .expect("Use a fresh WAV filename; probe does not overwrite artifacts");
        file.write_all(&bytes).expect("Cannot save actual WinRT probe WAV");
        println!("VOICE_PROBE wav_saved={} physical_hearing=NOT_VERIFIED", output.display());
    }
}

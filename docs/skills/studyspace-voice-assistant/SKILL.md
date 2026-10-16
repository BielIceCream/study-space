---
name: studyspace-voice-assistant
description: Implementa captura, transcrição e reprodução de voz no StudySpace Windows com Tauri, preservando privacidade e interface.
---

# Voz do StudySpace

Use captura por botão com getUserMedia e MediaRecorder. Não mantenha escuta contínua. Limite duração e tamanho; finalize por silêncio e libere tracks, AudioContext e URLs em cancelamento, erro e desmontagem.

Separe captura, transcrição, síntese e reprodução. Transcrição externa somente após ação explícita, via Rust com credencial do Windows. Nunca exponha a chave ao frontend. Priorize pt-BR e síntese local Windows; sinalize voz ausente. Reproduza efetivamente o áudio com Audio.play(), com volume, interrupção e mute.

Não introduza Python, GPU ou servidor permanente. Reutilize componentes e estilos atuais. Valide contratos e cleanup com testes direcionados; testes simulados não comprovam microfone nem reprodução física. Registre separadamente testes físicos executados e pendentes.

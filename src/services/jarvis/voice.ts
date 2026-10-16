import { invoke, isTauri } from '@tauri-apps/api/core';
import { transcribeAudio } from './client';
import { localConfiguration, localRequest } from './local';
import type { JarvisSynthesizedAudio, JarvisVoice, JarvisVoiceSnapshot } from './voice-types';

export const MAX_RECORDING_MS = 30_000;
export const MAX_RECORDING_BYTES = 10 * 1024 * 1024;
export const SILENCE_MS = 1_300;
export const MAX_SPEECH_CHARS = 32_000;
const NO_SPEECH_MS = 5_000;
const SILENCE_RMS = 0.012;
type CapturedAudio = { blob: Blob; durationMs: number };

function speechChunks(text: string): string[] {
  const chunks: string[] = [];
  let start = 0;
  while (start < text.length) {
    let end = Math.min(start + 8_000, text.length);
    if (end < text.length) {
      const part = text.slice(start, end);
      const paragraph = part.lastIndexOf('\n\n');
      let boundary = paragraph >= 4_000 ? paragraph + 2 : 0;
      if (!boundary) {
        for (const sentence of part.matchAll(/[.!?]["'»”)]*\s+/g)) {
          const candidate = sentence.index + sentence[0].length;
          if (candidate >= 4_000) boundary = candidate;
        }
      }
      if (!boundary) {
        const space = part.lastIndexOf(' ');
        if (space >= 4_000) boundary = space + 1;
      }
      if (boundary) end = start + boundary;
      // Never split a Unicode surrogate pair when there is no phrase boundary.
      const last = text.charCodeAt(end - 1);
      if (last >= 0xd800 && last <= 0xdbff) end -= 1;
    }
    chunks.push(text.slice(start, end));
    start = end;
  }
  return chunks;
}

function message(error: unknown): string {
  if (error instanceof DOMException && error.name === 'NotAllowedError') return 'Permita o acesso ao microfone no navegador (ícone ao lado do endereço) e nas configurações de privacidade do Windows.';
  if (error instanceof DOMException && error.name === 'NotFoundError') return 'Nenhum microfone foi encontrado. Conecte um microfone e tente novamente.';
  return error instanceof Error ? error.message : String(error);
}

async function blobBase64(blob: Blob): Promise<string> {
  const bytes = new Uint8Array(await blob.arrayBuffer());
  let binary = '';
  for (let offset = 0; offset < bytes.length; offset += 8192) binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(binary);
}

/** One user-triggered recording at a time. No continuous microphone listener. */
export class JarvisVoiceController {
  private current: JarvisVoiceSnapshot = { status: 'idle', error: null, level: 0, muted: false, volume: 0.8, voiceId: null, voices: [] };
  private readonly listeners = new Set<(snapshot: JarvisVoiceSnapshot) => void>();
  private operation = 0;
  private disposed = false;
  private voiceEnabled = true;
  private abort: AbortController | null = null;
  private finishCapture: (() => void) | null = null;
  private cancelCapture: (() => void) | null = null;
  private audio: HTMLAudioElement | null = null;
  private audioUrl: string | null = null;
  private finishPlayback: (() => void) | null = null;

  get snapshot(): JarvisVoiceSnapshot { return this.current; }

  subscribe(listener: (snapshot: JarvisVoiceSnapshot) => void): () => void {
    this.listeners.add(listener);
    listener(this.current);
    return () => { this.listeners.delete(listener); };
  }

  private update(update: Partial<JarvisVoiceSnapshot>): void {
    if (this.disposed) return;
    this.current = { ...this.current, ...update };
    this.listeners.forEach((listener) => listener(this.current));
  }

  async initialize(): Promise<void> {
    try {
      const config = isTauri() ? null : await localConfiguration();
      if (config && !config.voiceEnabled) { this.voiceEnabled = false; this.update({ muted: true, voices: [], voiceId: null, status: 'idle', error: null }); return; }
      const voices = isTauri() ? await invoke<JarvisVoice[]>('jarvis_list_voices') : await localRequest<JarvisVoice[]>('jarvis_list_voices');
      if (this.disposed) return;
      const preferred = voices.find(voice => voice.id === config?.voiceId) ?? voices.find((voice) => voice.language.toLowerCase() === 'pt-br');
      if (config) this.setVolume(config.volume);
      this.update({ voices, voiceId: preferred?.id ?? null });
      if (!preferred) throw new Error('Nenhuma voz local pt-BR está instalada. Instale a voz de Português (Brasil) nas configurações de Fala do Windows.');
      this.update({ error: null, status: 'idle' });
    } catch (error) {
      this.update({ status: 'error', error: message(error) });
    }
  }

  setVoice(voiceId: string): void {
    if (!this.current.voices.some((voice) => voice.id === voiceId && voice.local)) return;
    this.update({ voiceId, error: null, ...(this.current.status === 'error' ? { status: 'idle' as const } : {}) });
  }

  setVolume(volume: number): void {
    const normalized = Number.isFinite(volume) ? Math.max(0, Math.min(1, volume)) : 0.8;
    if (this.audio) this.audio.volume = normalized;
    this.update({ volume: normalized });
  }

  setMuted(muted: boolean): void {
    if (!this.voiceEnabled) muted = true;
    if (muted && this.current.status === 'speaking') this.cancel();
    this.update({ muted });
  }

  finishListening(): void { this.finishCapture?.(); }

  cancel(): void {
    this.operation += 1;
    this.abort?.abort();
    this.abort = null;
    this.cancelCapture?.();
    this.cancelCapture = null;
    this.finishCapture = null;
    this.releasePlayback();
    this.update({ status: 'idle', error: null, level: 0 });
  }

  dispose(): void {
    this.cancel();
    this.disposed = true;
    this.listeners.clear();
  }

  async startListening(model: string, provider?: string): Promise<string | null> {
    if (this.disposed) return null;
    this.cancel();
    const operation = this.operation;
    const abort = new AbortController();
    this.abort = abort;
    this.update({ status: 'listening', error: null });
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') throw new Error('Este ambiente não disponibiliza gravação de áudio. Use o aplicativo Windows atualizado.');
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (operation !== this.operation || this.disposed) { stream.getTracks().forEach((track) => track.stop()); return null; }
      const captured = await this.record(stream);
      if (!captured || operation !== this.operation || this.disposed) return null;
      if (!captured.blob.size) throw new Error('A gravação não contém áudio. Tente falar mais próximo do microfone.');
      this.update({ status: 'transcribing', level: 0 });
      const audioBase64 = await blobBase64(captured.blob);
      if (operation !== this.operation || this.disposed) return null;
      const text = await transcribeAudio({ audioBase64, mimeType: captured.blob.type.split(';')[0], durationMs: captured.durationMs, language: 'pt-BR', model, ...(provider ? { provider } : {}) }, abort.signal);
      if (operation !== this.operation || this.disposed) return null;
      this.update({ status: 'idle', error: null });
      return text;
    } catch (error) {
      if (operation !== this.operation || abort.signal.aborted || this.disposed) return null;
      this.update({ status: 'error', error: message(error), level: 0 });
      throw error;
    } finally {
      if (this.abort === abort) this.abort = null;
    }
  }

  private record(stream: MediaStream): Promise<CapturedAudio | null> {
    return new Promise((resolve, reject) => {
      let recorder: MediaRecorder | null = null;
      let context: AudioContext | null = null;
      let source: MediaStreamAudioSourceNode | null = null;
      let analyser: AnalyserNode | null = null;
      let timer: ReturnType<typeof setTimeout> | null = null;
      let monitor: ReturnType<typeof setInterval> | null = null;
      const chunks: Blob[] = [];
      let size = 0;
      let settled = false;
      let cleaned = false;
      let durationMs = 0;
      let failure: Error | null = null;
      const started = performance.now();
      let lastSound = started;
      let heardSpeech = false;
      const cleanup = () => {
        if (cleaned) return;
        cleaned = true;
        if (timer) clearTimeout(timer);
        if (monitor) clearInterval(monitor);
        timer = monitor = null;
        source?.disconnect();
        analyser?.disconnect();
        stream.getTracks().forEach((track) => track.stop());
        if (context && context.state !== 'closed') void context.close().catch(() => undefined);
        this.finishCapture = this.cancelCapture = null;
      };
      const stop = () => {
        if (settled) return;
        durationMs = Math.min(MAX_RECORDING_MS, Math.max(1, performance.now() - started));
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        cleanup();
      };
      this.cancelCapture = () => {
        if (settled) return;
        settled = true;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        cleanup();
        chunks.length = 0;
        resolve(null);
      };
      this.finishCapture = stop;
      try {
        const mime = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4'].find((candidate) => MediaRecorder.isTypeSupported(candidate));
        if (!mime) throw new Error('O gravador não oferece um formato de áudio compatível. Atualize o WebView2 do Windows.');
        recorder = new MediaRecorder(stream, { mimeType: mime, audioBitsPerSecond: 64_000 });
        recorder.ondataavailable = (event) => {
          if (settled || !event.data.size) return;
          size += event.data.size;
          if (size > MAX_RECORDING_BYTES) { failure = new Error('A gravação excedeu o limite de 10 MiB. Grave uma mensagem menor.'); stop(); return; }
          chunks.push(event.data);
        };
        recorder.onerror = () => {
          if (settled) return;
          settled = true;
          if (recorder && recorder.state !== 'inactive') recorder.stop();
          cleanup();
          reject(new Error('O microfone interrompeu a gravação. Tente novamente.'));
        };
        recorder.onstop = () => {
          if (settled) return;
          settled = true;
          cleanup();
          if (failure) reject(failure);
          else resolve({ blob: new Blob(chunks, { type: recorder?.mimeType || mime }), durationMs });
        };
        context = new AudioContext();
        source = context.createMediaStreamSource(stream);
        analyser = context.createAnalyser();
        analyser.fftSize = 1024;
        source.connect(analyser);
        const samples = new Float32Array(analyser.fftSize);
        if (context.state === 'suspended') void context.resume().catch(() => { failure = new Error('Não foi possível analisar o áudio do microfone.'); stop(); });
        recorder.start(200);
        timer = setTimeout(stop, MAX_RECORDING_MS);
        monitor = setInterval(() => {
          if (!analyser || settled) return;
          analyser.getFloatTimeDomainData(samples);
          const rms = Math.sqrt(samples.reduce((sum, value) => sum + value * value, 0) / samples.length);
          this.update({ level: Math.min(1, rms * 6) });
          const now = performance.now();
          if (rms >= SILENCE_RMS) { lastSound = now; heardSpeech = true; }
          else if (heardSpeech && now - lastSound >= SILENCE_MS) stop();
          else if (!heardSpeech && now - started >= NO_SPEECH_MS) { failure = new Error('Nenhuma fala foi detectada. Verifique o microfone e tente novamente.'); stop(); }
        }, 100);
      } catch (error) {
        settled = true;
        if (recorder && recorder.state !== 'inactive') recorder.stop();
        cleanup();
        reject(error);
      }
    });
  }

  private releasePlayback(): void {
    if (this.audio) {
      this.audio.onended = this.audio.onerror = null;
      this.audio.pause();
      this.audio.removeAttribute('src');
      this.audio.load();
      this.audio = null;
    }
    if (this.audioUrl) { URL.revokeObjectURL(this.audioUrl); this.audioUrl = null; }
    this.finishPlayback?.();
    this.finishPlayback = null;
  }

  /** Synthesizes locally, then actually plays the returned WAV. */
  async speak(text: string): Promise<void> {
    if (this.disposed || this.current.muted || !text.trim()) return;
    this.cancel();
    const operation = this.operation;
    this.update({ status: 'speaking', error: null });
    try {
      if (!this.current.voiceId) throw new Error('Selecione uma voz local instalada. Para Português (Brasil), instale uma voz pt-BR nas configurações de Fala do Windows.');
      if (Array.from(text).length > MAX_SPEECH_CHARS) throw new Error('A resposta excede o limite de 32000 caracteres para leitura em voz. Selecione um trecho menor.');
      const voiceId = this.current.voiceId;
      for (const chunk of speechChunks(text)) {
        if (operation !== this.operation || this.disposed || this.current.muted) return;
        if (!chunk.trim()) continue;
        const result = isTauri()
          ? await invoke<JarvisSynthesizedAudio>('jarvis_synthesize', { input: { text: chunk, voiceId } })
          : await localRequest<JarvisSynthesizedAudio>('jarvis_synthesize', { text: chunk, voiceId });
        if (operation !== this.operation || this.disposed || this.current.muted) return;
        const decoded = atob(result.audioBase64);
        const bytes = Uint8Array.from(decoded, (value) => value.charCodeAt(0));
        if (!bytes.length || result.mimeType !== 'audio/wav') throw new Error('O Windows não retornou um áudio WAV válido.');
        this.audioUrl = URL.createObjectURL(new Blob([bytes], { type: result.mimeType }));
        const audio = new Audio(this.audioUrl);
        this.audio = audio;
        audio.volume = this.current.volume;
        await new Promise<void>((resolve, reject) => {
          this.finishPlayback = resolve;
          audio.onended = () => resolve();
          audio.onerror = () => reject(new Error('Não foi possível reproduzir o áudio. Verifique a saída de som do Windows.'));
          void audio.play().catch(() => reject(new Error('A reprodução foi bloqueada. Use o botão de ouvir resposta para tentar novamente.')));
        });
        if (operation !== this.operation || this.disposed || this.current.muted) return;
        this.releasePlayback();
      }
      if (operation === this.operation && !this.disposed) this.update({ status: 'idle' });
    } catch (error) {
      if (operation !== this.operation || this.disposed) return;
      this.update({ status: 'error', error: message(error) });
      throw error;
    } finally {
      if (operation === this.operation) this.releasePlayback();
    }
  }
}

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { JarvisVoiceController, MAX_RECORDING_BYTES, MAX_RECORDING_MS, SILENCE_MS } from './voice';

const mocks = vi.hoisted(() => ({ invoke: vi.fn(), isTauri: vi.fn(), transcribeAudio: vi.fn() }));
vi.mock('@tauri-apps/api/core', () => ({ invoke: mocks.invoke, isTauri: mocks.isTauri }));
vi.mock('./client', () => ({ transcribeAudio: mocks.transcribeAudio }));

const voice = { id: 'pt-local', name: 'Maria', language: 'pt-BR', local: true };
let amplitude = 0.1;
let trackStop: ReturnType<typeof vi.fn>;
let contextClose: ReturnType<typeof vi.fn>;
let getUserMedia: ReturnType<typeof vi.fn>;
let controller: JarvisVoiceController;

class RecorderMock {
  static latest: RecorderMock;
  static isTypeSupported = () => true;
  state = 'inactive';
  mimeType = 'audio/webm;codecs=opus';
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;
  constructor() { RecorderMock.latest = this; }
  start() { this.state = 'recording'; }
  stop() {
    this.state = 'inactive';
    this.ondataavailable?.({ data: new Blob(['recorded-audio']) });
    queueMicrotask(() => this.onstop?.());
  }
}

class ContextMock {
  state = 'running';
  close = contextClose;
  resume = vi.fn().mockResolvedValue(undefined);
  createMediaStreamSource = () => ({ connect: vi.fn(), disconnect: vi.fn() });
  createAnalyser = () => ({ fftSize: 1024, disconnect: vi.fn(), getFloatTimeDomainData: (data: Float32Array) => data.fill(amplitude) });
}

class AudioMock {
  static latest: AudioMock;
  static fail = false;
  volume = 1;
  onended: (() => void) | null = null;
  onerror: (() => void) | null = null;
  pause = vi.fn();
  load = vi.fn();
  removeAttribute = vi.fn();
  play = vi.fn(() => AudioMock.fail ? Promise.reject(new Error('autoplay')) : Promise.resolve());
  constructor() { AudioMock.latest = this; }
}

describe('voz JARVIS: contratos e recursos (áudio físico não testado)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval', 'performance'] });
    mocks.invoke.mockReset();
    mocks.isTauri.mockReturnValue(true);
    mocks.transcribeAudio.mockReset().mockResolvedValue('Explique mitose.');
    amplitude = 0.1;
    trackStop = vi.fn();
    contextClose = vi.fn().mockResolvedValue(undefined);
    getUserMedia = vi.fn().mockResolvedValue({ getTracks: () => [{ stop: trackStop }] });
    vi.stubGlobal('navigator', { mediaDevices: { getUserMedia } });
    vi.stubGlobal('MediaRecorder', RecorderMock);
    vi.stubGlobal('AudioContext', ContextMock);
    vi.stubGlobal('Audio', AudioMock);
    AudioMock.fail = false;
    vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:jarvis-test');
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => undefined);
    controller = new JarvisVoiceController();
  });

  afterEach(() => { controller.dispose(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.useRealTimers(); });

  it('captura somente por chamada explícita e encerra após silêncio para transcrever pt-BR', async () => {
    expect(getUserMedia).not.toHaveBeenCalled();
    const pending = controller.startListening('gemini-test');
    await vi.advanceTimersByTimeAsync(200);
    amplitude = 0;
    await vi.advanceTimersByTimeAsync(SILENCE_MS);
    expect(await pending).toBe('Explique mitose.');
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeAudio).toHaveBeenCalledWith(expect.objectContaining({ model: 'gemini-test', mimeType: 'audio/webm', language: 'pt-BR', durationMs: 1500, audioBase64: btoa('recorded-audio') }), expect.any(AbortSignal));
    expect(controller.snapshot.status).toBe('idle');
  });

  it('encerra a gravação no limite de 30 segundos', async () => {
    const pending = controller.startListening('gemini-test');
    await vi.advanceTimersByTimeAsync(MAX_RECORDING_MS);
    await pending;
    expect(mocks.transcribeAudio.mock.calls[0][0].durationMs).toBe(MAX_RECORDING_MS);
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('cancelar e desmontar descartam áudio, fecham contexto e soltam microfone', async () => {
    const pending = controller.startListening('gemini-test');
    await vi.advanceTimersByTimeAsync(100);
    controller.dispose();
    expect(await pending).toBeNull();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('solta microfone cuja autorização chega depois do cancelamento', async () => {
    let permit!: (stream: unknown) => void;
    getUserMedia.mockImplementation(() => new Promise((resolve) => { permit = resolve; }));
    const pending = controller.startListening('gemini-test');
    controller.cancel();
    permit({ getTracks: () => [{ stop: trackStop }] });
    expect(await pending).toBeNull();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
  });

  it('bloqueia upload acima de 10 MiB e limpa captura', async () => {
    const pending = controller.startListening('gemini-test');
    const assertion = expect(pending).rejects.toThrow('10 MiB');
    await vi.advanceTimersByTimeAsync(10);
    RecorderMock.latest.ondataavailable?.({ data: { size: MAX_RECORDING_BYTES + 1 } as Blob });
    await assertion;
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(trackStop).toHaveBeenCalledTimes(1);
    expect(contextClose).toHaveBeenCalledTimes(1);
  });

  it('sem fala não envia gravação silenciosa e exibe erro real', async () => {
    amplitude = 0;
    const pending = controller.startListening('gemini-test');
    const assertion = expect(pending).rejects.toThrow('Nenhuma fala');
    await vi.advanceTimersByTimeAsync(5000);
    await assertion;
    expect(mocks.transcribeAudio).not.toHaveBeenCalled();
    expect(controller.snapshot.status).toBe('error');
    expect(trackStop).toHaveBeenCalledTimes(1);
  });

  it('propaga abort à transcrição e ignora resultado tardio', async () => {
    let finish!: (text: string) => void;
    mocks.transcribeAudio.mockImplementation(() => new Promise((resolve) => { finish = resolve; }));
    const pending = controller.startListening('gemini-test');
    await vi.advanceTimersByTimeAsync(100);
    controller.finishListening();
    await vi.advanceTimersByTimeAsync(0);
    expect(controller.snapshot.status).toBe('transcribing');
    const signal = mocks.transcribeAudio.mock.calls[0][1] as AbortSignal;
    controller.cancel();
    expect(signal.aborted).toBe(true);
    finish('resultado antigo');
    expect(await pending).toBeNull();
    expect(controller.snapshot.status).toBe('idle');
  });

  it('lista vozes instaladas, sintetiza localmente, chama play e controla volume e mute', async () => {
    mocks.invoke.mockResolvedValueOnce([voice]).mockResolvedValueOnce({ audioBase64: btoa('RIFFtestWAVE'), mimeType: 'audio/wav' });
    await controller.initialize();
    expect(controller.snapshot.voiceId).toBe(voice.id);
    controller.setVolume(0.4);
    const playing = controller.speak('Resposta local');
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.invoke).toHaveBeenLastCalledWith('jarvis_synthesize', { input: { text: 'Resposta local', voiceId: voice.id } });
    expect(AudioMock.latest.play).toHaveBeenCalledTimes(1);
    expect(AudioMock.latest.volume).toBe(0.4);
    controller.setVolume(0.2);
    expect(AudioMock.latest.volume).toBe(0.2);
    controller.setMuted(true);
    await playing;
    expect(AudioMock.latest.pause).toHaveBeenCalled();
    expect(URL.revokeObjectURL).toHaveBeenCalledWith('blob:jarvis-test');
    expect(controller.snapshot).toMatchObject({ status: 'idle', muted: true });
    await controller.speak('silenciado');
    expect(mocks.invoke).toHaveBeenCalledTimes(2);
  });

  it('rejeição de play expõe erro e revoga URL', async () => {
    mocks.invoke.mockResolvedValueOnce([voice]).mockResolvedValueOnce({ audioBase64: btoa('RIFFtestWAVE'), mimeType: 'audio/wav' });
    await controller.initialize();
    AudioMock.fail = true;
    await expect(controller.speak('teste')).rejects.toThrow('reprodução foi bloqueada');
    expect(controller.snapshot.status).toBe('error');
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(AudioMock.latest.pause).toHaveBeenCalled();
  });

  it('voz pt-BR ausente gera diagnóstico sem inventar uma voz', async () => {
    mocks.invoke.mockResolvedValue([{ ...voice, id: 'en', language: 'en-US' }]);
    await controller.initialize();
    expect(controller.snapshot).toMatchObject({ status: 'error', voiceId: null });
    expect(controller.snapshot.error).toContain('pt-BR');
    controller.setVoice('en');
    expect(controller.snapshot.voiceId).toBe('en');
  });

  it('lê a resposta longa completa em WAVs sequenciais e libera cada áudio entre trechos', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'jarvis_list_voices' ? [voice] : { audioBase64: btoa('RIFFtestWAVE'), mimeType: 'audio/wav' }));
    await controller.initialize();
    const text = 'A revisão espaçada ajuda a aprender.\n\n'.repeat(700);
    const playing = controller.speak(text);
    await vi.advanceTimersByTimeAsync(0);
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'jarvis_synthesize')).toHaveLength(1);
    const played: AudioMock[] = [];
    for (let attempt = 0; controller.snapshot.status === 'speaking' && attempt < 10; attempt += 1) {
      const audio = AudioMock.latest;
      played.push(audio);
      audio.onended?.();
      await vi.advanceTimersByTimeAsync(0);
      expect(audio.pause).toHaveBeenCalledTimes(1);
      expect(URL.revokeObjectURL).toHaveBeenCalledTimes(played.length);
    }
    await playing;
    const sent = mocks.invoke.mock.calls.filter(([command]) => command === 'jarvis_synthesize').map(([, payload]) => payload.input.text as string);
    expect(sent.length).toBeGreaterThan(1);
    expect(sent.every((chunk) => chunk.length <= 8000)).toBe(true);
    expect(sent.join('')).toBe(text);
    expect(played.every((audio) => audio.play.mock.calls.length === 1)).toBe(true);
    expect(controller.snapshot.status).toBe('idle');
  });

  it('cancelar entre trechos impede a síntese e reprodução do trecho seguinte', async () => {
    mocks.invoke.mockImplementation((command: string) => Promise.resolve(command === 'jarvis_list_voices' ? [voice] : { audioBase64: btoa('RIFFtestWAVE'), mimeType: 'audio/wav' }));
    await controller.initialize();
    const playing = controller.speak('Uma resposta extensa para estudar. '.repeat(400));
    await vi.advanceTimersByTimeAsync(0);
    AudioMock.latest.onended?.();
    controller.cancel();
    await playing;
    expect(mocks.invoke.mock.calls.filter(([command]) => command === 'jarvis_synthesize')).toHaveLength(1);
    expect(URL.revokeObjectURL).toHaveBeenCalledTimes(1);
    expect(controller.snapshot.status).toBe('idle');
  });

  it('resposta acima do limite gera aviso e nunca sofre corte silencioso', async () => {
    mocks.invoke.mockResolvedValue([voice]);
    await controller.initialize();
    await expect(controller.speak('a'.repeat(32001))).rejects.toThrow('32000 caracteres');
    expect(controller.snapshot.status).toBe('error');
    expect(mocks.invoke).toHaveBeenCalledTimes(1);
    expect(URL.createObjectURL).not.toHaveBeenCalled();
  });
});

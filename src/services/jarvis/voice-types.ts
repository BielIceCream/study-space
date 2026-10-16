export type JarvisVoiceStatus = 'idle' | 'listening' | 'transcribing' | 'speaking' | 'error';

export interface JarvisVoice {
  id: string;
  name: string;
  language: string;
  local: boolean;
}

export interface JarvisVoiceSnapshot {
  status: JarvisVoiceStatus;
  error: string | null;
  level: number;
  muted: boolean;
  volume: number;
  voiceId: string | null;
  voices: JarvisVoice[];
}

export interface JarvisSynthesizedAudio {
  audioBase64: string;
  mimeType: string;
}

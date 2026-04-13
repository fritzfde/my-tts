export type MicTriggerMode = 'auto' | 'suggest';

export type MicVoiceProfile = {
  version: number;
  sampleRate: number;
  frameCount: number;
  vector: number[];
};

export type MicSettingsState = {
  asrBaseUrl: string;
  language: string;
  triggerMode: MicTriggerMode;
  voiceGateEnabled: boolean;
  voiceProfile: MicVoiceProfile | null;
  voicePreviewDataUrl: string;
  voiceMatchThreshold: number;
};

export type MicHealth = {
  ok: boolean;
  service: string;
  whisperModel: string;
  whisperDevice: string;
  whisperComputeType: string;
  whisperVadFilter: boolean;
  vadMode: number;
  frameMs: number;
};

export type MicTranscriptEventType = 'final' | 'ignored' | 'speaker_ignored' | 'system' | 'error';

export type MicTranscriptEvent = {
  id: string;
  type: MicTranscriptEventType;
  text: string;
  detail: string;
  language: string;
  confidence: number;
  durationMs: number;
  voiceSimilarity: number;
  voiceThreshold: number;
  timestamp: number;
};

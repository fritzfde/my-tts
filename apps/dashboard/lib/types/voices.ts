export type VoiceGroupKey = 'custom' | 'en' | 'de' | 'es' | 'uk' | 'ru' | 'other';

export type VoiceEntry = {
  id: string;
  name: string;
  groupKey: VoiceGroupKey;
  isCloned: boolean;
  isHidden: boolean;
};

export type VoiceGroup = {
  key: VoiceGroupKey;
  label: string;
  voices: VoiceEntry[];
};

export type BrowserVoice = {
  id: string;
  name: string;
  lang: string;
};

export type VoicesSettingsState = {
  youtubeDefaultVoice: string;
  tiktokDefaultVoice: string;
  autoGenderDetection: boolean;
  defaultMaleVoice: string;
  defaultFemaleVoice: string;
  ollamaBaseUrl: string;
  customVoiceLanguages: Record<string, string>;
  hiddenVoices: string[];
  enabledLanguages: string[];
  userVoices: Record<string, string>;
  recentUsers: string[];
  userDisplayNames: Record<string, string>;
  previewText: string;
  previewVolume: number;
};


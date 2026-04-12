export type SoundFile = {
  name: string;
  path: string;
};

export type SoundEventType =
  | 'gift_any'
  | 'gift_name'
  | 'gift_value'
  | 'follow'
  | 'share'
  | 'join'
  | 'leave';

export type SoundAlertRule = {
  id: string;
  eventType: SoundEventType;
  eventValue: string;
  soundPath: string;
  enabled: boolean;
  recurringOnly: boolean;
  minStaySeconds: number;
};

export type SoundSettingsState = {
  keywordFilter: string;
  globalVolume: number;
  viewerChatTriggersEnabled: boolean;
  soundKeywords: Record<string, string[]>;
  soundKeywordEnabled: Record<string, boolean>;
  soundVoiceKeywordEnabled: Record<string, boolean>;
  soundVolumes: Record<string, number>;
  rules: SoundAlertRule[];
};

export type SoundSettingsDraft = {
  keywordsText: string;
  viewerChatEnabled: boolean;
  voiceEnabled: boolean;
  volume: number;
};

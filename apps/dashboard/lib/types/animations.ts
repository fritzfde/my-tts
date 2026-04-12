export type AnimationFile = {
  filename: string;
  name: string;
  path: string;
  thumbnailPath: string;
  mtimeMs: number | null;
  birthtimeMs: number | null;
  durationSeconds: number | null;
};

export type AnimationMapping = {
  file: string;
  position: string;
  scale: number;
  volume: number;
  keywords: string[];
  keywordTriggerEnabled: boolean;
  voiceKeywordTriggerEnabled: boolean;
};

export type AnimationConfig = {
  enabled: boolean;
  mappings: Record<string, AnimationMapping>;
  globalPosition: string;
  globalScale: number;
  animationVolume: number;
  chroma: {
    greenThreshold: number;
    tolerance: number;
    spillReduction: number;
  };
};

export type AnimationUiState = {
  keywordFilter: string;
  viewerChatTriggersEnabled: boolean;
};

export type AnimationUsage = {
  defaultGift: boolean;
  giftNames: string[];
  giftValues: string[];
  events: string[];
  stickers: string[];
};

export type AnimationDraft = {
  position: string;
  scale: number;
  volume: number;
  keywordsText: string;
  viewerChatEnabled: boolean;
  voiceEnabled: boolean;
};

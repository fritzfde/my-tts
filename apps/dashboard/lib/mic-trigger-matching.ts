import type { AnimationConfig, AnimationFile } from '@/lib/types/animations';
import type { SoundFile } from '@/lib/types/sounds';

export type MicAnimationMatch = {
  kind: 'animation';
  trigger: string;
  label: string;
  keyword: string;
  filename: string;
  thumbnailPath: string;
  durationSeconds: number | null;
  score: number;
};

export type MicSoundMatch = {
  kind: 'sound';
  soundPath: string;
  label: string;
  keyword: string;
  score: number;
};

function normalizeForMatch(value: string) {
  return String(value || '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function keywordScore(keyword: string) {
  return normalizeForMatch(keyword).length;
}

function keywordMatchesTranscript(keyword: string, transcript: string) {
  const normalizedKeyword = normalizeForMatch(keyword);
  const normalizedTranscript = normalizeForMatch(transcript);
  if (!normalizedKeyword || !normalizedTranscript) return false;
  return ` ${normalizedTranscript} `.includes(` ${normalizedKeyword} `);
}

export function findMicAnimationMatches(
  transcript: string,
  config: AnimationConfig,
  animations: AnimationFile[]
) {
  const matches: MicAnimationMatch[] = [];

  Object.entries(config.mappings).forEach(([trigger, mapping]) => {
    if (!mapping.voiceKeywordTriggerEnabled || mapping.keywords.length === 0) return;
    const matchingKeyword = mapping.keywords.find((keyword) => keywordMatchesTranscript(keyword, transcript));
    if (!matchingKeyword) return;

    const file = animations.find((entry) => entry.filename === mapping.file);
    matches.push({
      kind: 'animation',
      trigger,
      label: file?.name || trigger,
      keyword: matchingKeyword,
      filename: mapping.file,
      thumbnailPath: file?.thumbnailPath || '',
      durationSeconds: file?.durationSeconds ?? null,
      score: keywordScore(matchingKeyword)
    });
  });

  return matches.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

export function findMicSoundMatches(
  transcript: string,
  sounds: SoundFile[],
  soundKeywords: Record<string, string[]>,
  soundVoiceKeywordEnabled: Record<string, boolean>
) {
  const matches: MicSoundMatch[] = [];

  sounds.forEach((sound) => {
    if (soundVoiceKeywordEnabled[sound.path] !== true) return;
    const keywords = soundKeywords[sound.path] || [];
    if (keywords.length === 0) return;
    const matchingKeyword = keywords.find((keyword) => keywordMatchesTranscript(keyword, transcript));
    if (!matchingKeyword) return;

    matches.push({
      kind: 'sound',
      soundPath: sound.path,
      label: sound.name,
      keyword: matchingKeyword,
      score: keywordScore(matchingKeyword)
    });
  });

  return matches.sort((left, right) => right.score - left.score || left.label.localeCompare(right.label));
}

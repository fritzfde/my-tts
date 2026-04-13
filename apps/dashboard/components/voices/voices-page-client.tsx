'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { saveSettings } from '@/lib/api/settings';
import { listClonedVoices, synthesizeClonedVoicePreview } from '@/lib/api/voices';
import {
  buildVoicesSettingsRecord,
  buildVoiceGroups,
  CLONED_VOICE_LANGUAGE_OPTIONS,
  DEFAULT_OLLAMA_BASE_URL,
  findVoiceEntryById,
  MUTE_VOICE_ID,
  parseRecentUserKey,
  VOICE_GROUP_LABELS
} from '@/lib/voices-settings';
import { useVoicesStore } from '@/lib/stores/voices-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { BrowserVoice, VoiceEntry, VoiceGroup, VoicesSettingsState } from '@/lib/types/voices';

type VoicesPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialClonedVoices: string[];
};

function normalizeSystemVoices(voices: SpeechSynthesisVoice[]): BrowserVoice[] {
  return voices.map((voice, index) => ({
    id: `system-${index}`,
    name: voice.name,
    lang: voice.lang
  }));
}

function buildGroupedSelectOptions(groups: VoiceGroup[], selectedVoiceId = '', includeDefault = false) {
  const options: Array<{
    label: string;
    options: Array<{ value: string; label: string }>;
  }> = [];

  if (includeDefault) {
    options.push({
      label: 'Defaults',
      options: [
        { value: '', label: 'Use platform default' },
        { value: MUTE_VOICE_ID, label: 'Mute user (no TTS)' }
      ]
    });
  }

  groups.forEach((group) => {
    options.push({
      label: group.label,
      options: group.voices.map((entry) => ({
        value: entry.id,
        label: entry.name
      }))
    });
  });

  if (selectedVoiceId) {
    const known = options.some((group) => group.options.some((option) => option.value === selectedVoiceId));
    if (!known) {
      options.push({
        label: 'Unavailable',
        options: [{ value: selectedVoiceId, label: `${selectedVoiceId} (unavailable)` }]
      });
    }
  }

  return options;
}

function getVoiceDisplayName(groups: VoiceGroup[], voiceId: string) {
  if (!voiceId) return 'Platform default';
  if (voiceId === MUTE_VOICE_ID) return 'Muted';
  const entry = findVoiceEntryById(groups, voiceId);
  return entry ? entry.name : voiceId;
}

export function VoicesPageClient({
  initialScope,
  initialSettings,
  initialClonedVoices
}: VoicesPageClientProps) {
  const hydrate = useVoicesStore((state) => state.hydrate);
  const hydrated = useVoicesStore((state) => state.hydrated);
  const scope = useVoicesStore((state) => state.scope);
  const rawSettings = useVoicesStore((state) => state.rawSettings);
  const clonedVoices = useVoicesStore((state) => state.clonedVoices);
  const youtubeDefaultVoice = useVoicesStore((state) => state.youtubeDefaultVoice);
  const tiktokDefaultVoice = useVoicesStore((state) => state.tiktokDefaultVoice);
  const autoGenderDetection = useVoicesStore((state) => state.autoGenderDetection);
  const defaultMaleVoice = useVoicesStore((state) => state.defaultMaleVoice);
  const defaultFemaleVoice = useVoicesStore((state) => state.defaultFemaleVoice);
  const ollamaBaseUrl = useVoicesStore((state) => state.ollamaBaseUrl);
  const customVoiceLanguages = useVoicesStore((state) => state.customVoiceLanguages);
  const hiddenVoices = useVoicesStore((state) => state.hiddenVoices);
  const enabledLanguages = useVoicesStore((state) => state.enabledLanguages);
  const userVoices = useVoicesStore((state) => state.userVoices);
  const recentUsers = useVoicesStore((state) => state.recentUsers);
  const userDisplayNames = useVoicesStore((state) => state.userDisplayNames);
  const previewText = useVoicesStore((state) => state.previewText);
  const previewVolume = useVoicesStore((state) => state.previewVolume);
  const notice = useVoicesStore((state) => state.notice);
  const error = useVoicesStore((state) => state.error);
  const setClonedVoices = useVoicesStore((state) => state.setClonedVoices);
  const commitSettingsState = useVoicesStore((state) => state.commitSettingsState);
  const setNotice = useVoicesStore((state) => state.setNotice);
  const setError = useVoicesStore((state) => state.setError);

  const [systemVoices, setSystemVoices] = useState<BrowserVoice[]>([]);
  const [activePreviewVoiceId, setActivePreviewVoiceId] = useState('');
  const [isRefreshingClones, setIsRefreshingClones] = useState(false);
  const [userFilter, setUserFilter] = useState('');
  const initializedRef = useRef(false);
  const previewAudioRef = useRef<HTMLAudioElement | null>(null);
  const previewAudioUrlRef = useRef<string | null>(null);
  const previewTextTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewVolumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings,
      clonedVoices: initialClonedVoices
    });
    initializedRef.current = true;
  }, [hydrate, initialScope, initialSettings, initialClonedVoices]);

  useEffect(() => {
    if (typeof window === 'undefined' || !window.speechSynthesis) return undefined;
    const updateVoices = () => {
      setSystemVoices(normalizeSystemVoices(window.speechSynthesis.getVoices()));
    };
    updateVoices();
    window.speechSynthesis.onvoiceschanged = updateVoices;

    return () => {
      window.speechSynthesis.onvoiceschanged = null;
    };
  }, []);

  useEffect(() => {
    return () => {
      if (previewTextTimerRef.current) clearTimeout(previewTextTimerRef.current);
      if (previewVolumeTimerRef.current) clearTimeout(previewVolumeTimerRef.current);
      stopPreview();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const currentSettingsState = useMemo<VoicesSettingsState>(
    () => ({
      youtubeDefaultVoice,
      tiktokDefaultVoice,
      autoGenderDetection,
      defaultMaleVoice,
      defaultFemaleVoice,
      ollamaBaseUrl,
      customVoiceLanguages,
      hiddenVoices,
      enabledLanguages,
      userVoices,
      recentUsers,
      userDisplayNames,
      previewText,
      previewVolume
    }),
    [
      autoGenderDetection,
      customVoiceLanguages,
      defaultFemaleVoice,
      defaultMaleVoice,
      enabledLanguages,
      hiddenVoices,
      ollamaBaseUrl,
      previewText,
      previewVolume,
      recentUsers,
      tiktokDefaultVoice,
      userDisplayNames,
      userVoices,
      youtubeDefaultVoice
    ]
  );

  const visibleVoiceGroups = useMemo(
    () =>
      buildVoiceGroups({
        systemVoices,
        clonedVoices,
        hiddenVoices,
        enabledLanguages,
        includeHidden: false
      }),
    [clonedVoices, enabledLanguages, hiddenVoices, systemVoices]
  );

  const allVoiceGroups = useMemo(
    () =>
      buildVoiceGroups({
        systemVoices,
        clonedVoices,
        hiddenVoices,
        enabledLanguages,
        includeHidden: true
      }),
    [clonedVoices, enabledLanguages, hiddenVoices, systemVoices]
  );

  const browserVoiceGroups = useMemo(
    () => visibleVoiceGroups.filter((group) => group.key !== 'custom'),
    [visibleVoiceGroups]
  );

  const recentAssignments = useMemo(() => {
    const filter = userFilter.trim().toLowerCase();
    return recentUsers
      .map((userKey) => {
        const { platform, username } = parseRecentUserKey(userKey);
        const displayName = userDisplayNames[userKey] || username;
        return {
          key: userKey,
          platform,
          username,
          displayName,
          assignedVoiceId: userVoices[userKey] || ''
        };
      })
      .filter((entry) => {
        if (!filter) return true;
        return [entry.username, entry.displayName, entry.platform].join(' ').toLowerCase().includes(filter);
      });
  }, [recentUsers, userDisplayNames, userVoices, userFilter]);

  const assignedCount = useMemo(
    () => Object.keys(userVoices).filter((key) => Boolean(userVoices[key])).length,
    [userVoices]
  );

  async function persistSettingsState(nextState: VoicesSettingsState, nextRawSettings?: PersistedSettingsRecord) {
    const resolvedRawSettings = nextRawSettings || buildVoicesSettingsRecord(rawSettings, nextState);
    await saveSettings(resolvedRawSettings, scope);
    commitSettingsState(nextState, resolvedRawSettings);
  }

  function stopPreview() {
    if (typeof window !== 'undefined' && window.speechSynthesis) {
      window.speechSynthesis.cancel();
    }
    if (previewAudioRef.current) {
      previewAudioRef.current.pause();
      previewAudioRef.current = null;
    }
    if (previewAudioUrlRef.current) {
      URL.revokeObjectURL(previewAudioUrlRef.current);
      previewAudioUrlRef.current = null;
    }
    setActivePreviewVoiceId('');
  }

  async function previewVoice(voiceId: string) {
    if (!voiceId) {
      setNotice('No voice selected to preview.');
      return;
    }
    if (voiceId === MUTE_VOICE_ID) {
      setNotice('Muted users do not produce TTS audio.');
      return;
    }
    if (activePreviewVoiceId === voiceId) {
      stopPreview();
      return;
    }

    stopPreview();
    setActivePreviewVoiceId(voiceId);

    try {
      if (voiceId.startsWith('cloned-')) {
        const voiceName = voiceId.replace(/^cloned-/, '');
        const blob = await synthesizeClonedVoicePreview({
          voiceName,
          text: previewText,
          language: customVoiceLanguages[voiceName] || 'en'
        });
        const url = URL.createObjectURL(blob);
        previewAudioUrlRef.current = url;
        const audio = new Audio(url);
        audio.volume = previewVolume / 100;
        audio.addEventListener('ended', () => {
          if (previewAudioRef.current === audio) {
            stopPreview();
          }
        });
        previewAudioRef.current = audio;
        await audio.play();
        return;
      }

      const voice = systemVoices.find((entry) => entry.id === voiceId);
      if (!voice || typeof window === 'undefined' || !window.speechSynthesis) {
        throw new Error('Selected browser voice is not available');
      }

      const utterance = new SpeechSynthesisUtterance(previewText);
      const voiceIndex = Number(voiceId.replace('system-', ''));
      const nativeVoice = window.speechSynthesis.getVoices()[voiceIndex] || null;
      if (nativeVoice) {
        utterance.voice = nativeVoice;
      }
      utterance.volume = previewVolume / 100;
      utterance.onend = () => {
        setActivePreviewVoiceId('');
      };
      utterance.onerror = () => {
        setActivePreviewVoiceId('');
      };
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      stopPreview();
      setError(err instanceof Error ? err.message : 'Failed to preview voice');
    }
  }

  async function applySettingsUpdate(
    updater: (current: VoicesSettingsState) => VoicesSettingsState,
    successMessage?: string
  ) {
    try {
      const nextState = updater(currentSettingsState);
      await persistSettingsState(nextState);
      if (successMessage) {
        setNotice(successMessage);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save voice settings');
    }
  }

  async function refreshClonedVoices() {
    setIsRefreshingClones(true);
    try {
      const nextVoices = await listClonedVoices();
      setClonedVoices(nextVoices);
      setNotice(`Cloned voices refreshed (${nextVoices.length} found).`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh cloned voices');
    } finally {
      setIsRefreshingClones(false);
    }
  }

  function handlePreviewTextChange(value: string) {
    const nextState = {
      ...currentSettingsState,
      previewText: value
    };
    commitSettingsState(nextState);

    if (previewTextTimerRef.current) clearTimeout(previewTextTimerRef.current);
    previewTextTimerRef.current = setTimeout(() => {
      void persistSettingsState(nextState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save preview text');
      });
    }, 300);
  }

  function handlePreviewVolumeChange(value: number) {
    const nextState = {
      ...currentSettingsState,
      previewVolume: value
    };
    commitSettingsState(nextState);

    if (previewVolumeTimerRef.current) clearTimeout(previewVolumeTimerRef.current);
    previewVolumeTimerRef.current = setTimeout(() => {
      void persistSettingsState(nextState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save preview volume');
      });
    }, 250);
  }

  return (
    <section className="voices-page">
      <header className="voices-page-hero">
        <div>
          <p className="feature-page-eyebrow">Third Real React Slice</p>
          <h2>Voices</h2>
          <p className="voices-page-summary">
            This page now owns the core voice workspace: platform defaults, cloned voices, per-user assignments, and
            the Ollama auto-assign defaults. Browser system voices come from the local device, while cloned voices are
            still loaded from the legacy backend.
          </p>
        </div>
        <div className="voices-page-stats" aria-label="Voice workspace stats">
          <article>
            <span>System voices</span>
            <strong>{systemVoices.length}</strong>
          </article>
          <article>
            <span>Cloned voices</span>
            <strong>{clonedVoices.length}</strong>
          </article>
          <article>
            <span>User overrides</span>
            <strong>{assignedCount}</strong>
          </article>
        </div>
      </header>

      <section className="voices-preview-panel">
        <div className="voices-panel-header">
          <div>
            <h3>Preview settings</h3>
            <span>Used by the preview buttons on this page</span>
          </div>
        </div>
        <div className="voices-preview-grid">
          <label className="voices-field">
            <span>Preview text</span>
            <textarea
              rows={4}
              value={previewText}
              onChange={(event) => handlePreviewTextChange(event.target.value)}
              placeholder="Preview what the voice sounds like"
            />
          </label>

          <label className="voices-field">
            <span>Preview volume</span>
            <div className="voices-range-row">
              <input
                type="range"
                min="0"
                max="100"
                step="1"
                value={previewVolume}
                onChange={(event) => handlePreviewVolumeChange(Number(event.target.value))}
              />
              <strong>{previewVolume}%</strong>
            </div>
          </label>
        </div>
      </section>

      {(notice || error) && (
        <div className={error ? 'voices-feedback voices-feedback-error' : 'voices-feedback'} role="status">
          {error || notice}
        </div>
      )}

      <div className="voices-layout-grid">
        <section className="voices-platform-panel">
          <div className="voices-panel-header">
            <div>
              <h3>Platform defaults</h3>
              <span>Fallback voices used when a user has no explicit override</span>
            </div>
          </div>

          <div className="voices-field-grid">
            <label className="voices-field">
              <span>YouTube default voice</span>
              <select
                value={youtubeDefaultVoice}
                onChange={(event) =>
                  void applySettingsUpdate(
                    (current) => ({ ...current, youtubeDefaultVoice: event.target.value }),
                    'Saved YouTube default voice.'
                  )
                }
              >
                {buildGroupedSelectOptions(visibleVoiceGroups, youtubeDefaultVoice).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={`${group.label}-${option.value || 'default'}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>

            <label className="voices-field">
              <span>TikTok default voice</span>
              <select
                value={tiktokDefaultVoice}
                onChange={(event) =>
                  void applySettingsUpdate(
                    (current) => ({ ...current, tiktokDefaultVoice: event.target.value }),
                    'Saved TikTok default voice.'
                  )
                }
              >
                {buildGroupedSelectOptions(visibleVoiceGroups, tiktokDefaultVoice).map((group) => (
                  <optgroup key={group.label} label={group.label}>
                    {group.options.map((option) => (
                      <option key={`${group.label}-${option.value || 'default'}`} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </optgroup>
                ))}
              </select>
            </label>
          </div>

          <div className="voices-auto-panel">
            <label className="voices-toggle">
              <input
                type="checkbox"
                checked={autoGenderDetection}
                onChange={(event) =>
                  void applySettingsUpdate(
                    (current) => ({ ...current, autoGenderDetection: event.target.checked }),
                    event.target.checked
                      ? 'Enabled Ollama auto voice assignment.'
                      : 'Disabled Ollama auto voice assignment.'
                  )
                }
              />
              <span>Use Ollama to auto-assign male/female voices for new users</span>
            </label>

            <label className="voices-field">
              <span>Ollama base URL</span>
              <input
                type="text"
                value={ollamaBaseUrl}
                onChange={(event) => {
                  const nextState = { ...currentSettingsState, ollamaBaseUrl: event.target.value };
                  commitSettingsState(nextState);
                }}
                onBlur={() =>
                  void applySettingsUpdate(
                    (current) => ({
                      ...current,
                      ollamaBaseUrl: current.ollamaBaseUrl || DEFAULT_OLLAMA_BASE_URL
                    }),
                    'Saved Ollama base URL.'
                  )
                }
                placeholder={DEFAULT_OLLAMA_BASE_URL}
              />
            </label>

            <div className="voices-field-grid">
              <label className="voices-field">
                <span>Default male voice</span>
                <select
                  value={defaultMaleVoice}
                  onChange={(event) =>
                    void applySettingsUpdate(
                      (current) => ({ ...current, defaultMaleVoice: event.target.value }),
                      'Saved default male voice.'
                    )
                  }
                >
                  {buildGroupedSelectOptions(visibleVoiceGroups, defaultMaleVoice).map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={`${group.label}-${option.value || 'default'}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>

              <label className="voices-field">
                <span>Default female voice</span>
                <select
                  value={defaultFemaleVoice}
                  onChange={(event) =>
                    void applySettingsUpdate(
                      (current) => ({ ...current, defaultFemaleVoice: event.target.value }),
                      'Saved default female voice.'
                    )
                  }
                >
                  {buildGroupedSelectOptions(visibleVoiceGroups, defaultFemaleVoice).map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={`${group.label}-${option.value || 'default'}`} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
            </div>
          </div>
        </section>

        <section className="voices-users-panel">
          <div className="voices-panel-header">
            <div>
              <h3>Recent users</h3>
              <span>Voice overrides are stored per platform + username</span>
            </div>
            <label className="voices-field voices-field-search">
              <span>Filter users</span>
              <input
                type="search"
                value={userFilter}
                onChange={(event) => setUserFilter(event.target.value)}
                placeholder="Search username or platform"
              />
            </label>
          </div>

          {recentAssignments.length === 0 ? (
            <div className="voices-empty-state">No recent users have been captured yet.</div>
          ) : (
            <div className="voices-user-list">
              {recentAssignments.map((entry) => {
                const voiceLabel = getVoiceDisplayName(allVoiceGroups, entry.assignedVoiceId);
                const fallbackVoiceId = entry.platform === 'youtube' ? youtubeDefaultVoice : tiktokDefaultVoice;
                const previewVoiceId = entry.assignedVoiceId || fallbackVoiceId;
                return (
                  <article key={entry.key} className="voices-user-card">
                    <div className="voices-user-meta">
                      <strong>{entry.displayName}</strong>
                      <span>@{entry.username}</span>
                      <span className={`voices-platform-badge ${entry.platform}`}>{entry.platform}</span>
                    </div>

                    <label className="voices-field">
                      <span>Assigned voice</span>
                      <select
                        value={entry.assignedVoiceId}
                        onChange={(event) =>
                          void applySettingsUpdate(
                            (current) => ({
                              ...current,
                              userVoices: event.target.value
                                ? { ...current.userVoices, [entry.key]: event.target.value }
                                : Object.fromEntries(
                                    Object.entries(current.userVoices).filter(([key]) => key !== entry.key)
                                  )
                            }),
                            event.target.value
                              ? `Assigned ${getVoiceDisplayName(allVoiceGroups, event.target.value)} to ${entry.displayName}.`
                              : `Reset ${entry.displayName} to platform default.`
                          )
                        }
                      >
                        {buildGroupedSelectOptions(visibleVoiceGroups, entry.assignedVoiceId, true).map((group) => (
                          <optgroup key={group.label} label={group.label}>
                            {group.options.map((option) => (
                              <option key={option.value || `${group.label}-default`} value={option.value}>
                                {option.label}
                              </option>
                            ))}
                          </optgroup>
                        ))}
                      </select>
                    </label>

                    <div className="voices-user-actions">
                      <span className="voices-user-current">{voiceLabel}</span>
                      <button
                        type="button"
                        className="voices-secondary-button"
                        onClick={() => void previewVoice(previewVoiceId)}
                        disabled={!previewVoiceId}
                      >
                        {activePreviewVoiceId === previewVoiceId ? 'Stop preview' : 'Preview'}
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          )}
        </section>
      </div>

      <div className="voices-library-grid">
        <section className="voices-cloned-panel">
          <div className="voices-panel-header">
            <div>
              <h3>Cloned voices</h3>
              <span>Loaded from the legacy voice folder</span>
            </div>
            <button type="button" className="voices-secondary-button" onClick={() => void refreshClonedVoices()}>
              {isRefreshingClones ? 'Refreshing…' : 'Refresh cloned voices'}
            </button>
          </div>

          {clonedVoices.length === 0 ? (
            <div className="voices-empty-state">No cloned voices are available yet.</div>
          ) : (
            <div className="voices-cloned-list">
              {clonedVoices.map((voiceName) => {
                const voiceId = `cloned-${voiceName}`;
                const language = customVoiceLanguages[voiceName] || 'en';
                return (
                  <article key={voiceName} className="voices-cloned-card">
                    <div>
                      <strong>{voiceName}</strong>
                      <span>{VOICE_GROUP_LABELS.custom}</span>
                    </div>
                    <label className="voices-field">
                      <span>TTS language</span>
                      <select
                        value={language}
                        onChange={(event) =>
                          void applySettingsUpdate(
                            (current) => ({
                              ...current,
                              customVoiceLanguages: {
                                ...current.customVoiceLanguages,
                                [voiceName]: event.target.value
                              }
                            }),
                            `Saved language for ${voiceName}.`
                          )
                        }
                      >
                        {CLONED_VOICE_LANGUAGE_OPTIONS.map((option) => (
                          <option key={option.code} value={option.code}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <button
                      type="button"
                      className="voices-secondary-button"
                      onClick={() => void previewVoice(voiceId)}
                    >
                      {activePreviewVoiceId === voiceId ? 'Stop preview' : 'Preview'}
                    </button>
                  </article>
                );
              })}
            </div>
          )}
        </section>

        <section className="voices-browser-panel">
          <div className="voices-panel-header">
            <div>
              <h3>Available voices</h3>
              <span>System voices come from this browser session</span>
            </div>
          </div>

          {browserVoiceGroups.length === 0 ? (
            <div className="voices-empty-state">No browser voices are available yet.</div>
          ) : (
            <div className="voices-browser-groups">
              {browserVoiceGroups.map((group) => (
                <section key={group.key} className="voices-browser-group">
                  <div className="voices-browser-group-header">
                    <h4>{group.label}</h4>
                    <span>{group.voices.length} voices</span>
                  </div>
                  <div className="voices-browser-entries">
                    {group.voices.map((voice) => (
                      <div key={voice.id} className="voices-browser-entry">
                        <div>
                          <strong>{voice.name}</strong>
                          <span>{voice.isCloned ? 'Cloned voice' : voice.id}</span>
                        </div>
                        <button
                          type="button"
                          className="voices-secondary-button"
                          onClick={() => void previewVoice(voice.id)}
                        >
                          {activePreviewVoiceId === voice.id ? 'Stop preview' : 'Preview'}
                        </button>
                      </div>
                    ))}
                  </div>
                </section>
              ))}
            </div>
          )}
        </section>
      </div>
    </section>
  );
}

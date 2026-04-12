'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import {
  deleteAnimationFile,
  generateAnimationKeywords,
  listAnimations,
  saveAnimationConfig,
  stopLiveAnimations,
  triggerLiveAnimation,
  uploadAnimation
} from '@/lib/api/animations';
import { saveSettings } from '@/lib/api/settings';
import { legacyMediaUrl } from '@/lib/api/config';
import {
  applyAnimationDraft,
  buildAnimationDraft,
  buildAnimationSettingsRecord,
  formatAnimationDuration,
  getAnimationUsage,
  normalizeAnimationConfig,
  removeAnimationTriggerReferences,
  syncAnimationMappingsWithFiles
} from '@/lib/animations-settings';
import { useAnimationsStore } from '@/lib/stores/animations-store';
import type { PersistedSettingsRecord } from '@/lib/types/settings';
import type { AnimationConfig, AnimationDraft, AnimationFile, AnimationUiState } from '@/lib/types/animations';

type AnimationsPageClientProps = {
  initialScope: string;
  initialSettings: PersistedSettingsRecord;
  initialConfig: AnimationConfig;
  initialAnimations: AnimationFile[];
};

const POSITION_OPTIONS = [
  { value: 'bottom-left', label: 'Bottom left' },
  { value: 'bottom-right', label: 'Bottom right' },
  { value: 'top-left', label: 'Top left' },
  { value: 'top-right', label: 'Top right' },
  { value: 'center', label: 'Center' }
];

function areMappingsEqual(left: AnimationConfig['mappings'], right: AnimationConfig['mappings']) {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function AnimationsPageClient({
  initialScope,
  initialSettings,
  initialConfig,
  initialAnimations
}: AnimationsPageClientProps) {
  const hydrate = useAnimationsStore((state) => state.hydrate);
  const hydrated = useAnimationsStore((state) => state.hydrated);
  const scope = useAnimationsStore((state) => state.scope);
  const rawSettings = useAnimationsStore((state) => state.rawSettings);
  const config = useAnimationsStore((state) => state.config);
  const animations = useAnimationsStore((state) => state.animations);
  const selectedTrigger = useAnimationsStore((state) => state.selectedTrigger);
  const activeTrigger = useAnimationsStore((state) => state.activeTrigger);
  const keywordFilter = useAnimationsStore((state) => state.keywordFilter);
  const viewerChatTriggersEnabled = useAnimationsStore((state) => state.viewerChatTriggersEnabled);
  const notice = useAnimationsStore((state) => state.notice);
  const error = useAnimationsStore((state) => state.error);
  const setKeywordFilter = useAnimationsStore((state) => state.setKeywordFilter);
  const setViewerChatTriggersEnabled = useAnimationsStore((state) => state.setViewerChatTriggersEnabled);
  const setConfig = useAnimationsStore((state) => state.setConfig);
  const setAnimations = useAnimationsStore((state) => state.setAnimations);
  const setSelectedTrigger = useAnimationsStore((state) => state.setSelectedTrigger);
  const setActiveTrigger = useAnimationsStore((state) => state.setActiveTrigger);
  const commitUiState = useAnimationsStore((state) => state.commitUiState);
  const replaceConfig = useAnimationsStore((state) => state.replaceConfig);
  const setNotice = useAnimationsStore((state) => state.setNotice);
  const setError = useAnimationsStore((state) => state.setError);

  const [draft, setDraft] = useState<AnimationDraft | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isUploading, setIsUploading] = useState(false);
  const [isGenerating, setIsGenerating] = useState(false);
  const [isStoppingLive, setIsStoppingLive] = useState(false);
  const initializedRef = useRef(false);
  const filterPersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const gatePersistTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (initializedRef.current) return;
    hydrate({
      scope: initialScope,
      rawSettings: initialSettings,
      config: initialConfig,
      animations: initialAnimations
    });
    initializedRef.current = true;
  }, [hydrate, initialConfig, initialScope, initialSettings, initialAnimations]);

  useEffect(() => {
    return () => {
      if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
      if (gatePersistTimerRef.current) clearTimeout(gatePersistTimerRef.current);
    };
  }, []);

  const currentUiState = useMemo<AnimationUiState>(
    () => ({ keywordFilter, viewerChatTriggersEnabled }),
    [keywordFilter, viewerChatTriggersEnabled]
  );

  const selectedMapping = selectedTrigger ? config.mappings[selectedTrigger] || null : null;
  const selectedAnimation = useMemo(
    () => animations.find((entry) => entry.filename === selectedMapping?.file) || null,
    [animations, selectedMapping]
  );

  useEffect(() => {
    if (!selectedMapping) {
      setDraft(null);
      return;
    }
    setDraft(buildAnimationDraft(selectedMapping));
  }, [selectedMapping, selectedTrigger]);

  async function persistUiState(nextUiState: AnimationUiState, nextRawSettings?: PersistedSettingsRecord) {
    const resolvedRawSettings = nextRawSettings || buildAnimationSettingsRecord(rawSettings, nextUiState, config);
    await saveSettings(resolvedRawSettings, scope);
    commitUiState(nextUiState, resolvedRawSettings);
  }

  async function persistConfig(nextConfig: AnimationConfig, nextRawSettings?: PersistedSettingsRecord) {
    const normalizedConfig = normalizeAnimationConfig(nextConfig);
    const resolvedRawSettings = nextRawSettings || buildAnimationSettingsRecord(rawSettings, currentUiState, normalizedConfig);
    await saveAnimationConfig(normalizedConfig);
    await saveSettings(resolvedRawSettings, scope);
    replaceConfig(normalizedConfig, resolvedRawSettings);
  }

  useEffect(() => {
    if (!hydrated) return;
    if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    filterPersistTimerRef.current = setTimeout(() => {
      void persistUiState(currentUiState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save animation filter');
      });
    }, 350);

    return () => {
      if (filterPersistTimerRef.current) clearTimeout(filterPersistTimerRef.current);
    };
  }, [currentUiState, hydrated, keywordFilter, setError]);

  useEffect(() => {
    if (!hydrated) return;
    if (gatePersistTimerRef.current) clearTimeout(gatePersistTimerRef.current);
    gatePersistTimerRef.current = setTimeout(() => {
      void persistUiState(currentUiState).catch((err) => {
        setError(err instanceof Error ? err.message : 'Failed to save animation viewer chat gate');
      });
    }, 250);

    return () => {
      if (gatePersistTimerRef.current) clearTimeout(gatePersistTimerRef.current);
    };
  }, [currentUiState, hydrated, setError, viewerChatTriggersEnabled]);

  const animationCards = useMemo(() => {
    const entries = Object.entries(config.mappings).map(([trigger, mapping]) => {
      const file = animations.find((entry) => entry.filename === mapping.file) || null;
      return {
        trigger,
        mapping,
        file,
        keywordSummary: mapping.keywords.length > 0
          ? `${mapping.keywords.length} keyword${mapping.keywords.length === 1 ? '' : 's'}`
          : 'No keywords'
      };
    });

    const filtered = keywordFilter
      ? entries.filter((entry) => {
          const haystack = [
            entry.trigger,
            entry.mapping.file,
            entry.file?.name || '',
            ...entry.mapping.keywords
          ].join(' ').toLowerCase();
          return haystack.includes(keywordFilter);
        })
      : entries;

    return filtered.sort((left, right) => left.trigger.localeCompare(right.trigger));
  }, [animations, config.mappings, keywordFilter]);

  const usage = useMemo(
    () => (selectedTrigger ? getAnimationUsage(selectedTrigger, rawSettings) : null),
    [rawSettings, selectedTrigger]
  );

  async function refreshAnimationsLibrary({ quiet = false } = {}) {
    setIsRefreshing(true);
    try {
      const nextAnimations = await listAnimations();
      const nextMappings = syncAnimationMappingsWithFiles(config.mappings, nextAnimations);
      const nextConfig = {
        ...config,
        mappings: nextMappings
      };

      setAnimations(nextAnimations);
      if (!areMappingsEqual(config.mappings, nextMappings)) {
        await persistConfig(nextConfig);
      }

      if (!quiet) {
        setNotice(`Animation library refreshed (${nextAnimations.length} files).`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to refresh animations');
    } finally {
      setIsRefreshing(false);
    }
  }

  async function handlePlayLive(trigger: string) {
    if (!trigger) return;
    if (activeTrigger === trigger) {
      await handleStopLive();
      return;
    }

    try {
      const result = await triggerLiveAnimation(trigger);
      if (result.clients > 0) {
        setActiveTrigger(trigger);
        setNotice(
          result.obsClients > 0
            ? `Playing ${trigger} live.`
            : `Triggered ${trigger}, but only browser overlay clients are connected.`
        );
      } else {
        setActiveTrigger('');
        setNotice(`Triggered ${trigger}, but no animation overlay clients are connected.`);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to play animation live');
    }
  }

  async function handleStopLive() {
    setIsStoppingLive(true);
    try {
      await stopLiveAnimations();
      setActiveTrigger('');
      setNotice('Stopped live animation playback.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to stop live animations');
    } finally {
      setIsStoppingLive(false);
    }
  }

  async function handleSaveDraft() {
    if (!selectedTrigger || !selectedMapping || !draft) return;
    setIsSaving(true);
    try {
      const nextConfig: AnimationConfig = {
        ...config,
        mappings: {
          ...config.mappings,
          [selectedTrigger]: applyAnimationDraft(selectedMapping, draft)
        }
      };
      await persistConfig(nextConfig);
      setNotice(`Saved animation settings for ${selectedTrigger}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save animation settings');
    } finally {
      setIsSaving(false);
    }
  }

  async function handleGenerateKeywords() {
    if (!selectedTrigger || !selectedMapping?.file) return;
    setIsGenerating(true);
    try {
      const result = await generateAnimationKeywords(selectedMapping.file);
      setDraft((current) => ({
        position: current?.position || selectedMapping.position,
        scale: current?.scale || selectedMapping.scale,
        volume: current?.volume || selectedMapping.volume,
        keywordsText: result.keywords.join('\n'),
        viewerChatEnabled: true,
        voiceEnabled: true
      }));
      setNotice(
        result.warning
          ? `Keywords generated with warning: ${result.warning}`
          : `Keywords generated for ${selectedTrigger}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to generate animation keywords');
    } finally {
      setIsGenerating(false);
    }
  }

  async function handleUpload(fileList: FileList | null) {
    const file = fileList?.[0];
    if (!file) return;

    setIsUploading(true);
    try {
      const uploaded = await uploadAnimation(file);
      const nextAnimations = await listAnimations();
      const nextMappings = syncAnimationMappingsWithFiles(config.mappings, nextAnimations);
      const nextTrigger = Object.entries(nextMappings).find(([, mapping]) => mapping.file === uploaded.filename)?.[0] || '';
      const keywordResult = await generateAnimationKeywords(uploaded.filename).catch((keywordError) => ({
        keywords: [] as string[],
        warning: keywordError instanceof Error ? keywordError.message : 'Keyword generation failed'
      }));

      if (nextTrigger && keywordResult.keywords.length > 0) {
        nextMappings[nextTrigger] = {
          ...nextMappings[nextTrigger],
          keywords: keywordResult.keywords,
          keywordTriggerEnabled: true,
          voiceKeywordTriggerEnabled: true
        };
      }

      const nextConfig: AnimationConfig = {
        ...config,
        mappings: nextMappings
      };

      setAnimations(nextAnimations);
      if (nextTrigger) {
        setSelectedTrigger(nextTrigger);
      }
      await persistConfig(nextConfig);
      setNotice(
        keywordResult.warning
          ? `Uploaded ${uploaded.name}. Keywords generated with warning: ${keywordResult.warning}`
          : `Uploaded ${uploaded.name}.`
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to upload animation');
    } finally {
      setIsUploading(false);
    }
  }

  async function handleDeleteSelected() {
    if (!selectedTrigger || !selectedAnimation) return;
    if (!window.confirm(`Delete ${selectedAnimation.name}?`)) return;

    try {
      if (activeTrigger === selectedTrigger) {
        await handleStopLive();
      }
      await deleteAnimationFile(selectedAnimation.filename);

      const nextAnimations = animations.filter((entry) => entry.filename !== selectedAnimation.filename);
      const nextMappings = { ...config.mappings };
      delete nextMappings[selectedTrigger];
      const syncedMappings = syncAnimationMappingsWithFiles(nextMappings, nextAnimations);
      const nextConfig: AnimationConfig = {
        ...config,
        mappings: syncedMappings
      };
      const cleanedRawSettings = removeAnimationTriggerReferences(rawSettings, selectedTrigger);
      const nextRawSettings = buildAnimationSettingsRecord(cleanedRawSettings, currentUiState, nextConfig);

      setAnimations(nextAnimations);
      if (activeTrigger === selectedTrigger) {
        setActiveTrigger('');
      }
      await persistConfig(nextConfig, nextRawSettings);
      setNotice(`Deleted ${selectedAnimation.name}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete animation');
    }
  }

  async function handleGlobalEnabledChange(enabled: boolean) {
    try {
      const nextConfig = { ...config, enabled };
      setConfig(nextConfig);
      await persistConfig(nextConfig);
      setNotice(enabled ? 'Animations enabled globally.' : 'Animations disabled globally.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save animation enabled state');
    }
  }

  async function handleGlobalPositionChange(position: string) {
    try {
      const nextConfig = { ...config, globalPosition: position };
      setConfig(nextConfig);
      await persistConfig(nextConfig);
      setNotice(`Global animation position set to ${position}.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save animation position');
    }
  }

  async function handleGlobalVolumeCommit(nextVolume: number) {
    try {
      const nextConfig = { ...config, animationVolume: nextVolume };
      await persistConfig(nextConfig);
      setNotice(`Global animation volume set to ${nextVolume}%.`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save animation volume');
    }
  }

  return (
    <section className="animations-page">
      <header className="animations-page-hero">
        <div>
          <p className="feature-page-eyebrow">Second Real React Slice</p>
          <h2>Animation Overlay</h2>
          <p className="animations-page-summary">
            This page now edits the live animation config that powers the overlay, while keeping gift, event, and sticker
            references visible so we can migrate those cross-links safely in the next pass.
          </p>
        </div>
        <div className="animations-page-stats" aria-label="Animation library stats">
          <article>
            <span>Files</span>
            <strong>{animations.length}</strong>
          </article>
          <article>
            <span>Mappings</span>
            <strong>{Object.keys(config.mappings).length}</strong>
          </article>
          <article>
            <span>Live mode</span>
            <strong>{config.enabled ? 'On' : 'Off'}</strong>
          </article>
        </div>
      </header>

      <section className="animations-toolbar">
        <label className="animations-toolbar-field">
          <span>Filter by keyword</span>
          <input
            type="search"
            value={keywordFilter}
            onChange={(event) => setKeywordFilter(event.target.value)}
            placeholder="Search trigger, filename, or keyword"
          />
        </label>

        <label className="animations-toolbar-field animations-toolbar-volume">
          <span>Global animation volume</span>
          <div className="animations-toolbar-range-row">
            <input
              type="range"
              min="0"
              max="100"
              step="1"
              value={config.animationVolume}
              onChange={(event) => setConfig({ ...config, animationVolume: Number(event.target.value) })}
              onPointerUp={(event) => void handleGlobalVolumeCommit(Number((event.target as HTMLInputElement).value))}
              onKeyUp={(event) => {
                if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                  void handleGlobalVolumeCommit(Number((event.target as HTMLInputElement).value));
                }
              }}
              onBlur={(event) => void handleGlobalVolumeCommit(Number(event.target.value))}
            />
            <strong>{config.animationVolume}%</strong>
          </div>
        </label>

        <label className="animations-inline-toggle">
          <input
            type="checkbox"
            checked={config.enabled}
            onChange={(event) => void handleGlobalEnabledChange(event.target.checked)}
          />
          <span>Animations enabled globally</span>
        </label>

        <label className="animations-inline-toggle">
          <input
            type="checkbox"
            checked={viewerChatTriggersEnabled}
            onChange={(event) => setViewerChatTriggersEnabled(event.target.checked)}
          />
          <span>Viewer chat can trigger animations globally</span>
        </label>

        <label className="animations-toolbar-field animations-toolbar-field-compact">
          <span>Default position</span>
          <select value={config.globalPosition} onChange={(event) => void handleGlobalPositionChange(event.target.value)}>
            {POSITION_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
        </label>

        <div className="animations-toolbar-actions">
          <label className="animations-upload-button">
            <input type="file" accept=".mov,.mp4,.webm,.avi,video/*" onChange={(event) => void handleUpload(event.target.files)} />
            <span>{isUploading ? 'Uploading…' : 'Upload animation'}</span>
          </label>
          <button type="button" className="animations-secondary-button" onClick={() => void refreshAnimationsLibrary()}>
            {isRefreshing ? 'Refreshing…' : 'Refresh'}
          </button>
          <button
            type="button"
            className="animations-secondary-button"
            onClick={() => void handleStopLive()}
            disabled={!activeTrigger}
          >
            {isStoppingLive ? 'Stopping…' : 'Stop live'}
          </button>
        </div>
      </section>

      {(notice || error) && (
        <div className={error ? 'animations-feedback animations-feedback-error' : 'animations-feedback'} role="status">
          {error || notice}
        </div>
      )}

      <div className="animations-layout-grid">
        <section className="animations-library-panel">
          <div className="animations-panel-header">
            <h3>Library</h3>
            <span>{animationCards.length} visible</span>
          </div>

          <div className="animations-library-grid">
            {animationCards.length === 0 ? (
              <div className="animations-empty-state">No animations match the current filter.</div>
            ) : (
              animationCards.map(({ trigger, mapping, file, keywordSummary }) => {
                const isSelected = selectedTrigger === trigger;
                const isActive = activeTrigger === trigger;
                return (
                  <article
                    key={trigger}
                    className={`animation-card-react${isSelected ? ' is-selected' : ''}${isActive ? ' is-active' : ''}`}
                  >
                    <button type="button" className="animation-card-react-thumb" onClick={() => setSelectedTrigger(trigger)}>
                      {file?.thumbnailPath ? (
                        <img src={legacyMediaUrl(file.thumbnailPath)} alt={trigger} />
                      ) : (
                        <div className="animation-card-react-thumb-fallback">No thumbnail</div>
                      )}
                      <span className="animation-card-react-duration">
                        {formatAnimationDuration(file?.durationSeconds ?? null)}
                      </span>
                    </button>

                    <div className="animation-card-react-body">
                      <div>
                        <strong>{trigger}</strong>
                        <p>{file?.name || mapping.file}</p>
                      </div>
                      <span className="animation-card-react-summary">{keywordSummary}</span>
                    </div>

                    <div className="animation-card-react-actions">
                      <button type="button" className="animations-secondary-button" onClick={() => void handlePlayLive(trigger)}>
                        {isActive ? 'Stop live' : 'Play live'}
                      </button>
                      <button type="button" className="animations-secondary-button" onClick={() => setSelectedTrigger(trigger)}>
                        Settings
                      </button>
                    </div>
                  </article>
                );
              })
            )}
          </div>
        </section>

        <aside className="animations-editor-panel">
          <div className="animations-panel-header">
            <h3>Animation settings</h3>
            <span>{selectedTrigger || 'Select an animation'}</span>
          </div>

          {selectedTrigger && selectedMapping && draft ? (
            <div className="animations-editor-form">
              <div className="animations-editor-meta">
                <label className="animations-editor-field">
                  <span>Trigger name</span>
                  <input type="text" value={selectedTrigger} readOnly />
                </label>
                <label className="animations-editor-field">
                  <span>Source file</span>
                  <input type="text" value={selectedMapping.file} readOnly />
                </label>
              </div>

              <div className="animations-editor-actions">
                <button type="button" className="animations-secondary-button" onClick={() => void handlePlayLive(selectedTrigger)}>
                  {activeTrigger === selectedTrigger ? 'Stop live' : 'Play live'}
                </button>
                <button type="button" className="animations-secondary-button" onClick={() => void handleGenerateKeywords()}>
                  {isGenerating ? 'Generating…' : 'Generate keywords'}
                </button>
                <button type="button" className="animations-danger-button" onClick={() => void handleDeleteSelected()}>
                  Delete animation
                </button>
              </div>

              <div className="animations-editor-grid">
                <label className="animations-editor-field">
                  <span>Position</span>
                  <select
                    value={draft.position}
                    onChange={(event) => setDraft((current) => (current ? { ...current, position: event.target.value } : current))}
                  >
                    {POSITION_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                </label>

                <label className="animations-editor-field">
                  <span>Scale</span>
                  <input
                    type="number"
                    min="0.5"
                    max="3"
                    step="0.1"
                    value={draft.scale}
                    onChange={(event) => setDraft((current) => (current ? { ...current, scale: Number(event.target.value) } : current))}
                  />
                </label>
              </div>

              <label className="animations-editor-field">
                <span>Per-animation volume</span>
                <div className="animations-toolbar-range-row">
                  <input
                    type="range"
                    min="0"
                    max="100"
                    step="1"
                    value={draft.volume}
                    onChange={(event) => setDraft((current) => (current ? { ...current, volume: Number(event.target.value) } : current))}
                  />
                  <strong>{draft.volume}%</strong>
                </div>
              </label>

              <label className="animations-editor-field">
                <span>Keywords</span>
                <textarea
                  rows={8}
                  value={draft.keywordsText}
                  onChange={(event) => setDraft((current) => (current ? { ...current, keywordsText: event.target.value } : current))}
                  placeholder="One keyword per line"
                />
              </label>

              <div className="animations-editor-check-grid">
                <label className="animations-toggle">
                  <input
                    type="checkbox"
                    checked={draft.viewerChatEnabled}
                    onChange={(event) => setDraft((current) => (current ? { ...current, viewerChatEnabled: event.target.checked } : current))}
                  />
                  <span>Viewer chat can trigger this animation</span>
                </label>
                <label className="animations-toggle">
                  <input
                    type="checkbox"
                    checked={draft.voiceEnabled}
                    onChange={(event) => setDraft((current) => (current ? { ...current, voiceEnabled: event.target.checked } : current))}
                  />
                  <span>Voice trigger can activate this animation</span>
                </label>
              </div>

              {usage && (
                <section className="animations-usage-panel">
                  <div className="animations-panel-header">
                    <h4>Linked usage</h4>
                    <span>Read-only for now</span>
                  </div>
                  <div className="animations-usage-grid">
                    <div>
                      <span>Default gift</span>
                      <strong>{usage.defaultGift ? 'Yes' : 'No'}</strong>
                    </div>
                    <div>
                      <span>Gift names</span>
                      <strong>{usage.giftNames.length > 0 ? usage.giftNames.join(', ') : 'None'}</strong>
                    </div>
                    <div>
                      <span>Gift values</span>
                      <strong>{usage.giftValues.length > 0 ? usage.giftValues.join(', ') : 'None'}</strong>
                    </div>
                    <div>
                      <span>Events</span>
                      <strong>{usage.events.length > 0 ? usage.events.join(', ') : 'None'}</strong>
                    </div>
                    <div>
                      <span>Stickers</span>
                      <strong>{usage.stickers.length > 0 ? usage.stickers.join(', ') : 'None'}</strong>
                    </div>
                  </div>
                </section>
              )}

              <button type="button" className="animations-primary-button" onClick={() => void handleSaveDraft()}>
                {isSaving ? 'Saving…' : 'Save animation settings'}
              </button>
            </div>
          ) : (
            <div className="animations-empty-state animations-empty-state-editor">
              Select an animation from the library to edit its live config, keywords, and per-item volume.
            </div>
          )}
        </aside>
      </div>
    </section>
  );
}

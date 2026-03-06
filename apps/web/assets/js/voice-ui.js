(function initVoiceUiModule() {
  function createVoiceUiController({
    windowRef,
    documentRef,
    voicesController,
    voiceGroupOrder,
    voiceGroupLabels,
    defaultTestMessage,
    hiddenVoices,
    enabledLanguages,
    getRecentUsers,
    getVoiceForUser,
    setVoiceForUser,
    removeVoiceForUser,
    saveUserVoices,
    getUserDisplayName,
    getVoiceName,
    buildVoiceGroups,
    findVoiceEntryById,
    buildVoiceOptionsMarkup,
    getAllVoiceEntries,
    clonedVoiceLanguageOptions,
    getCustomVoiceLanguage,
    setCustomVoiceLanguage,
    saveCustomVoiceLanguages,
    loadVoices,
    speakWithCustomVoice,
    unlockAudio,
    synth,
    resolveSystemVoice,
    getPlatformDefaultVoice,
    getSpeechSettings,
    getTestMessage,
    getVoicePreviewText,
    setVoicePreviewText,
    persistTestMessage,
    escapeAttribute,
    escapeHtml,
    addChatMessage
  }) {
    const MUTE_VOICE_ID = 'mute-user';
    const DEFAULT_CLONED_LANGUAGE = 'en';
    const win = windowRef || window;
    const doc = documentRef || document;
    const customVoiceLanguageOptions = Array.isArray(clonedVoiceLanguageOptions) && clonedVoiceLanguageOptions.length > 0
      ? clonedVoiceLanguageOptions
      : [{ code: DEFAULT_CLONED_LANGUAGE, label: 'English' }];

    const elements = {
      manageVoicesBtn: doc.getElementById('manageVoicesBtn'),
      voiceModal: doc.getElementById('voiceModal'),
      voiceModalPanel: doc.querySelector('#voiceModal .modal'),
      voiceModalTitle: doc.getElementById('voiceModalTitle'),
      voiceModalSubtitle: doc.getElementById('voiceModalSubtitle'),
      userVoiceList: doc.getElementById('userVoiceList'),
      toggleVoiceFilterBtn: doc.getElementById('toggleVoiceFilter'),
      voiceFilterPanel: doc.getElementById('voiceFilterPanel'),
      voiceFilterIcon: doc.getElementById('voiceFilterIcon'),
      voicePreviewList: doc.getElementById('voicePreviewList'),
      voicePreviewText: doc.getElementById('voicePreviewText'),
      hideAllVoicesBtn: doc.getElementById('hideAllVoicesBtn'),
      showAllVoicesBtn: doc.getElementById('showAllVoicesBtn'),
      hiddenVoicesContainer: doc.getElementById('hiddenVoicesContainer'),
      hiddenVoicesList: doc.getElementById('hiddenVoicesList')
    };

    function parseRecentUserKey(userKey) {
      const text = String(userKey || '');
      const separatorIndex = text.indexOf(':');
      if (separatorIndex < 0) {
        return { platform: 'youtube', username: text };
      }
      return {
        platform: text.slice(0, separatorIndex) || 'youtube',
        username: text.slice(separatorIndex + 1)
      };
    }

    function getVoiceGroupsForModal() {
      return buildVoiceGroups({ includeHidden: false });
    }

    function getVoiceGroupKeyForVoiceId(voiceId) {
      const entry = findVoiceEntryById(voiceId);
      if (entry && entry.groupKey) return entry.groupKey;
      const firstGroup = getVoiceGroupsForModal()[0];
      return firstGroup ? firstGroup.key : '';
    }

    function buildVoiceGroupOptionsMarkup(selectedGroupKey = '') {
      const groups = getVoiceGroupsForModal();
      if (groups.length === 0) {
        return { markup: '<option value="">No language groups</option>', selectedGroupKey: '' };
      }

      const resolvedGroupKey = groups.some((group) => group.key === selectedGroupKey)
        ? selectedGroupKey
        : groups[0].key;

      const markup = groups.map((group) => {
        const selectedAttr = group.key === resolvedGroupKey ? ' selected' : '';
        return `<option value="${escapeAttribute(group.key)}"${selectedAttr}>${escapeHtml(group.label)}</option>`;
      }).join('');

      return { markup, selectedGroupKey: resolvedGroupKey };
    }

    function buildVoiceOptionsMarkupForGroup(groupKey = '', selectedVoiceId = '') {
      const groups = getVoiceGroupsForModal();
      if (groups.length === 0) {
        return {
          markup: `
            <option value=""${selectedVoiceId ? '' : ' selected'}>Use platform default</option>
            <option value="${escapeAttribute(MUTE_VOICE_ID)}"${selectedVoiceId === MUTE_VOICE_ID ? ' selected' : ''}>🔇 Mute user (no TTS)</option>
            <option value="" disabled>No voices available</option>
          `,
          selectedVoiceId: '',
          resolvedGroupKey: ''
        };
      }

      const targetGroup = groups.find((group) => group.key === groupKey) || groups[0];
      const isMutedSelection = selectedVoiceId === MUTE_VOICE_ID;
      const hasSelectedVoice = selectedVoiceId
        ? targetGroup.voices.some((entry) => entry.id === selectedVoiceId)
        : false;
      const resolvedVoiceId = isMutedSelection
        ? MUTE_VOICE_ID
        : (hasSelectedVoice ? selectedVoiceId : '');

      const baseOptions = `
        <option value=""${resolvedVoiceId === '' ? ' selected' : ''}>Use platform default</option>
        <option value="${escapeAttribute(MUTE_VOICE_ID)}"${resolvedVoiceId === MUTE_VOICE_ID ? ' selected' : ''}>🔇 Mute user (no TTS)</option>
      `;

      const voiceOptions = targetGroup.voices.length > 0
        ? targetGroup.voices.map((entry) => {
          const selectedAttr = entry.id === resolvedVoiceId ? ' selected' : '';
          return `<option value="${escapeAttribute(entry.id)}"${selectedAttr}>${escapeHtml(entry.name)}</option>`;
        }).join('')
        : '<option value="" disabled>No voices in this group</option>';

      return {
        markup: `${baseOptions}${voiceOptions}`,
        selectedVoiceId: resolvedVoiceId,
        resolvedGroupKey: targetGroup.key
      };
    }

    function buildCustomVoiceLanguageOptionsMarkup(selectedCode = DEFAULT_CLONED_LANGUAGE) {
      const normalizedSelected = String(selectedCode || '').trim().toLowerCase() || DEFAULT_CLONED_LANGUAGE;
      return customVoiceLanguageOptions.map((entry) => {
        const code = String(entry?.code || '').trim().toLowerCase();
        const label = String(entry?.label || code || '').trim();
        if (!code || !label) return '';
        const selectedAttr = code === normalizedSelected ? ' selected' : '';
        return `<option value="${escapeAttribute(code)}"${selectedAttr}>${escapeHtml(label)}</option>`;
      }).join('');
    }

    function setVoiceModalHeader(title, subtitle) {
      if (elements.voiceModalTitle) elements.voiceModalTitle.textContent = title;
      if (elements.voiceModalSubtitle) elements.voiceModalSubtitle.textContent = subtitle;
    }

    function setVoiceModalWideLayout(enabled) {
      if (!elements.voiceModalPanel) return;
      elements.voiceModalPanel.classList.toggle('voice-modal-wide', Boolean(enabled));
    }

    function closeVoiceModal() {
      if (!elements.voiceModal) return;
      elements.voiceModal.style.display = 'none';
    }

    function bindManageVoicesModalControls(container) {
      if (!container) return;

      container.querySelectorAll('.user-voice-group-select').forEach((groupSelect) => {
        groupSelect.addEventListener('change', () => {
          const card = groupSelect.closest('.user-voice-item');
          if (!card) return;

          const voiceSelect = card.querySelector('.user-voice-select');
          if (!voiceSelect) return;

          const username = card.dataset.username || '';
          const platform = card.dataset.platform || '';
          const previousVoice = voiceSelect.value || '';
          const nextGroup = groupSelect.value || '';
          const nextOptions = buildVoiceOptionsMarkupForGroup(nextGroup, previousVoice);
          const groupHint = card.querySelector('.user-voice-group-hint');

          voiceSelect.innerHTML = nextOptions.markup;
          if (nextOptions.selectedVoiceId) {
            voiceSelect.value = nextOptions.selectedVoiceId;
          }
          if (groupHint) {
            groupHint.textContent = voiceGroupLabels[nextOptions.resolvedGroupKey] || 'Voices';
          }

          // Group switch should not auto-assign a voice.
        });
      });

      container.querySelectorAll('.user-voice-select').forEach((voiceSelect) => {
        voiceSelect.addEventListener('change', () => {
          const card = voiceSelect.closest('.user-voice-item');
          if (!card) return;

          const username = card.dataset.username || '';
          const platform = card.dataset.platform || '';
          const selectedVoice = voiceSelect.value || '';
          if (!username || !platform) return;

          if (!selectedVoice) {
            removeVoiceForUser(username, platform);
            saveUserVoices();
            return;
          }

          setVoiceForUser(username, platform, selectedVoice);
        });
      });

      container.querySelectorAll('.user-voice-remove-btn').forEach((removeBtn) => {
        removeBtn.addEventListener('click', (event) => {
          event.preventDefault();
          const card = removeBtn.closest('.user-voice-item');
          if (!card) return;

          const username = card.dataset.username || '';
          const platform = card.dataset.platform || '';
          if (!username || !platform) return;

          removeUserVoice(username, platform);
        });
      });

      container.querySelectorAll('.user-voice-preview-btn').forEach((previewBtn) => {
        previewBtn.addEventListener('click', (event) => {
          event.preventDefault();
          const card = previewBtn.closest('.user-voice-item');
          if (!card) return;

          const platform = card.dataset.platform || '';
          const voiceSelect = card.querySelector('.user-voice-select');
          let voiceId = voiceSelect ? (voiceSelect.value || '') : '';
          if (!voiceId && typeof getPlatformDefaultVoice === 'function') {
            voiceId = getPlatformDefaultVoice(platform) || '';
          }

          if (!voiceId) {
            addChatMessage('SYSTEM', `No voice available to preview for ${platform || 'user'}`, 'SYSTEM', false);
            return;
          }

          if (voiceId === MUTE_VOICE_ID) {
            addChatMessage('SYSTEM', 'Muted user has no preview audio', 'SYSTEM', false);
            return;
          }

          previewVoice(voiceId);
        });
      });
    }

    function renderManageUserVoicesModal() {
      const modal = elements.voiceModal;
      const list = elements.userVoiceList;
      setVoiceModalWideLayout(true);
      setVoiceModalHeader(
        'Manage User Voices',
        'Assign voices by language group, then pick a specific voice.'
      );

      if (!list || !modal) return;
      list.classList.add('voice-grid-layout');

      const recentUsers = Array.isArray(getRecentUsers()) ? getRecentUsers() : [];
      if (recentUsers.length === 0) {
        list.innerHTML = '<p class="user-voice-empty" style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users yet.</p>';
        modal.style.display = 'flex';
        return;
      }

      const usersWithGroups = recentUsers.map((userKey) => {
        const parsed = parseRecentUserKey(userKey);
        const currentVoice = getVoiceForUser(parsed.username, parsed.platform);
        const initialGroup = getVoiceGroupKeyForVoiceId(currentVoice);
        const displayName = getUserDisplayName(parsed.username, parsed.platform) || parsed.username;
        return {
          platform: parsed.platform,
          username: parsed.username,
          displayName,
          currentVoice,
          initialGroup
        };
      }).sort((a, b) => {
        const aIndex = Math.max(0, voiceGroupOrder.indexOf(a.initialGroup));
        const bIndex = Math.max(0, voiceGroupOrder.indexOf(b.initialGroup));
        if (aIndex !== bIndex) return aIndex - bIndex;
        if (a.platform !== b.platform) return a.platform.localeCompare(b.platform);

        const byDisplayName = a.displayName.localeCompare(b.displayName, undefined, { sensitivity: 'base', numeric: true });
        if (byDisplayName !== 0) return byDisplayName;
        return a.username.localeCompare(b.username, undefined, { sensitivity: 'base', numeric: true });
      });

      list.innerHTML = usersWithGroups.map(({ platform, username, displayName, currentVoice, initialGroup }) => {
        const groupOptions = buildVoiceGroupOptionsMarkup(initialGroup);
        const voiceOptions = buildVoiceOptionsMarkupForGroup(groupOptions.selectedGroupKey, currentVoice);
        const groupLabel = voiceGroupLabels[groupOptions.selectedGroupKey] || 'Voices';

        const platformBadge = platform === 'youtube'
          ? '<span class="platform-badge youtube">YouTube</span>'
          : '<span class="platform-badge tiktok">TikTok</span>';

        return `
          <div class="user-voice-item voice-card" data-platform="${escapeAttribute(platform)}" data-username="${escapeAttribute(username)}">
            <div class="username">
              <span class="user-voice-name">
                ${platformBadge}
                <span class="user-voice-name-text" title="${escapeAttribute(username)}">${escapeHtml(displayName)}</span>
              </span>
              <span class="user-voice-group-hint" title="Current language group">${escapeHtml(groupLabel)}</span>
            </div>
            <div class="user-voice-controls-grid">
              <select class="user-voice-group-select" title="Language group">
                ${groupOptions.markup}
              </select>
              <select class="user-voice-select" title="Voice">
                ${voiceOptions.markup}
              </select>
              <button class="secondary user-voice-preview-btn" title="Preview selected voice">Preview</button>
              <button class="user-voice-remove-btn" title="Remove custom voice">Remove</button>
            </div>
          </div>
        `;
      }).join('');

      bindManageVoicesModalControls(list);
      modal.style.display = 'flex';
    }

    function openVoiceAssignment(username, platform) {
      const currentVoice = getVoiceForUser(username, platform);
      const displayName = getUserDisplayName(username, platform) || username;
      const modal = elements.voiceModal;
      const list = elements.userVoiceList;
      if (!modal || !list) return;

      setVoiceModalWideLayout(false);
      list.classList.remove('voice-grid-layout');

      const platformBadge = platform === 'youtube'
        ? '<span class="platform-badge youtube">YouTube</span>'
        : '<span class="platform-badge tiktok">TikTok</span>';
      const optionsMarkup = `
        <option value=""${currentVoice ? '' : ' selected'}>Use platform default</option>
        <option value="${escapeAttribute(MUTE_VOICE_ID)}"${currentVoice === MUTE_VOICE_ID ? ' selected' : ''}>🔇 Mute user (no TTS)</option>
        ${buildVoiceOptionsMarkup(currentVoice)}
      `;

      list.innerHTML = `
        <div class="user-voice-item">
          <div class="username" title="${escapeAttribute(username)}">${platformBadge}${escapeHtml(displayName)}</div>
          <select id="voiceSelectModal">
            ${optionsMarkup}
          </select>
          <button class="secondary" onclick="previewAssignedVoice('${username.replace(/'/g, "\\'")}', '${platform}')">Preview</button>
          <button onclick="assignVoice('${username.replace(/'/g, "\\'")}', '${platform}')">Set Voice</button>
        </div>
      `;

      modal.style.display = 'flex';
    }

    function assignVoice(username, platform) {
      const select = doc.getElementById('voiceSelectModal');
      if (!select) return;
      const voiceId = select.value;
      if (!voiceId) {
        removeVoiceForUser(username, platform);
        saveUserVoices();
      } else {
        setVoiceForUser(username, platform, voiceId);
      }
      closeVoiceModal();
    }

    function previewAssignedVoice(username, platform) {
      const select = doc.getElementById('voiceSelectModal');
      if (!select) return;

      let voiceId = select.value || '';
      if (!voiceId && typeof getPlatformDefaultVoice === 'function') {
        voiceId = getPlatformDefaultVoice(platform) || '';
      }

      if (!voiceId) {
        addChatMessage('SYSTEM', 'No voice available to preview', 'SYSTEM', false);
        return;
      }

      if (voiceId === MUTE_VOICE_ID) {
        addChatMessage('SYSTEM', 'Muted user has no preview audio', 'SYSTEM', false);
        return;
      }

      previewVoice(voiceId);
    }

    function removeUserVoice(username, platform) {
      removeVoiceForUser(username, platform);
      saveUserVoices();
      const displayName = getUserDisplayName(username, platform) || username;
      addChatMessage('SYSTEM', `Voice for "${displayName}" (@${username}, ${platform}) removed`, 'SYSTEM', false);
      renderManageUserVoicesModal();
    }

    function loadHiddenVoices() {
      voicesController.loadHiddenVoices();
      console.log(`✓ Loaded ${hiddenVoices.size} hidden voices`);
    }

    function saveHiddenVoices() {
      voicesController.saveHiddenVoices();
      console.log(`✓ Saved ${hiddenVoices.size} hidden voices`);
    }

    function previewVoice(voiceId) {
      const messageFromPreview = getVoicePreviewText();
      const messageFromMainInput = getTestMessage();
      const testMsg = messageFromPreview || messageFromMainInput || defaultTestMessage;

      if (voiceId.startsWith('cloned-')) {
        speakWithCustomVoice(voiceId, testMsg).then((result) => {
          if (result.isCloned) {
            result.audio.play().catch((error) => {
              console.warn('Audio preview blocked:', error);
              unlockAudio();
            });
          } else {
            synth.speak(result.utterance);
          }
        });
        return;
      }

      if (!voiceId.startsWith('system-')) return;
      const utterance = new SpeechSynthesisUtterance(testMsg);
      const systemVoice = resolveSystemVoice(voiceId);
      if (systemVoice) {
        utterance.voice = systemVoice;
      }

      const speechSettings = getSpeechSettings();
      utterance.rate = speechSettings.rate;
      utterance.pitch = speechSettings.pitch;
      utterance.volume = speechSettings.volume;

      synth.speak(utterance);
    }

    function populateVoicePreviewList() {
      if (!elements.voicePreviewList) return;
      elements.voicePreviewList.style.removeProperty('column-count');

      const groups = buildVoiceGroups({ includeHidden: true });
      if (groups.length === 0) {
        elements.voicePreviewList.innerHTML = '<div class="voice-list-empty">No voices available</div>';
        return;
      }

      elements.voicePreviewList.innerHTML = groups.map((group) => {
        const visibleCount = group.voices.filter((entry) => !entry.isHidden).length;
        const allHidden = visibleCount === 0;

        const voicesMarkup = group.voices.map((entry) => {
          const languageControl = entry.isCloned
            ? `<select class="voice-language-select" data-voice-name="${escapeAttribute(entry.name)}" title="TTS language for this cloned voice">${buildCustomVoiceLanguageOptionsMarkup(
              typeof getCustomVoiceLanguage === 'function'
                ? getCustomVoiceLanguage(entry.name)
                : DEFAULT_CLONED_LANGUAGE
            )}</select>`
            : '';

          return `
            <div class="voice-preview-item${entry.isHidden ? ' is-hidden' : ''}">
              <span class="voice-preview-name" title="${escapeAttribute(entry.name)}">${escapeHtml(entry.name)}</span>
              <div class="voice-preview-actions">
                ${languageControl}
                <button class="secondary preview-voice-btn" data-voice="${escapeAttribute(entry.id)}">Preview</button>
                <button class="secondary voice-visibility-btn" data-voice="${escapeAttribute(entry.id)}">${entry.isHidden ? 'Show' : 'Hide'}</button>
              </div>
            </div>
          `;
        }).join('');

        return `
          <div class="voice-filter-group">
            <div class="voice-filter-group-header">
              <span class="voice-filter-group-title">${escapeHtml(group.label)}</span>
              <div class="voice-filter-group-actions">
                <span class="voice-filter-group-count">${visibleCount}/${group.voices.length} shown</span>
                <button class="secondary voice-group-toggle-btn" data-group="${escapeAttribute(group.key)}" data-action="${allHidden ? 'show' : 'hide'}">
                  ${allHidden ? 'Show group' : 'Hide group'}
                </button>
              </div>
            </div>
            <div class="voice-filter-group-list">${voicesMarkup}</div>
          </div>
        `;
      }).join('');

      elements.voicePreviewList.querySelectorAll('.preview-voice-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const voiceId = btn.dataset.voice;
          if (!voiceId) return;
          previewVoice(voiceId);
        });
      });

      elements.voicePreviewList.querySelectorAll('.voice-language-select').forEach((select) => {
        select.addEventListener('change', (event) => {
          event.preventDefault();
          const voiceName = select.dataset.voiceName || '';
          const selectedLanguage = select.value || DEFAULT_CLONED_LANGUAGE;
          if (!voiceName || typeof setCustomVoiceLanguage !== 'function') return;

          const normalizedLanguage = setCustomVoiceLanguage(voiceName, selectedLanguage);
          if (typeof saveCustomVoiceLanguages === 'function') {
            saveCustomVoiceLanguages();
          }
          if (select.value !== normalizedLanguage) {
            select.value = normalizedLanguage;
          }
        });
      });

      elements.voicePreviewList.querySelectorAll('.voice-visibility-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const voiceId = btn.dataset.voice;
          if (!voiceId) return;

          if (hiddenVoices.has(voiceId)) {
            voicesController.showVoice(voiceId);
          } else {
            voicesController.hideVoice(voiceId);
          }

          saveHiddenVoices();
          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      });

      elements.voicePreviewList.querySelectorAll('.voice-group-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const groupKey = btn.dataset.group;
          const action = btn.dataset.action;
          if (!groupKey || !action) return;

          voicesController.toggleGroupHidden(groupKey, action);

          saveHiddenVoices();
          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      });
    }

    function populateHiddenVoicesList() {
      if (!elements.hiddenVoicesList || !elements.hiddenVoicesContainer) return;

      const hiddenEntries = getAllVoiceEntries({ includeHidden: true, ignoreLanguageFilters: true })
        .filter((entry) => hiddenVoices.has(entry.id))
        .sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { sensitivity: 'base', numeric: true }));

      if (hiddenEntries.length === 0) {
        elements.hiddenVoicesList.style.display = 'none';
        elements.hiddenVoicesContainer.innerHTML = '';
        return;
      }

      elements.hiddenVoicesList.style.display = 'block';

      elements.hiddenVoicesContainer.innerHTML = hiddenEntries.map((entry) => {
        return `
          <div class="hidden-voice-item">
            <span class="hidden-voice-name" title="${escapeAttribute(entry.name)}">${escapeHtml(entry.name)}</span>
            <button class="secondary unhide-voice-btn" data-voice="${escapeAttribute(entry.id)}">
              Restore
            </button>
          </div>
        `;
      }).join('');

      elements.hiddenVoicesContainer.querySelectorAll('.unhide-voice-btn').forEach((btn) => {
        btn.addEventListener('click', (event) => {
          event.preventDefault();
          const voiceId = btn.dataset.voice;
          if (!voiceId) return;
          voicesController.showVoice(voiceId);
          saveHiddenVoices();
          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      });
    }

    function loadLanguageFilters() {
      voicesController.loadLanguageFilters();

      doc.querySelectorAll('.lang-filter').forEach((checkbox) => {
        checkbox.checked = enabledLanguages.has(checkbox.dataset.lang);
      });

      console.log('✓ Loaded language filters:', Array.from(enabledLanguages));
    }

    function attachEvents() {
      if (elements.toggleVoiceFilterBtn && elements.voiceFilterPanel) {
        elements.toggleVoiceFilterBtn.addEventListener('click', () => {
          const isOpen = elements.voiceFilterPanel.style.display !== 'none';
          elements.voiceFilterPanel.style.display = isOpen ? 'none' : 'block';
          if (elements.voiceFilterIcon) {
            elements.voiceFilterIcon.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(180deg)';
          }

          if (!isOpen) {
            populateVoicePreviewList();
            populateHiddenVoicesList();
          }
        });
      }

      if (elements.showAllVoicesBtn) {
        elements.showAllVoicesBtn.addEventListener('click', () => {
          voicesController.showAllVoices();
          saveHiddenVoices();
          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      }

      if (elements.hideAllVoicesBtn) {
        elements.hideAllVoicesBtn.addEventListener('click', () => {
          voicesController.hideAllVoices();
          saveHiddenVoices();
          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      }

      if (elements.voicePreviewText) {
        elements.voicePreviewText.addEventListener('input', () => {
          const next = elements.voicePreviewText.value;
          if (getTestMessage() !== next) {
            setVoicePreviewText(next);
            persistTestMessage(next);
          }
        });
      }

      doc.querySelectorAll('.lang-filter').forEach((checkbox) => {
        checkbox.addEventListener('change', (event) => {
          const lang = event.target.dataset.lang;
          voicesController.setLanguageEnabled(lang, event.target.checked);
          voicesController.saveLanguageFilters();

          console.log(`✓ Language filter updated: ${lang} ${event.target.checked ? 'enabled' : 'disabled'}`);

          loadVoices();
          populateVoicePreviewList();
          populateHiddenVoicesList();
        });
      });

      if (elements.manageVoicesBtn) {
        elements.manageVoicesBtn.addEventListener('click', renderManageUserVoicesModal);
      }

      if (elements.voiceModal) {
        elements.voiceModal.addEventListener('click', (event) => {
          if (event.target === elements.voiceModal) {
            closeVoiceModal();
          }
        });
      }

      win.openVoiceAssignment = openVoiceAssignment;
      win.assignVoice = assignVoice;
      win.previewAssignedVoice = previewAssignedVoice;
      win.closeVoiceModal = closeVoiceModal;
      win.removeUserVoice = removeUserVoice;
    }

    return {
      parseRecentUserKey,
      getVoiceGroupsForModal,
      getVoiceGroupKeyForVoiceId,
      buildVoiceGroupOptionsMarkup,
      buildVoiceOptionsMarkupForGroup,
      setVoiceModalHeader,
      setVoiceModalWideLayout,
      renderManageUserVoicesModal,
      openVoiceAssignment,
      assignVoice,
      previewAssignedVoice,
      closeVoiceModal,
      removeUserVoice,
      loadHiddenVoices,
      saveHiddenVoices,
      previewVoice,
      populateVoicePreviewList,
      populateHiddenVoicesList,
      loadLanguageFilters,
      attachEvents
    };
  }

  window.createVoiceUiController = createVoiceUiController;
})();

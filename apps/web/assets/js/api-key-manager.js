(function initApiKeyManagerModule() {
  function createApiKeyManagerController({
    elements,
    onSave,
    onDuplicate,
    onDuplicateReset,
    getConnectivityState
  }) {
    const state = {
      apiKeys: [],
      currentKeyIndex: 0
    };

    function normalizeKeys(keys) {
      if (!Array.isArray(keys)) return [];
      return keys
        .map((key) => String(key || '').trim())
        .filter(Boolean);
    }

    function setKeys(keys, { resetIndex = true } = {}) {
      const normalized = normalizeKeys(keys);
      state.apiKeys.splice(0, state.apiKeys.length, ...normalized);
      if (resetIndex) {
        state.currentKeyIndex = 0;
      } else if (state.currentKeyIndex >= state.apiKeys.length) {
        state.currentKeyIndex = Math.max(0, state.apiKeys.length - 1);
      }
    }

    function getKeys() {
      return state.apiKeys;
    }

    function renderApiKeyTags() {
      if (!elements.apiKeyTagsContainer || !elements.apiKeyTextInput || !elements.apiKeyCountLabel) return;

      elements.apiKeyTagsContainer.querySelectorAll('.api-key-tag').forEach((tag) => tag.remove());

      state.apiKeys.forEach((key, index) => {
        const tag = document.createElement('div');
        tag.className = 'api-key-tag';
        tag.innerHTML = `
          <span class="key-text">${key.slice(0, 12)}…${key.slice(-4)}</span>
          <button class="key-remove" data-index="${index}" title="Remove">&times;</button>
        `;
        elements.apiKeyTagsContainer.insertBefore(tag, elements.apiKeyTextInput);
      });

      elements.apiKeyCountLabel.textContent = `${state.apiKeys.length} key${state.apiKeys.length !== 1 ? 's' : ''} added`;
      if (typeof onSave === 'function') {
        onSave();
      }
    }

    function pulseExistingTag(index) {
      const tags = elements.apiKeyTagsContainer
        ? elements.apiKeyTagsContainer.querySelectorAll('.api-key-tag')
        : [];
      if (!tags[index]) return;
      tags[index].style.animation = 'none';
      setTimeout(() => {
        tags[index].style.animation = 'pulse-highlight 0.6s ease';
      }, 10);
    }

    function addApiKey(key) {
      const normalized = String(key || '').trim();
      if (!normalized) return;

      if (state.apiKeys.includes(normalized)) {
        const existingIndex = state.apiKeys.indexOf(normalized);
        pulseExistingTag(existingIndex);

        if (typeof onDuplicate === 'function') {
          onDuplicate(normalized);
        }
        if (typeof onDuplicateReset === 'function') {
          onDuplicateReset();
        }
        return;
      }

      state.apiKeys.push(normalized);
      state.currentKeyIndex = 0;
      renderApiKeyTags();
    }

    function removeApiKey(index) {
      const numericIndex = Number(index);
      if (!Number.isInteger(numericIndex) || numericIndex < 0 || numericIndex >= state.apiKeys.length) {
        return;
      }
      state.apiKeys.splice(numericIndex, 1);
      state.currentKeyIndex = 0;
      renderApiKeyTags();
    }

    function getNextApiKey() {
      if (state.apiKeys.length === 0) return '';
      return state.apiKeys[state.currentKeyIndex];
    }

    function rotateToNextKey() {
      if (state.apiKeys.length <= 1) {
        console.warn('⚠️ Only 1 API key - cannot rotate');
        return false;
      }

      const oldIndex = state.currentKeyIndex;
      state.currentKeyIndex = (state.currentKeyIndex + 1) % state.apiKeys.length;
      console.log(`🔑 Rotated from key ${oldIndex + 1} to key ${state.currentKeyIndex + 1}/${state.apiKeys.length}`);
      return true;
    }

    function attachInputHandlers() {
      if (!elements.apiKeyTextInput || !elements.apiKeyTagsContainer) return;

      elements.apiKeyTextInput.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ',') {
          event.preventDefault();
          const value = elements.apiKeyTextInput.value.replace(/,/g, '').trim();
          if (value) {
            addApiKey(value);
            elements.apiKeyTextInput.value = '';
          }
        }
      });

      elements.apiKeyTextInput.addEventListener('paste', (event) => {
        event.preventDefault();
        const pasted = (event.clipboardData || window.clipboardData).getData('text');
        if (!pasted) return;
        pasted.split(',').forEach((key) => addApiKey(key));
        elements.apiKeyTextInput.value = '';
      });

      elements.apiKeyTextInput.addEventListener('blur', () => {
        const value = elements.apiKeyTextInput.value.replace(/,/g, '').trim();
        if (value) {
          addApiKey(value);
          elements.apiKeyTextInput.value = '';
        }
      });

      elements.apiKeyTagsContainer.addEventListener('click', (event) => {
        const target = event.target instanceof Element ? event.target : null;
        if (!target) return;
        const button = target.closest('.key-remove');
        if (button) {
          removeApiKey(Number(button.dataset.index));
        }
      });
    }

    function resetDuplicateStatusIfIdle() {
      if (typeof onDuplicateReset !== 'function') return;
      const connectivity = typeof getConnectivityState === 'function'
        ? getConnectivityState()
        : { youtubeConnected: false, tiktokConnected: false };

      if (!connectivity.youtubeConnected && !connectivity.tiktokConnected) {
        onDuplicateReset();
      }
    }

    return {
      state,
      setKeys,
      getKeys,
      renderApiKeyTags,
      addApiKey,
      removeApiKey,
      getNextApiKey,
      rotateToNextKey,
      attachInputHandlers,
      resetDuplicateStatusIfIdle
    };
  }

  window.createApiKeyManagerController = createApiKeyManagerController;
})();

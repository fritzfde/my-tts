(function initGiftSoundsModule() {
  function createGiftSoundsController({
    windowRef,
    documentRef,
    navigatorRef,
    settingsStore,
    elements = {},
    callbacks = {},
    fetchFn,
    confirmFn
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const nav = navigatorRef || (win && win.navigator ? win.navigator : null);
    const callFetch = typeof fetchFn === 'function'
      ? fetchFn
      : (win && typeof win.fetch === 'function' ? win.fetch.bind(win) : null);
    const callConfirm = typeof confirmFn === 'function'
      ? confirmFn
      : (win && typeof win.confirm === 'function' ? win.confirm.bind(win) : (() => true));

    const giftSoundSelect = elements.giftSoundSelect || doc?.getElementById?.('giftSoundSelect') || null;
    const customSoundUpload = elements.customSoundUpload || doc?.getElementById?.('customSoundUpload') || null;
    const uploadSoundBtn = elements.uploadSoundBtn || doc?.getElementById?.('uploadSoundBtn') || null;
    const customSoundManageSelect = elements.customSoundManageSelect || doc?.getElementById?.('customSoundManageSelect') || null;
    const deleteCustomSoundBtn = elements.deleteCustomSoundBtn || doc?.getElementById?.('deleteCustomSoundBtn') || null;
    const volumeSlider = elements.volumeSlider || doc?.getElementById?.('volumeSlider') || null;

    const state = {
      initialized: false,
      customGiftSounds: [],
      giftSoundSelectBaseMarkup: giftSoundSelect ? giftSoundSelect.innerHTML : ''
    };

    function getSliderVolume() {
      if (!volumeSlider) return 1;
      return Number(volumeSlider.value || 100) / 100;
    }

    function getCustomSoundValue(filename) {
      return `custom-/sounds/custom/${filename}`;
    }

    function populateCustomSoundManageSelect(selectedFilename = '') {
      if (!customSoundManageSelect || !doc) return;

      customSoundManageSelect.innerHTML = '<option value="">Custom sounds...</option>';
      state.customGiftSounds.forEach((sound) => {
        const option = doc.createElement('option');
        option.value = sound.filename;
        option.textContent = `🎵 ${sound.filename}`;
        if (selectedFilename && sound.filename === selectedFilename) {
          option.selected = true;
        }
        customSoundManageSelect.appendChild(option);
      });

      if (!selectedFilename && state.customGiftSounds.length === 0) {
        customSoundManageSelect.value = '';
      }
    }

    function rebuildGiftSoundSelect(selectedValue = '') {
      if (!giftSoundSelect || !doc) return;

      const preferredValue = selectedValue
        || settingsStore.getItem('gift_sound_preference')
        || giftSoundSelect.value
        || '';

      giftSoundSelect.innerHTML = state.giftSoundSelectBaseMarkup;

      state.customGiftSounds.forEach((sound) => {
        const option = doc.createElement('option');
        option.value = `custom-${sound.path}`;
        option.textContent = `🎵 ${sound.filename}`;
        giftSoundSelect.appendChild(option);
      });

      const hasPreferred = Array.from(giftSoundSelect.options).some((opt) => opt.value === preferredValue);
      giftSoundSelect.value = hasPreferred ? preferredValue : '';
      settingsStore.setItem('gift_sound_preference', giftSoundSelect.value);

      populateCustomSoundManageSelect();
      callbacks.renderGiftMappings?.();
    }

    function playBuiltInSound(type) {
      const ctx = callbacks.ensureAudioContext?.();
      if (!ctx) return;

      const now = ctx.currentTime;
      const oscillator = ctx.createOscillator();
      const gainNode = ctx.createGain();
      oscillator.connect(gainNode);
      gainNode.connect(ctx.destination);

      const volume = getSliderVolume() * 0.3;

      switch (type) {
        case 'ding':
          oscillator.frequency.setValueAtTime(800, now);
          gainNode.gain.setValueAtTime(volume, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          oscillator.start(now);
          oscillator.stop(now + 0.3);
          break;

        case 'coin':
          oscillator.frequency.setValueAtTime(400, now);
          oscillator.frequency.exponentialRampToValueAtTime(600, now + 0.1);
          gainNode.gain.setValueAtTime(volume, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.2);
          oscillator.start(now);
          oscillator.stop(now + 0.2);
          break;

        case 'chime':
          oscillator.frequency.setValueAtTime(523, now);
          oscillator.frequency.setValueAtTime(659, now + 0.15);
          gainNode.gain.setValueAtTime(volume, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.4);
          oscillator.start(now);
          oscillator.stop(now + 0.4);
          break;

        case 'applause': {
          const bufferSize = ctx.sampleRate * 0.5;
          const buffer = ctx.createBuffer(1, bufferSize, ctx.sampleRate);
          const data = buffer.getChannelData(0);

          for (let i = 0; i < bufferSize; i += 1) {
            data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (ctx.sampleRate * 0.2));
          }

          const noiseSource = ctx.createBufferSource();
          noiseSource.buffer = buffer;
          noiseSource.connect(gainNode);
          gainNode.gain.setValueAtTime(volume * 0.5, now);
          noiseSource.start(now);
          break;
        }

        case 'anime-sparkle':
          oscillator.frequency.setValueAtTime(1200, now);
          oscillator.frequency.exponentialRampToValueAtTime(2400, now + 0.15);
          gainNode.gain.setValueAtTime(volume * 0.8, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          oscillator.start(now);
          oscillator.stop(now + 0.3);
          break;

        case 'anime-powerup':
          oscillator.frequency.setValueAtTime(220, now);
          oscillator.frequency.exponentialRampToValueAtTime(880, now + 0.08);
          oscillator.frequency.exponentialRampToValueAtTime(1760, now + 0.16);
          gainNode.gain.setValueAtTime(volume, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.25);
          oscillator.start(now);
          oscillator.stop(now + 0.25);
          break;

        case 'anime-notification': {
          const beep1 = ctx.createOscillator();
          const beep2 = ctx.createOscillator();
          const beep3 = ctx.createOscillator();
          const gain1 = ctx.createGain();
          const gain2 = ctx.createGain();
          const gain3 = ctx.createGain();

          [beep1, beep2, beep3].forEach((osc, i) => {
            const gain = [gain1, gain2, gain3][i];
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = 1000;
            gain.gain.setValueAtTime(volume * 0.6, now + i * 0.12);
            gain.gain.exponentialRampToValueAtTime(0.01, now + i * 0.12 + 0.1);
            osc.start(now + i * 0.12);
            osc.stop(now + i * 0.12 + 0.1);
          });
          return;
        }

        case 'anime-coin':
          oscillator.frequency.setValueAtTime(988, now);
          oscillator.frequency.setValueAtTime(1319, now + 0.1);
          gainNode.gain.setValueAtTime(volume, now);
          gainNode.gain.exponentialRampToValueAtTime(0.01, now + 0.3);
          oscillator.start(now);
          oscillator.stop(now + 0.3);
          break;

        case 'anime-victory': {
          const notes = [
            { freq: 523, start: 0 },
            { freq: 659, start: 0.1 },
            { freq: 784, start: 0.2 },
            { freq: 1047, start: 0.3 }
          ];
          notes.forEach(({ freq, start }) => {
            const osc = ctx.createOscillator();
            const gain = ctx.createGain();
            osc.connect(gain);
            gain.connect(ctx.destination);
            osc.frequency.value = freq;
            gain.gain.setValueAtTime(volume * 0.7, now + start);
            gain.gain.exponentialRampToValueAtTime(0.01, now + start + 0.2);
            osc.start(now + start);
            osc.stop(now + start + 0.2);
          });
          return;
        }

        default:
          gainNode.gain.setValueAtTime(0.0001, now);
          oscillator.start(now);
          oscillator.stop(now + 0.001);
      }
    }

    function playGiftSound() {
      const selectedSound = giftSoundSelect ? giftSoundSelect.value : '';
      if (!selectedSound) return;

      if (selectedSound.startsWith('custom-')) {
        const soundPath = selectedSound.replace('custom-', '');
        if (!win || typeof win.Audio !== 'function') return;
        const audio = new win.Audio(soundPath);
        audio.volume = getSliderVolume();
        audio.play().catch((err) => console.error('Sound play error:', err));
        return;
      }

      playBuiltInSound(selectedSound);
    }

    function playSpecificSound(soundId) {
      if (!soundId) {
        playGiftSound();
        return;
      }

      if (soundId.startsWith('custom-')) {
        const soundPath = soundId.replace('custom-', '');
        if (!win || typeof win.Audio !== 'function') return;
        const audio = new win.Audio(soundPath);
        audio.volume = getSliderVolume();
        audio.play().catch((err) => console.error('Sound play error:', err));
        return;
      }

      playBuiltInSound(soundId);
    }

    function populateGiftSoundOptions(selectElement, selectedValue) {
      if (!selectElement || !doc || !giftSoundSelect) return;

      selectElement.innerHTML = '';
      Array.from(giftSoundSelect.options).forEach((opt) => {
        const option = doc.createElement('option');
        option.value = opt.value;
        option.textContent = opt.textContent;
        option.selected = opt.value === selectedValue;
        selectElement.appendChild(option);
      });
    }

    async function loadCustomSounds(selectedSoundOverride = '') {
      if (!callFetch) return;
      try {
        const response = await callFetch('/api/sounds/list');
        const data = await response.json();
        state.customGiftSounds = (data.custom || []).map((sound) => ({
          filename: sound.name,
          path: sound.path
        }));
        rebuildGiftSoundSelect(selectedSoundOverride);
      } catch (error) {
        console.error('Error loading custom sounds:', error);
      }
    }

    function bindGiftSoundSelect() {
      if (!giftSoundSelect) return;
      giftSoundSelect.addEventListener('change', () => {
        settingsStore.setItem('gift_sound_preference', giftSoundSelect.value);
        callbacks.renderGiftMappings?.();
      });
    }

    function bindUpload() {
      if (!uploadSoundBtn || !customSoundUpload || !callFetch) return;
      uploadSoundBtn.addEventListener('click', async () => {
        const file = customSoundUpload.files?.[0];
        if (!file) {
          callbacks.updateStatus?.('Please select a sound file first', false, true);
          return;
        }

        const formData = new FormData();
        formData.append('sound', file);

        try {
          uploadSoundBtn.disabled = true;
          uploadSoundBtn.textContent = 'Uploading...';

          const response = await callFetch('/api/sounds/upload', {
            method: 'POST',
            body: formData
          });
          const data = await response.json();

          if (!data.success) {
            throw new Error(data.error || 'Upload failed');
          }

          const uploadedSoundValue = `custom-${data.path}`;
          settingsStore.setItem('gift_sound_preference', uploadedSoundValue);
          await loadCustomSounds(uploadedSoundValue);
          callbacks.updateStatus?.(`✓ Sound uploaded: ${data.filename}`, false);
          customSoundUpload.value = '';
        } catch (error) {
          console.error('Upload error:', error);
          callbacks.updateStatus?.(`Upload failed: ${error.message}`, false, true);
        } finally {
          uploadSoundBtn.disabled = false;
          uploadSoundBtn.textContent = 'Upload';
        }
      });
    }

    function bindDelete() {
      if (!deleteCustomSoundBtn || !customSoundManageSelect || !callFetch) return;
      deleteCustomSoundBtn.addEventListener('click', async () => {
        const filename = customSoundManageSelect.value || '';
        if (!filename) {
          callbacks.updateStatus?.('Select a custom sound to delete', false, true);
          return;
        }

        const shouldDelete = callConfirm(`Delete custom sound "${filename}"?`);
        if (!shouldDelete) return;

        try {
          deleteCustomSoundBtn.disabled = true;
          deleteCustomSoundBtn.textContent = 'Deleting...';

          const response = await callFetch(`/api/sounds/custom/${encodeURIComponent(filename)}`, {
            method: 'DELETE'
          });
          const data = await response.json().catch(() => ({}));
          if (!response.ok || !data.success) {
            throw new Error(data.error || 'Delete failed');
          }

          const removedSoundValue = getCustomSoundValue(filename);
          if (giftSoundSelect && giftSoundSelect.value === removedSoundValue) {
            settingsStore.setItem('gift_sound_preference', '');
          }

          callbacks.clearSoundReferences?.(removedSoundValue);
          callbacks.saveGiftMappings?.();
          await loadCustomSounds();
          callbacks.updateStatus?.(`✓ Sound deleted: ${filename}`, false);
        } catch (error) {
          console.error('Delete custom sound error:', error);
          callbacks.updateStatus?.(`Delete failed: ${error.message}`, false, true);
        } finally {
          deleteCustomSoundBtn.disabled = false;
          deleteCustomSoundBtn.textContent = '🗑️ Delete';
        }
      });
    }

    function bindCopyButtons() {
      if (!doc) return;
      doc.querySelectorAll('.copy-btn').forEach((btn) => {
        if (btn.dataset.giftSoundCopyBound === '1') return;
        btn.dataset.giftSoundCopyBound = '1';

        btn.addEventListener('click', () => {
          const targetId = btn.dataset.target;
          const input = doc.getElementById(targetId);
          if (!input) return;

          input.select?.();
          input.setSelectionRange?.(0, 99999);

          const clipboard = nav && nav.clipboard && typeof nav.clipboard.writeText === 'function'
            ? nav.clipboard
            : null;
          if (!clipboard) {
            callbacks.updateStatus?.('Copy failed - please copy manually', false, true);
            return;
          }

          clipboard.writeText(input.value).then(() => {
            const originalText = btn.textContent;
            btn.textContent = '✓ Copied!';
            btn.style.background = 'var(--success)';
            setTimeout(() => {
              btn.textContent = originalText;
              btn.style.background = '';
            }, 2000);
          }).catch((err) => {
            console.error('Copy failed:', err);
            callbacks.updateStatus?.('Copy failed - please copy manually', false, true);
          });
        });
      });
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      bindGiftSoundSelect();
      bindUpload();
      bindDelete();
      bindCopyButtons();
      void loadCustomSounds();
      if (win) {
        win.playGiftSound = playGiftSound;
      }
    }

    return {
      state,
      init,
      loadCustomSounds,
      populateCustomSoundManageSelect,
      rebuildGiftSoundSelect,
      playGiftSound,
      playBuiltInSound,
      playSpecificSound,
      populateGiftSoundOptions
    };
  }

  window.createGiftSoundsController = createGiftSoundsController;
})();

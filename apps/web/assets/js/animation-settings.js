(function initAnimationSettingsModule() {
  function createAnimationSettingsController({
    settingsStore,
    elements = {},
    callbacks = {}
  }) {
    function getAnimationVolumePercent() {
      const slider = elements.animationVolumeSlider;
      if (!slider) return 100;
      const value = parseInt(slider.value, 10);
      return Number.isFinite(value) ? value : 100;
    }

    function updateAnimationVolumeLabel() {
      const slider = elements.animationVolumeSlider;
      const valueEl = elements.animationVolumeValue;
      if (!slider || !valueEl) return;
      valueEl.textContent = `${slider.value}%`;
    }

    function initEnabledToggle() {
      const checkbox = elements.animationsEnabledCheckbox;
      if (!checkbox) return;

      const saved = settingsStore.getItem('animations_enabled');
      if (saved !== null) {
        checkbox.checked = saved === 'true';
      }

      checkbox.addEventListener('change', () => {
        settingsStore.setItem('animations_enabled', checkbox.checked);
        console.log('Animations:', checkbox.checked ? 'enabled ✅' : 'disabled ❌');
      });
    }

    function initVolumeSlider() {
      const slider = elements.animationVolumeSlider;
      if (!slider) return;

      const savedVolume = settingsStore.getItem('animation_volume');
      if (savedVolume !== null) {
        slider.value = savedVolume;
      }
      updateAnimationVolumeLabel();

      slider.addEventListener('input', () => {
        settingsStore.setItem('animation_volume', slider.value);
        updateAnimationVolumeLabel();
        callbacks.onAnimationVolumeInput?.();
      });
    }

    function saveChromaSettings() {
      const greenThresholdSlider = elements.greenThresholdSlider;
      const chromaToleranceSlider = elements.chromaToleranceSlider;
      if (!greenThresholdSlider || !chromaToleranceSlider) return;

      const settings = {
        greenThreshold: parseInt(greenThresholdSlider.value, 10),
        tolerance: parseInt(chromaToleranceSlider.value, 10),
        spillReduction: 0.5
      };
      settingsStore.setItem('chroma_key_settings', JSON.stringify(settings));
      console.log('✓ Chroma key settings saved:', settings);
    }

    function initChromaSliders() {
      const greenThresholdSlider = elements.greenThresholdSlider;
      const chromaToleranceSlider = elements.chromaToleranceSlider;
      const greenThresholdValue = elements.greenThresholdValue;
      const chromaToleranceValue = elements.chromaToleranceValue;
      if (!greenThresholdSlider || !chromaToleranceSlider) return;

      const savedChroma = settingsStore.getItem('chroma_key_settings');
      if (savedChroma) {
        try {
          const settings = JSON.parse(savedChroma);
          greenThresholdSlider.value = settings.greenThreshold || 100;
          chromaToleranceSlider.value = settings.tolerance || 50;
          if (greenThresholdValue) greenThresholdValue.textContent = greenThresholdSlider.value;
          if (chromaToleranceValue) chromaToleranceValue.textContent = chromaToleranceSlider.value;
        } catch (err) {
          console.error('Error loading chroma settings:', err);
        }
      }

      greenThresholdSlider.addEventListener('input', () => {
        if (greenThresholdValue) greenThresholdValue.textContent = greenThresholdSlider.value;
        callbacks.onChromaInput?.();
      });

      chromaToleranceSlider.addEventListener('input', () => {
        if (chromaToleranceValue) chromaToleranceValue.textContent = chromaToleranceSlider.value;
        callbacks.onChromaInput?.();
      });

      greenThresholdSlider.addEventListener('change', saveChromaSettings);
      chromaToleranceSlider.addEventListener('change', saveChromaSettings);
    }

    function initAnimationPositionSelect() {
      const positionSelect = elements.animationPositionSelect;
      if (!positionSelect) return;

      const savedPosition = settingsStore.getItem('animation_position');
      if (savedPosition) {
        positionSelect.value = savedPosition;
      }

      positionSelect.addEventListener('change', () => {
        settingsStore.setItem('animation_position', positionSelect.value);
        console.log('✓ Animation position saved:', positionSelect.value);
      });
    }

    function init() {
      initEnabledToggle();
      initVolumeSlider();
      initChromaSliders();
      initAnimationPositionSelect();
    }

    return {
      getAnimationVolumePercent,
      updateAnimationVolumeLabel,
      saveChromaSettings,
      init
    };
  }

  window.createAnimationSettingsController = createAnimationSettingsController;
})();

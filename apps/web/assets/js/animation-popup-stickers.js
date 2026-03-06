(function initAnimationPopupStickersModule() {
  function createAnimationPopupStickersController({
    documentRef,
    elements = {},
    helpers = {}
  }) {
    const doc = documentRef || (typeof document !== 'undefined' ? document : null);

    function escapeAttribute(value) {
      if (typeof helpers.escapeAttribute === 'function') {
        return helpers.escapeAttribute(value);
      }
      return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    function escapeHtml(value) {
      if (typeof helpers.escapeHtml === 'function') {
        return helpers.escapeHtml(value);
      }
      return String(value || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
    }

    function getAvailableStickerOptions() {
      if (typeof helpers.getAvailableStickerOptions === 'function') {
        const options = helpers.getAvailableStickerOptions();
        return Array.isArray(options) ? options : [];
      }
      return [];
    }

    function getCurrentPopupTrigger() {
      if (typeof helpers.getCurrentPopupTrigger === 'function') {
        return String(helpers.getCurrentPopupTrigger() || '');
      }
      return '';
    }

    function renderAnimationPopupStickerPicker(selectedKey = '') {
      const picker = elements.animationPopupStickerPicker;
      const select = elements.animationPopupSticker;
      if (!picker) return;

      const currentTrigger = getCurrentPopupTrigger();
      const options = getAvailableStickerOptions();
      const noneSelected = !selectedKey;

      const noneCard = `
        <button type="button" class="secondary animation-sticker-option none${noneSelected ? ' active' : ''}" data-sticker-key="">
          <span class="animation-sticker-option-name">No sticker</span>
          <span class="animation-sticker-option-map">Unassigned</span>
        </button>
      `;

      const optionCards = options.map((entry) => {
        const isSelected = selectedKey === entry.key;
        const image = entry.image
          ? `<img class="animation-sticker-option-image" src="${escapeAttribute(entry.image)}" alt="${escapeAttribute(entry.name || entry.key)}">`
          : '<span class="animation-sticker-option-image" style="display: inline-flex; align-items: center; justify-content: center; font-size: 1.15rem;">🎭</span>';

        let mappedLabel = 'Unassigned';
        if (entry.trigger) {
          mappedLabel = entry.trigger === currentTrigger ? 'Mapped to this card' : `Mapped: ${entry.trigger}`;
        }

        return `
          <button type="button" class="secondary animation-sticker-option${isSelected ? ' active' : ''}" data-sticker-key="${escapeAttribute(entry.key)}" title="${escapeAttribute(entry.name || entry.key)}">
            ${image}
            <span class="animation-sticker-option-name">${escapeHtml(entry.name || entry.key)}</span>
            <span class="animation-sticker-option-map">${escapeHtml(mappedLabel)}</span>
          </button>
        `;
      }).join('');

      picker.innerHTML = `${noneCard}${optionCards}`;

      picker.querySelectorAll('.animation-sticker-option').forEach((btn) => {
        btn.addEventListener('click', () => {
          const stickerKey = btn.dataset.stickerKey || '';
          if (select) {
            select.value = stickerKey;
          }
          renderAnimationPopupStickerPicker(stickerKey);
        });
      });
    }

    function populateAnimationPopupStickerOptions(selectedKey = '') {
      const select = elements.animationPopupSticker;
      if (!select || !doc) return;

      const options = getAvailableStickerOptions();
      select.innerHTML = '<option value="">No sticker assigned</option>';
      options.forEach((entry) => {
        const option = doc.createElement('option');
        option.value = entry.key;
        option.textContent = `${entry.name || entry.key}${entry.trigger ? ` (${entry.trigger})` : ''}`;
        if (selectedKey && selectedKey === entry.key) {
          option.selected = true;
        }
        select.appendChild(option);
      });
      select.value = selectedKey || '';
      renderAnimationPopupStickerPicker(select.value);
    }

    return {
      renderAnimationPopupStickerPicker,
      populateAnimationPopupStickerOptions
    };
  }

  window.createAnimationPopupStickersController = createAnimationPopupStickersController;
})();

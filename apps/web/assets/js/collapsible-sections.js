(function initCollapsibleSectionsModule() {
  function createCollapsibleSectionsController({
    windowRef,
    documentRef,
    settingsStore
  } = {}) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const store = settingsStore || (win && win.settingsStore ? win.settingsStore : null);

    function readCollapsedState(storageKey = '') {
      if (!storageKey || !store || typeof store.getItem !== 'function') return null;
      const raw = String(store.getItem(storageKey) || '').trim().toLowerCase();
      if (!raw) return null;
      if (raw === '1' || raw === 'true' || raw === 'collapsed') return true;
      if (raw === '0' || raw === 'false' || raw === 'expanded') return false;
      return null;
    }

    function writeCollapsedState(storageKey = '', collapsed = false) {
      if (!storageKey || !store || typeof store.setItem !== 'function') return;
      store.setItem(storageKey, collapsed ? '1' : '0');
    }

    function getToggleLabel(toggleButton, collapsed) {
      const expandedLabel = String(toggleButton?.dataset?.collapseLabelExpanded || 'Hide');
      const collapsedLabel = String(toggleButton?.dataset?.collapseLabelCollapsed || 'Show');
      return collapsed ? collapsedLabel : expandedLabel;
    }

    function setCollapsed(toggleButton, panel, collapsed, { persist = true } = {}) {
      if (!toggleButton || !panel) return;
      panel.hidden = !!collapsed;
      panel.classList.toggle('is-collapsed', !!collapsed);
      toggleButton.setAttribute('aria-expanded', collapsed ? 'false' : 'true');
      toggleButton.textContent = getToggleLabel(toggleButton, !!collapsed);

      const storageKey = String(toggleButton.dataset?.collapseKey || '').trim();
      if (persist) {
        writeCollapsedState(storageKey, !!collapsed);
      }
    }

    function bindToggle(toggleButton) {
      if (!toggleButton || !doc || typeof toggleButton.addEventListener !== 'function') return;
      const targetId = String(toggleButton.dataset?.collapseTarget || '').trim();
      if (!targetId) return;

      const panel = doc.getElementById(targetId);
      if (!panel) return;

      const storageKey = String(toggleButton.dataset?.collapseKey || '').trim();
      const persisted = readCollapsedState(storageKey);
      const defaultCollapsed = String(toggleButton.dataset?.collapseDefault || '').trim().toLowerCase() === 'collapsed';
      const initialCollapsed = persisted !== null ? persisted : defaultCollapsed;

      setCollapsed(toggleButton, panel, initialCollapsed, { persist: false });
      toggleButton.setAttribute('aria-controls', targetId);

      toggleButton.addEventListener('click', () => {
        const nextCollapsed = toggleButton.getAttribute('aria-expanded') !== 'false';
        setCollapsed(toggleButton, panel, nextCollapsed, { persist: true });
      });
    }

    function init() {
      if (!doc) return;
      doc.querySelectorAll('[data-collapse-target]').forEach((button) => {
        bindToggle(button);
      });
    }

    return {
      init,
      bindToggle,
      setCollapsed
    };
  }

  window.createCollapsibleSectionsController = createCollapsibleSectionsController;
})();

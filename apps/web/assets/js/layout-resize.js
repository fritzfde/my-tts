(function initLayoutResizeModule() {
  function createLayoutResizeController({
    windowRef,
    documentRef,
    settingsStore,
    elements,
    keys,
    limits
  }) {
    const win = windowRef || window;
    const doc = documentRef || document;
    const chatLayout = elements.chatLayout;
    const chatOnlineSplitter = elements.chatOnlineSplitter;
    const onlineUsersPanel = elements.onlineUsersPanel;
    const onlineUsersGrid = elements.onlineUsersGrid;
    const onlineUsersSplitter = elements.onlineUsersSplitter;

    function getChatOnlinePanelBounds() {
      if (!chatLayout) {
        return { min: limits.chatMinWidth, max: limits.chatMaxWidth };
      }

      const layoutWidth = chatLayout.clientWidth || win.innerWidth || 1200;
      const maxByLayout = Math.max(limits.chatMinWidth, layoutWidth - 420);
      return {
        min: limits.chatMinWidth,
        max: Math.min(limits.chatMaxWidth, maxByLayout)
      };
    }

    function setChatOnlinePanelWidth(widthPx, { persist = true } = {}) {
      if (!chatLayout) return;
      const nextWidth = Number(widthPx);
      if (!Number.isFinite(nextWidth)) return;

      const bounds = getChatOnlinePanelBounds();
      const clamped = Math.max(bounds.min, Math.min(bounds.max, nextWidth));
      const rounded = Math.round(clamped);

      chatLayout.style.setProperty('--online-users-width', `${rounded}px`);
      if (persist) {
        settingsStore.setItem(keys.chatWidthKey, String(rounded));
      }
    }

    function initChatOnlinePanelResize() {
      if (!chatLayout || !chatOnlineSplitter) return;

      const savedWidth = Number(settingsStore.getItem(keys.chatWidthKey));
      if (Number.isFinite(savedWidth)) {
        setChatOnlinePanelWidth(savedWidth, { persist: false });
      }

      let dragging = false;
      let activePointerId = null;

      const stopDrag = (event) => {
        if (!dragging) return;
        if (activePointerId !== null && event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;

        dragging = false;
        activePointerId = null;
        chatOnlineSplitter.classList.remove('dragging');
        doc.body.classList.remove('is-resizing-online-users');

        const currentWidth = parseFloat(getComputedStyle(chatLayout).getPropertyValue('--online-users-width'));
        if (Number.isFinite(currentWidth)) {
          settingsStore.setItem(keys.chatWidthKey, String(Math.round(currentWidth)));
        }

        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('pointerup', stopDrag);
        win.removeEventListener('pointercancel', stopDrag);
      };

      const onPointerMove = (event) => {
        if (!dragging) return;
        if (activePointerId !== null && event.pointerId !== activePointerId) return;

        const layoutRect = chatLayout.getBoundingClientRect();
        const desiredWidth = layoutRect.right - event.clientX;
        setChatOnlinePanelWidth(desiredWidth, { persist: false });
      };

      chatOnlineSplitter.addEventListener('pointerdown', (event) => {
        const compact = typeof win.matchMedia === 'function'
          && win.matchMedia('(max-width: 1100px)').matches;
        if (compact) return;

        dragging = true;
        activePointerId = event.pointerId;
        chatOnlineSplitter.classList.add('dragging');
        doc.body.classList.add('is-resizing-online-users');

        if (typeof chatOnlineSplitter.setPointerCapture === 'function') {
          chatOnlineSplitter.setPointerCapture(event.pointerId);
        }

        win.addEventListener('pointermove', onPointerMove);
        win.addEventListener('pointerup', stopDrag);
        win.addEventListener('pointercancel', stopDrag);
        event.preventDefault();
      });

      win.addEventListener('resize', () => {
        const compact = typeof win.matchMedia === 'function'
          && win.matchMedia('(max-width: 1100px)').matches;
        if (compact) return;

        const currentWidth = parseFloat(getComputedStyle(chatLayout).getPropertyValue('--online-users-width'));
        if (Number.isFinite(currentWidth)) {
          setChatOnlinePanelWidth(currentWidth, { persist: false });
        }
      });
    }

    function getOnlineUsersTopPaneBounds() {
      if (!onlineUsersGrid) {
        return { min: limits.onlineUsersTopMinHeight, max: limits.onlineUsersTopMinHeight };
      }

      const splitterHeight = 10;
      const panelHeight = onlineUsersPanel ? onlineUsersPanel.clientHeight : 0;
      const estimatedGridHeight = panelHeight > 0 ? Math.max(0, panelHeight - 42) : 0;
      const gridHeight = onlineUsersGrid.clientHeight || estimatedGridHeight || 360;
      const maxByLayout = Math.max(
        limits.onlineUsersTopMinHeight,
        gridHeight - limits.onlineUsersTopMinHeight - splitterHeight
      );

      return {
        min: limits.onlineUsersTopMinHeight,
        max: maxByLayout
      };
    }

    function setOnlineUsersTopPaneHeight(heightPx, { persist = true } = {}) {
      if (!onlineUsersGrid) return;
      const nextHeight = Number(heightPx);
      if (!Number.isFinite(nextHeight)) return;

      const bounds = getOnlineUsersTopPaneBounds();
      const clamped = Math.max(bounds.min, Math.min(bounds.max, nextHeight));
      const rounded = Math.round(clamped);

      onlineUsersGrid.style.setProperty('--online-users-youtube-height', `${rounded}px`);
      if (persist) {
        settingsStore.setItem(keys.onlineUsersTopHeightKey, String(rounded));
      }
    }

    function initOnlineUsersPlatformResize() {
      if (!onlineUsersPanel || !onlineUsersGrid || !onlineUsersSplitter) return;

      const isCompact = () => (
        typeof win.matchMedia === 'function'
        && win.matchMedia('(max-width: 1100px)').matches
      );

      const savedTopHeight = Number(settingsStore.getItem(keys.onlineUsersTopHeightKey));
      if (Number.isFinite(savedTopHeight)) {
        setOnlineUsersTopPaneHeight(savedTopHeight, { persist: false });
      }

      let dragging = false;
      let activePointerId = null;

      const stopDrag = (event) => {
        if (!dragging) return;
        if (activePointerId !== null && event && event.pointerId !== undefined && event.pointerId !== activePointerId) return;

        dragging = false;
        activePointerId = null;
        onlineUsersSplitter.classList.remove('dragging');
        doc.body.classList.remove('is-resizing-online-users-vertical');

        const currentHeight = parseFloat(getComputedStyle(onlineUsersGrid).getPropertyValue('--online-users-youtube-height'));
        if (Number.isFinite(currentHeight)) {
          settingsStore.setItem(keys.onlineUsersTopHeightKey, String(Math.round(currentHeight)));
        }

        win.removeEventListener('pointermove', onPointerMove);
        win.removeEventListener('pointerup', stopDrag);
        win.removeEventListener('pointercancel', stopDrag);
      };

      const onPointerMove = (event) => {
        if (!dragging) return;
        if (activePointerId !== null && event.pointerId !== activePointerId) return;

        const gridRect = onlineUsersGrid.getBoundingClientRect();
        const desiredTopHeight = event.clientY - gridRect.top;
        setOnlineUsersTopPaneHeight(desiredTopHeight, { persist: false });
      };

      onlineUsersSplitter.addEventListener('pointerdown', (event) => {
        if (isCompact()) return;

        dragging = true;
        activePointerId = event.pointerId;
        onlineUsersSplitter.classList.add('dragging');
        doc.body.classList.add('is-resizing-online-users-vertical');

        if (typeof onlineUsersSplitter.setPointerCapture === 'function') {
          onlineUsersSplitter.setPointerCapture(event.pointerId);
        }

        win.addEventListener('pointermove', onPointerMove);
        win.addEventListener('pointerup', stopDrag);
        win.addEventListener('pointercancel', stopDrag);
        event.preventDefault();
      });

      win.addEventListener('resize', () => {
        if (isCompact()) return;

        const currentHeight = parseFloat(getComputedStyle(onlineUsersGrid).getPropertyValue('--online-users-youtube-height'));
        if (Number.isFinite(currentHeight)) {
          setOnlineUsersTopPaneHeight(currentHeight, { persist: false });
        }
      });

      requestAnimationFrame(() => {
        if (isCompact()) return;
        const currentHeight = parseFloat(getComputedStyle(onlineUsersGrid).getPropertyValue('--online-users-youtube-height'));
        if (Number.isFinite(currentHeight)) {
          setOnlineUsersTopPaneHeight(currentHeight, { persist: false });
        }
      });
    }

    function init() {
      initChatOnlinePanelResize();
      initOnlineUsersPlatformResize();
    }

    return {
      getChatOnlinePanelBounds,
      setChatOnlinePanelWidth,
      initChatOnlinePanelResize,
      getOnlineUsersTopPaneBounds,
      setOnlineUsersTopPaneHeight,
      initOnlineUsersPlatformResize,
      init
    };
  }

  window.createLayoutResizeController = createLayoutResizeController;
})();

(function initAudioRuntimeModule() {
  function createAudioRuntimeController({
    windowRef,
    documentRef,
    navigatorRef,
    setTimeoutFn,
    clearTimeoutFn,
    getShouldRequestWakeLock,
    unlockNoticeDelayMs = 1000
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const nav = navigatorRef || (win && win.navigator ? win.navigator : null);
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const callClearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout;

    const state = {
      wakeLock: null,
      audioContext: null,
      audioUnlocked: false,
      initialized: false,
      unlockNotice: null
    };

    async function requestWakeLock() {
      try {
        if (!nav || !nav.wakeLock || typeof nav.wakeLock.request !== 'function') {
          return null;
        }

        state.wakeLock = await nav.wakeLock.request('screen');
        console.log('🔒 Wake Lock activated - audio will play in background');
        state.wakeLock.addEventListener?.('release', () => {
          console.log('🔓 Wake Lock released');
        });
        return state.wakeLock;
      } catch (err) {
        console.log('Wake Lock not supported:', err);
        return null;
      }
    }

    async function releaseWakeLock() {
      if (!state.wakeLock) return;
      try {
        await state.wakeLock.release?.();
      } catch (err) {
        console.debug('Wake lock release error:', err);
      }
      state.wakeLock = null;
    }

    function ensureAudioContext() {
      if (!win) return null;

      if (!state.audioContext) {
        const AudioContextCtor = win.AudioContext || win.webkitAudioContext;
        if (!AudioContextCtor) return null;
        state.audioContext = new AudioContextCtor();
      }

      if (state.audioContext.state === 'suspended') {
        state.audioContext.resume().then(() => {
          console.log('🔊 Audio context resumed');
        }).catch(() => {});
      }

      return state.audioContext;
    }

    function unlockAudio() {
      if (state.audioUnlocked || !win) return Promise.resolve(state.audioUnlocked);

      const silentAudio = new win.Audio();
      silentAudio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
      silentAudio.volume = 0.01;

      const playPromise = silentAudio.play()
        .then(() => {
          state.audioUnlocked = true;
          removeUnlockNotice();
          console.log('✓ Audio autoplay unlocked');
          return true;
        })
        .catch(() => {
          console.log('⏳ Waiting for user interaction to unlock audio...');
          return false;
        });

      ensureAudioContext();
      return playPromise;
    }

    function removeUnlockNotice() {
      if (!state.unlockNotice) return;
      try {
        state.unlockNotice.remove();
      } catch (err) {
        console.debug('Audio unlock notice removal failed:', err);
      }
      state.unlockNotice = null;
    }

    function showUnlockNotice(message = '🔊 Click anywhere to enable TTS audio') {
      if (!doc || !doc.body) return;

      const notice = state.unlockNotice || doc.createElement('div');
      notice.style.cssText = `
        position: fixed;
        top: 20px;
        left: 50%;
        transform: translateX(-50%);
        background: #ff4444;
        color: white;
        padding: 15px 30px;
        border-radius: 8px;
        font-size: 16px;
        font-weight: bold;
        z-index: 999999;
        box-shadow: 0 4px 12px rgba(0,0,0,0.3);
        cursor: pointer;
      `;
      notice.textContent = message;

      if (!state.unlockNotice) {
        state.unlockNotice = notice;
        doc.body.appendChild(notice);
      }
    }

    function initVisibilityHandler() {
      if (!doc) return;
      doc.addEventListener('visibilitychange', () => {
        if (doc.hidden) {
          console.log('📱 Tab hidden - keeping audio active');
          return;
        }

        console.log('📱 Tab visible again');
        if (typeof getShouldRequestWakeLock === 'function' && getShouldRequestWakeLock()) {
          requestWakeLock();
        }
      });
    }

    function initUnlockListeners() {
      if (!doc) return;
      const handleUserUnlock = () => {
        unlockAudio().then((unlocked) => {
          if (unlocked) {
            removeUnlockNotice();
          }
        }).catch(() => {});
      };
      doc.addEventListener('click', handleUserUnlock);
      doc.addEventListener('keydown', handleUserUnlock);
    }

    function initInitialUnlockAttempt() {
      if (!win || !doc) return;

      win.addEventListener('load', () => {
        callSetTimeout(() => {
          unlockAudio();
        }, unlockNoticeDelayMs);
      });
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      initVisibilityHandler();
      initUnlockListeners();
      initInitialUnlockAttempt();
    }

    return {
      state,
      requestWakeLock,
      releaseWakeLock,
      ensureAudioContext,
      unlockAudio,
      showUnlockNotice,
      removeUnlockNotice,
      isAudioUnlocked: () => state.audioUnlocked,
      hasWakeLock: () => Boolean(state.wakeLock),
      init
    };
  }

  window.createAudioRuntimeController = createAudioRuntimeController;
})();

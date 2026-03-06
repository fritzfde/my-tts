(function initVoiceTestControlsModule() {
  function createVoiceTestControlsController({
    windowRef,
    synthRef,
    elements = {},
    callbacks = {},
    defaultTestMessage = ''
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const synth = synthRef || (win && win.speechSynthesis ? win.speechSynthesis : null);

    const testVoiceYouTubeBtn = elements.testVoiceYouTubeBtn || null;
    const testVoiceTikTokBtn = elements.testVoiceTikTokBtn || null;
    const testMessageInput = elements.testMessageInput || null;
    const rateSelect = elements.rateSelect || null;
    const pitchSelect = elements.pitchSelect || null;
    const volumeSlider = elements.volumeSlider || null;

    function getPlatformLabel(platform) {
      return platform === 'youtube' ? 'YouTube' : 'TikTok';
    }

    function buildUtterance(text, voiceId) {
      const UtteranceCtor = callbacks.SpeechSynthesisUtteranceCtor || (win && win.SpeechSynthesisUtterance);
      if (!UtteranceCtor) return null;

      const utterance = new UtteranceCtor(text);
      const resolvedVoice = callbacks.resolveSystemVoice?.(voiceId);
      if (resolvedVoice) utterance.voice = resolvedVoice;
      utterance.rate = parseFloat(rateSelect?.value || '1');
      utterance.pitch = parseFloat(pitchSelect?.value || '1');
      utterance.volume = Number(volumeSlider?.value || 100) / 100;
      return utterance;
    }

    function speakNow(platform) {
      const platformLabel = getPlatformLabel(platform);
      const testMsg = (testMessageInput?.value || '').trim() || defaultTestMessage;
      const voiceId = callbacks.getSelectedVoiceId?.(platform) || '';

      if (!voiceId) {
        callbacks.addChatMessage?.('SYSTEM', `No ${platformLabel} voice selected`, 'SYSTEM', false);
        return;
      }

      if (voiceId.startsWith('cloned-')) {
        callbacks.speakWithCustomVoice?.(voiceId, testMsg).then((result) => {
          if (!result) return;
          if (result.isCloned && result.audio) {
            result.audio.play().catch(() => {
              console.warn('⏸️ Test voice blocked. Click page first.');
              callbacks.unlockAudio?.();
            });
          } else if (result.utterance && synth) {
            synth.speak(result.utterance);
          }
        });
      } else {
        const utterance = buildUtterance(testMsg, voiceId);
        if (utterance && synth) {
          synth.speak(utterance);
        }
      }

      callbacks.addChatMessage?.('SYSTEM', `Testing ${platformLabel} voice: ${callbacks.getVoiceName?.(voiceId) || voiceId}`, 'SYSTEM', false);
    }

    function attachHandlers() {
      testVoiceYouTubeBtn?.addEventListener('click', () => speakNow('youtube'));
      testVoiceTikTokBtn?.addEventListener('click', () => speakNow('tiktok'));
    }

    return {
      attachHandlers,
      speakNow
    };
  }

  window.createVoiceTestControlsController = createVoiceTestControlsController;
})();

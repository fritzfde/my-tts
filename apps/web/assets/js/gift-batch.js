(function initGiftBatchModule() {
  function createGiftBatchController({
    setTimeoutFn,
    clearTimeoutFn,
    addChatMessage,
    speakText,
    batchWindowMs = 3000
  }) {
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;
    const callClearTimeout = typeof clearTimeoutFn === 'function' ? clearTimeoutFn : clearTimeout;

    const state = {
      giftBatch: new Map(),
      giftBatchTimer: null
    };

    function announceGiftBatch() {
      if (state.giftBatch.size === 0) return;

      state.giftBatch.forEach((batch, giftName) => {
        const userList = Array.from(batch.users);
        let thankYouMessage = '';

        if (userList.length === 1) {
          if (batch.count === 1) {
            thankYouMessage = `Hey ${userList[0]}, thank you for the ${giftName}!`;
          } else {
            thankYouMessage = `Hey ${userList[0]}, thank you for ${batch.count} ${giftName} gifts!`;
          }
        } else if (userList.length === 2) {
          thankYouMessage = `Hey ${userList[0]} and ${userList[1]}, thank you for the ${giftName} gifts!`;
        } else {
          thankYouMessage = `Thank you ${userList[0]}, ${userList[1]} and ${userList.length - 2} others for ${batch.count} ${giftName} gifts!`;
        }

        addChatMessage?.('SYSTEM', thankYouMessage, 'SYSTEM', false);
        speakText?.('System', thankYouMessage, 'tiktok', false);
      });

      state.giftBatch.clear();
      state.giftBatchTimer = null;
    }

    function addGiftToBatch(giftName, authorName) {
      if (!state.giftBatch.has(giftName)) {
        state.giftBatch.set(giftName, { users: new Set(), count: 0 });
      }

      const batch = state.giftBatch.get(giftName);
      batch.users.add(authorName);
      batch.count += 1;

      if (state.giftBatchTimer) {
        callClearTimeout(state.giftBatchTimer);
      }

      state.giftBatchTimer = callSetTimeout(() => {
        announceGiftBatch();
      }, batchWindowMs);
    }

    return {
      state,
      addGiftToBatch,
      announceGiftBatch
    };
  }

  window.createGiftBatchController = createGiftBatchController;
})();

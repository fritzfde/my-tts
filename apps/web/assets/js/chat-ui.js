(function initChatUiModule() {
  function createChatUiController({
    windowRef,
    documentRef,
    elements = {},
    callbacks = {},
    setTimeoutFn
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);
    const callSetTimeout = typeof setTimeoutFn === 'function' ? setTimeoutFn : setTimeout;

    const statusDiv = elements.statusDiv || null;
    const chatFeed = elements.chatFeed || null;

    function escapeHtml(text) {
      if (!doc || typeof doc.createElement !== 'function') {
        return String(text ?? '');
      }
      const div = doc.createElement('div');
      div.textContent = text;
      return div.innerHTML;
    }

    function htmlToPlainText(html) {
      const source = String(html ?? '');
      if (!doc || typeof doc.createElement !== 'function') {
        return source.replace(/<[^>]+>/g, ' ');
      }
      const container = doc.createElement('div');
      container.innerHTML = source;
      return container.textContent || '';
    }

    function updateStatus(message, isActive = false, isError = false) {
      if (!statusDiv) return;
      const statusText = statusDiv.querySelector('span');
      if (statusText) {
        statusText.textContent = message;
      }

      statusDiv.classList.remove('active', 'error');
      if (isActive) {
        statusDiv.classList.add('active');
      } else if (isError) {
        statusDiv.classList.add('error');
      }
    }

    function addChatMessage(author, text, platform = 'SYSTEM', isSpeaking = false, extraClass = '', allowHtml = false, replayTextOverride = undefined) {
      if (!chatFeed || !doc) return;

      const empty = chatFeed.querySelector('.empty-state');
      if (empty) empty.remove();

      const messageDiv = doc.createElement('div');
      messageDiv.className = `chat-message${isSpeaking ? ' speaking' : ''}${extraClass ? ` ${extraClass}` : ''}`;

      const timestamp = new Date().toLocaleTimeString();

      let badge = '';
      if (platform === 'youtube') {
        badge = '<span class="platform-badge youtube">YouTube</span> ';
      } else if (platform === 'tiktok') {
        badge = '<span class="platform-badge tiktok">TikTok</span> ';
      }

      const normalizedAuthor = String(author || '').trim();
      let resolvedDisplayName = normalizedAuthor;
      let avatar = null;
      let authorHtml = '';

      if (author !== 'SYSTEM') {
        resolvedDisplayName = callbacks.getUserDisplayName?.(normalizedAuthor, platform) || normalizedAuthor;
        callbacks.rememberUserDisplayName?.(normalizedAuthor, platform, resolvedDisplayName);
        avatar = callbacks.getUserAvatar?.(platform, normalizedAuthor) || null;

        const escapeAttribute = callbacks.escapeAttribute || ((value) => String(value ?? ''));
        const escapedDisplay = escapeHtml(resolvedDisplayName);
        const escapedAuthor = escapeAttribute(normalizedAuthor);
        const avatarHtml = avatar
          ? `<img src="${avatar}" alt="${escapeAttribute(resolvedDisplayName)}" style="width: 32px; height: 32px; border-radius: 50%; margin-right: 8px; vertical-align: middle;">`
          : '';

        authorHtml = `<span class="chat-author clickable" title="${escapedAuthor}" onclick="openVoiceAssignment('${normalizedAuthor.replace(/'/g, "\\'")}', '${platform}')">${avatarHtml}${badge}${escapedDisplay}:</span>`;
      } else {
        authorHtml = `<span class="chat-author">${badge}${escapeHtml(text)}</span>`;
      }

      if (author === 'SYSTEM') {
        messageDiv.innerHTML = `${authorHtml}<span class="timestamp">${timestamp}</span>`;
      } else {
        let replayCandidate = '';
        if (replayTextOverride === null) {
          replayCandidate = '';
        } else if (replayTextOverride !== undefined) {
          replayCandidate = String(replayTextOverride ?? '').trim();
        } else {
          replayCandidate = allowHtml ? htmlToPlainText(text) : String(text ?? '');
        }
        const replayText = replayCandidate.replace(/\s+/g, ' ').trim();
        const replayButtonHtml = replayText
          ? '<button class="secondary chat-replay-btn" type="button" title="Play message" aria-label="Play message">▶</button>'
          : '';
        const textContent = allowHtml ? text : escapeHtml(text);
        messageDiv.innerHTML = `${authorHtml}<span class="chat-text">${textContent}</span>${replayButtonHtml}<span class="timestamp">${timestamp}</span>`;

        if (replayText && typeof messageDiv.querySelector === 'function') {
          const replayButton = messageDiv.querySelector('.chat-replay-btn');
          if (replayButton && typeof replayButton.addEventListener === 'function') {
            replayButton.addEventListener('click', (event) => {
              event.preventDefault();
              event.stopPropagation();
              callbacks.replayMessage?.({
                author: normalizedAuthor,
                platform,
                text: replayText
              });
            });
          }
        }
      }

      chatFeed.appendChild(messageDiv);
      chatFeed.scrollTop = chatFeed.scrollHeight;

      if (author !== 'SYSTEM') {
        callbacks.addRecentUser?.(`${platform}:${normalizedAuthor}`);
        callbacks.markUserOnline?.(normalizedAuthor, platform, { displayName: resolvedDisplayName, avatar });
      }

      if (isSpeaking) {
        callSetTimeout(() => messageDiv.classList.remove('speaking'), 3000);
      }
    }

    return {
      escapeHtml,
      updateStatus,
      addChatMessage
    };
  }

  window.createChatUiController = createChatUiController;
})();

(function initAnimationPermissionsUiModule() {
  function createAnimationPermissionsUiController({
    windowRef,
    documentRef,
    elements = {},
    stateAccessors = {},
    callbacks = {},
    permissionSetterName = 'setUserAnimationPermission'
  }) {
    const win = windowRef || (typeof window !== 'undefined' ? window : null);
    const doc = documentRef || (win && win.document ? win.document : null);

    const globalCheckbox = elements.globalAnimationTriggerCheckbox
      || doc?.getElementById?.('globalAnimationTrigger')
      || null;
    const manageBtn = elements.managePermissionsBtn
      || doc?.getElementById?.('manageAnimationPermissionsBtn')
      || null;
    const modal = elements.voiceModal || doc?.getElementById?.('voiceModal') || null;
    const list = elements.userVoiceList || doc?.getElementById?.('userVoiceList') || null;

    const state = {
      initialized: false
    };

    function getRecentUsers() {
      const users = stateAccessors.getRecentUsers?.();
      return Array.isArray(users) ? users : [];
    }

    function getGlobalEnabled() {
      return stateAccessors.getGlobalEnabled?.() !== false;
    }

    function getPermissionsMap() {
      return stateAccessors.getPermissionsMap?.() || {};
    }

    function getDisplayName(username, platform) {
      return callbacks.getUserDisplayName?.(username, platform) || username;
    }

    function renderNoUsers() {
      if (!list) return;
      list.innerHTML = '<p style="color: var(--text-secondary); text-align: center; padding: 20px;">No recent users yet.</p>';
    }

    function buildPermissionsHtml() {
      const recentUsers = getRecentUsers();
      const permissions = getPermissionsMap();
      const globalEnabled = getGlobalEnabled();

      return `
        <div style="margin-bottom: 16px; padding: 10px; background: rgba(255, 107, 107, 0.08); border-radius: 6px; font-size: 0.75rem; color: var(--text-secondary);">
          <strong>Default:</strong> Follow global setting (currently ${globalEnabled ? 'enabled' : 'disabled'})<br>
          <strong>Allow:</strong> Can trigger animations even if global is disabled<br>
          <strong>Deny:</strong> Cannot trigger animations even if global is enabled
        </div>
        ${recentUsers.map((userKey) => {
          const [platform, username] = String(userKey || '').split(':');
          const displayName = getDisplayName(username, platform) || username;
          const permission = permissions[userKey] || 'default';
          const platformBadge = platform === 'youtube'
            ? '<span class="platform-badge youtube">YouTube</span>'
            : '<span class="platform-badge tiktok">TikTok</span>';

          return `
            <div class="user-voice-item">
              <div class="username" title="${callbacks.escapeAttribute?.(username) || username}">${platformBadge}${callbacks.escapeHtml?.(displayName) || displayName}</div>
              <select onchange="${permissionSetterName}('${String(userKey).replace(/'/g, "\\'")}', this.value)">
                <option value="default" ${permission === 'default' ? 'selected' : ''}>⚙️ Default</option>
                <option value="allow" ${permission === 'allow' ? 'selected' : ''}>✅ Allow</option>
                <option value="deny" ${permission === 'deny' ? 'selected' : ''}>🚫 Deny</option>
              </select>
            </div>
          `;
        }).join('')}
      `;
    }

    function openPermissionsModal() {
      if (!modal || !list) return;

      callbacks.setVoiceModalWideLayout?.(false);
      list.classList.remove('voice-grid-layout');
      callbacks.setVoiceModalHeader?.(
        'Per-User Animation Permissions',
        'Control which users can trigger animations with stickers.'
      );

      const recentUsers = getRecentUsers();
      if (recentUsers.length === 0) {
        renderNoUsers();
      } else {
        list.innerHTML = buildPermissionsHtml();
      }

      modal.style.display = 'flex';
    }

    function setUserAnimationPermission(userKey, permission) {
      if (permission === 'default') {
        stateAccessors.deletePermission?.(userKey);
      } else {
        stateAccessors.setPermission?.(userKey, permission);
      }

      callbacks.saveAnimationPermissions?.();
      const [platform, username] = String(userKey || '').split(':');
      const displayName = getDisplayName(username, platform) || username;
      callbacks.addChatMessage?.(
        'SYSTEM',
        `Animation trigger for "${displayName}" (@${username}, ${platform}): ${permission}`,
        'SYSTEM',
        false
      );
    }

    function bindGlobalCheckbox() {
      if (!globalCheckbox) return;
      globalCheckbox.checked = getGlobalEnabled();
      globalCheckbox.addEventListener('change', () => {
        stateAccessors.setGlobalEnabled?.(globalCheckbox.checked);
        callbacks.saveAnimationPermissions?.();
        console.log('Global animation trigger:', globalCheckbox.checked ? 'enabled' : 'disabled');
      });
    }

    function bindManageButton() {
      if (!manageBtn) return;
      manageBtn.addEventListener('click', openPermissionsModal);
    }

    function init() {
      if (state.initialized) return;
      state.initialized = true;
      bindGlobalCheckbox();
      bindManageButton();
      if (win) {
        win[permissionSetterName] = setUserAnimationPermission;
      }
    }

    return {
      state,
      init,
      openPermissionsModal,
      setUserAnimationPermission
    };
  }

  window.createAnimationPermissionsUiController = createAnimationPermissionsUiController;
})();

const { test, expect } = require('@playwright/test');

const SETTINGS_SYNC_WAIT_MS = 1000;
const e2eScopesToCleanup = new Set();

function uniqueScope(name) {
  return `e2e-${name}-${Date.now()}-${Math.random().toString(16).slice(2, 8)}`;
}

function defaultSettings() {
  return {
    yt_tts_api_keys: JSON.stringify([]),
    yt_tts_channel_url: 'https://www.youtube.com/@example',
    yt_tts_stream_url: '',
    yt_tts_test_message: 'Smoke test message',
    yt_tts_volume: '100',
    recent_users: JSON.stringify([]),
    user_voices: JSON.stringify({}),
    user_display_names: JSON.stringify({}),
    animation_mappings: JSON.stringify({}),
    gift_mappings: JSON.stringify({ byName: {}, byValue: {} }),
    sticker_mappings: JSON.stringify({})
  };
}

async function seedScopeSettings(request, scope, overrides = {}) {
  if (String(scope || '').startsWith('e2e-')) {
    e2eScopesToCleanup.add(scope);
  }

  const response = await request.put('/api/settings', {
    data: {
      scope,
      settings: {
        ...defaultSettings(),
        ...overrides
      }
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function cleanupScopeSettings(request, scope) {
  if (!String(scope || '').startsWith('e2e-')) return;
  const response = await request.put('/api/settings', {
    data: {
      scope,
      settings: {}
    }
  });
  expect(response.ok()).toBeTruthy();
}

async function openDashboard(page, scope) {
  await page.goto(`/index.html?scope=${encodeURIComponent(scope)}`);
  await expect(page.locator('h1')).toHaveText('Multi-Platform Chat TTS');
}

async function flushSettings(page) {
  await page.evaluate(async () => {
    if (window.settingsStore?.flush) {
      await window.settingsStore.flush();
    }
  });
  await page.waitForTimeout(100);
}

async function mockAnimationsApi(page, files = [{ name: 'smoke', filename: 'smoke.mov' }]) {
  await page.route('**/api/animations/list', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ animations: files })
    });
  });

  await page.route('**/api/animations/config/default', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify({ success: true })
    });
  });
}

async function mockSoundsApi(page, files = [{ name: 'horn.wav', path: '/sounds/horn.wav' }]) {
  const mutableFiles = files.map((file) => ({
    name: String(file.name || '').trim(),
    path: String(file.path || '').trim()
  }));
  const deleted = [];

  await page.route('**/api/sounds/**', async (route) => {
    const url = new URL(route.request().url());
    const pathname = url.pathname;
    const method = route.request().method();

    if (pathname.endsWith('/api/sounds/list') && method === 'GET') {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ custom: mutableFiles })
      });
      return;
    }

    if (pathname.includes('/api/sounds/') && method === 'DELETE') {
      const filename = decodeURIComponent(pathname.split('/').pop() || '');
      const index = mutableFiles.findIndex((entry) => entry.path.endsWith(`/${filename}`));
      if (index >= 0) {
        mutableFiles.splice(index, 1);
      }
      deleted.push(filename);
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true })
      });
      return;
    }

    await route.fallback();
  });

  return {
    getDeleted: () => [...deleted]
  };
}

test.describe('Dashboard smoke suite', () => {
  test.afterAll(async ({ request }) => {
    for (const scope of e2eScopesToCleanup) {
      await cleanupScopeSettings(request, scope);
    }
    e2eScopesToCleanup.clear();
  });

  test('@smoke persists key settings after page reload', async ({ page, request }) => {
    const scope = uniqueScope('settings');
    await seedScopeSettings(request, scope);
    await openDashboard(page, scope);

    await page.fill('#channelUrl', 'https://www.youtube.com/@example');
    await page.dispatchEvent('#channelUrl', 'change');
    await page.fill('#streamUrl', 'https://www.youtube.com/watch?v=abc123def45');
    await page.dispatchEvent('#streamUrl', 'change');
    await page.fill('#testMessage', 'Persistence smoke message');

    await page.evaluate(() => {
      const slider = document.getElementById('volumeSlider');
      slider.value = '73';
      slider.dispatchEvent(new Event('input', { bubbles: true }));
    });

    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await flushSettings(page);
    await page.reload();

    await expect(page.locator('#channelUrl')).toHaveValue('https://www.youtube.com/@example');
    await expect(page.locator('#streamUrl')).toHaveValue('https://www.youtube.com/watch?v=abc123def45');
    await expect(page.locator('#testMessage')).toHaveValue('Persistence smoke message');
    await expect(page.locator('#volumeSlider')).toHaveValue('73');
    await expect(page.locator('#volumeValue')).toHaveText('73%');
  });

  test('@smoke connects YouTube using a provided stream URL', async ({ page, request }) => {
    const scope = uniqueScope('yt-connect');
    await seedScopeSettings(request, scope);

    await page.route('**/api/youtube/videos**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [{ liveStreamingDetails: { activeLiveChatId: 'chat-smoke-1' } }]
        })
      });
    });

    await page.route('**/api/youtube/liveChat/messages**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          items: [],
          pollingIntervalMillis: 60_000,
          nextPageToken: 'next-smoke'
        })
      });
    });

    await openDashboard(page, scope);
    await page.waitForTimeout(1700);

    await page.fill('#apiKeyInput', 'smoke-api-key-1');
    await page.press('#apiKeyInput', 'Enter');
    await expect(page.locator('#apiKeyCount')).toContainText('1 key');

    await page.fill('#streamUrl', 'https://www.youtube.com/watch?v=h-yGtY9rxIg');
    await page.dispatchEvent('#streamUrl', 'change');
    await page.click('#connectYouTubeBtn');

    await expect(page.locator('#disconnectYouTubeBtn')).toBeEnabled();
    await expect(page.locator('#status span')).toContainText('YouTube connected');

    await page.click('#disconnectYouTubeBtn');
    await expect(page.locator('#disconnectYouTubeBtn')).toBeDisabled();
    await expect(page.locator('#status span')).toContainText('Ready to connect');
  });

  test('@smoke shows TikTok online users with display names', async ({ page, request }) => {
    const scope = uniqueScope('tiktok-users');
    await seedScopeSettings(request, scope);
    let messagePollCount = 0;

    await page.route('**/api/tiktok/connect', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, roomId: 'room-smoke' })
      });
    });

    await page.route('**/api/tiktok/audience', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          connected: true,
          viewerCount: 12,
          ttlMs: 45_000,
          activeUsers: [
            {
              uniqueId: 'john_doe',
              nickname: 'John Doe',
              avatar: null,
              source: 'event',
              lastSeen: Date.now()
            }
          ],
          topViewers: []
        })
      });
    });

    await page.route('**/api/tiktok/messages', async (route) => {
      messagePollCount += 1;
      if (messagePollCount === 1) {
        await route.fulfill({
          status: 200,
          contentType: 'application/json',
          body: JSON.stringify([])
        });
        return;
      }

      const payload = messagePollCount === 2
        ? [
            {
              type: 'gift',
              author: 'john_doe',
              authorName: 'John Doe',
              authorAvatar: null,
              giftName: 'Rose',
              repeatCount: 1,
              diamondCount: 1,
              timestamp: Date.now()
            }
          ]
        : [];

      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify(payload)
      });
    });

    await openDashboard(page, scope);

    await page.fill('#tiktokUsername', 'smoke_tiktok_user');
    await page.click('#connectTikTokBtn');

    await expect(page.locator('#disconnectTikTokBtn')).toBeEnabled();
    await expect(page.locator('#status span')).toContainText('TikTok connected');

    const tiktokUserName = page.locator('#onlineTikTokUsers .online-user-name').first();
    const tiktokUserItem = page.locator('#onlineTikTokUsers .online-user-item').first();
    await expect(tiktokUserName).toHaveText('John Doe');
    await expect(tiktokUserItem).toHaveAttribute('title', 'john_doe');
    await expect(page.locator('#chatFeed')).toContainText('sent Rose');
  });

  test('@smoke starts and stops a shared animation preview from card controls', async ({ page, request }) => {
    const scope = uniqueScope('animation-play-stop');
    await seedScopeSettings(request, scope);

    await mockAnimationsApi(page);

    await openDashboard(page, scope);

    const firstCard = page.locator('.animation-mapping-card').first();
    const firstPlayButton = firstCard.locator('.preview-mapping-btn');
    const floatingPreview = page.locator('#activeAnimationFloating');
    const floatingPreviewButton = page.locator('#activeAnimationFloatingBtn');

    await expect(firstCard).toBeVisible();
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();

    await firstPlayButton.click();
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(firstCard).toHaveClass(/previewing/);
    await expect(floatingPreview).toBeVisible();
    await expect(page.locator('#activeAnimationFloatingLabel')).toHaveText('Preview');

    await floatingPreviewButton.click();
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(firstCard).not.toHaveClass(/previewing/);
    await expect(floatingPreview).toBeHidden();
  });

  test('@smoke persists animation mapping edits after reload', async ({ page, request }) => {
    const scope = uniqueScope('animation-persist');
    await seedScopeSettings(request, scope);

    await mockAnimationsApi(page);

    await openDashboard(page, scope);

    await expect(page.locator('.animation-mapping-card').first()).toBeVisible();
    await page.locator('.open-animation-settings-btn').first().click();
    await expect(page.locator('#animationCardPopup')).toBeVisible();

    await page.fill('#animationPopupName', 'smoke-renamed');
    await page.fill('#animationPopupScale', '1.5');
    await page.click('#animationPopupSaveBtn');

    await expect(page.locator('#animationCardPopup')).toBeHidden();
    await expect(page.locator('.animation-mapping-card[data-animation-trigger="smoke-renamed"]')).toBeVisible();

    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await flushSettings(page);
    await page.reload();

    await expect(page.locator('.animation-mapping-card[data-animation-trigger="smoke-renamed"]')).toBeVisible();
    await expect(page.locator('.animation-mapping-card[data-animation-trigger="smoke"]')).toHaveCount(0);
  });

  test('@smoke keeps saved stream URL on transient startup YouTube errors', async ({ page, request }) => {
    const scope = uniqueScope('stream-url-transient');
    const savedStreamUrl = 'https://www.youtube.com/watch?v=keep1234567';
    await seedScopeSettings(request, scope, {
      yt_tts_api_keys: JSON.stringify(['smoke-api-key-1']),
      yt_tts_stream_url: savedStreamUrl,
      yt_tts_channel_url: 'https://www.youtube.com/@example'
    });

    let videosCalls = 0;
    let searchCalls = 0;
    await page.route('**/api/youtube/videos**', async (route) => {
      videosCalls += 1;
      await route.fulfill({
        status: 403,
        contentType: 'application/json',
        body: JSON.stringify({
          error: { message: 'quotaExceeded: simulated transient error' }
        })
      });
    });

    await page.route('**/api/youtube/search**', async (route) => {
      searchCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] })
      });
    });

    await page.route('**/api/youtube/channels**', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ items: [] })
      });
    });

    await openDashboard(page, scope);
    await page.waitForTimeout(3000);

    await expect(page.locator('#streamUrl')).toHaveValue(savedStreamUrl);
    expect(videosCalls).toBeGreaterThan(0);
    expect(searchCalls).toBe(0);
  });

  test('@smoke persists default YouTube/TikTok voice selections', async ({ page, request }) => {
    const scope = uniqueScope('default-voices');
    await seedScopeSettings(request, scope, {
      youtube_default_voice: 'cloned-bravo',
      tiktok_default_voice: 'cloned-alpha'
    });

    await page.route('**/api/voice-clone/voices', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ voices: ['alpha', 'bravo'] })
      });
    });

    await openDashboard(page, scope);

    await expect(page.locator('#voiceSelectYouTube')).toHaveValue('cloned-bravo');
    await expect(page.locator('#voiceSelectTikTok')).toHaveValue('cloned-alpha');

    await page.selectOption('#voiceSelectYouTube', 'cloned-alpha');
    await page.selectOption('#voiceSelectTikTok', 'cloned-bravo');
    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await flushSettings(page);
    await page.reload();

    await expect(page.locator('#voiceSelectYouTube')).toHaveValue('cloned-alpha');
    await expect(page.locator('#voiceSelectTikTok')).toHaveValue('cloned-bravo');
  });

  test('@smoke cycles round-robin animation mapping for repeated gift value', async ({ page, request }) => {
    const scope = uniqueScope('gift-round-robin');
    await seedScopeSettings(request, scope, {
      animation_mappings: JSON.stringify({
        'anim-a': { file: 'a.mov', position: 'bottom-left', scale: 1 },
        'anim-b': { file: 'b.mov', position: 'bottom-left', scale: 1 }
      }),
      gift_mappings: JSON.stringify({
        byName: {},
        byValue: {
          '5': { type: 'animation', value: ['anim-a', 'anim-b'] }
        },
        default: { type: 'sound', value: '' }
      })
    });

    await mockAnimationsApi(page, [
      { name: 'A', filename: 'a.mov' },
      { name: 'B', filename: 'b.mov' }
    ]);

    await openDashboard(page, scope);
    const values = await page.evaluate(() => {
      const first = getGiftAction('RoundRobinGift', 5);
      const second = getGiftAction('RoundRobinGift', 5);
      const third = getGiftAction('RoundRobinGift', 5);
      return [first?.value || '', second?.value || '', third?.value || ''];
    });

    expect(values).toEqual(['anim-a', 'anim-b', 'anim-a']);
  });

  test('@smoke keeps animation card playback state consistent when switching and stopping', async ({ page, request }) => {
    const scope = uniqueScope('animation-state-consistency');
    await seedScopeSettings(request, scope);

    await mockAnimationsApi(page, [
      { name: 'One', filename: 'one.mov' },
      { name: 'Two', filename: 'two.mov' }
    ]);

    let triggerCalls = 0;
    let stopCalls = 0;
    await page.route('**/api/animations/trigger', async (route) => {
      triggerCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, clients: 1 })
      });
    });

    await page.route('**/api/animations/stop', async (route) => {
      stopCalls += 1;
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, clients: 1, obsClients: 1 })
      });
    });

    await openDashboard(page, scope);

    const firstCard = page.locator('.animation-mapping-card').nth(0);
    const secondCard = page.locator('.animation-mapping-card').nth(1);
    const floatingPreview = page.locator('#activeAnimationFloating');
    const floatingPreviewButton = page.locator('#activeAnimationFloatingBtn');
    await expect(firstCard).toBeVisible();
    await expect(secondCard).toBeVisible();

    await firstCard.locator('.preview-mapping-btn').click();
    await expect(firstCard).toHaveClass(/previewing/);
    await expect(secondCard).not.toHaveClass(/previewing/);
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(floatingPreview).toBeVisible();
    await expect(page.locator('#activeAnimationFloatingName')).toHaveText('one');

    await secondCard.locator('.preview-mapping-btn').click();
    await expect(secondCard).toHaveClass(/previewing/);
    await expect(firstCard).not.toHaveClass(/previewing/);
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(page.locator('#activeAnimationFloatingName')).toHaveText('two');

    await floatingPreviewButton.click();
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(firstCard).not.toHaveClass(/previewing/);
    await expect(secondCard).not.toHaveClass(/previewing/);
    await expect(floatingPreview).toBeHidden();

    expect(triggerCalls).toBe(0);
    expect(stopCalls).toBe(0);
  });

  test('@smoke persists sound settings popup edits after reload', async ({ page, request }) => {
    const scope = uniqueScope('sound-settings');
    await seedScopeSettings(request, scope, {
      sound_keyword_map: JSON.stringify({}),
      sound_keyword_enabled_map: JSON.stringify({}),
      sound_voice_keyword_enabled_map: JSON.stringify({})
    });

    await mockSoundsApi(page, [
      { name: 'horn.wav', path: '/sounds/horn.wav' }
    ]);

    await page.addInitScript(() => {
      window.__playedSounds = [];
      window.Audio = class AudioMock {
        constructor(src) {
          this.src = src;
          this.currentTime = 0;
          this.volume = 1;
        }
        play() {
          window.__playedSounds.push(this.src);
          return Promise.resolve();
        }
        pause() {}
        addEventListener() {}
      };
    });

    await openDashboard(page, scope);

    const firstCard = page.locator('.sound-library-card').first();
    await expect(firstCard).toBeVisible();

    await firstCard.locator('.sound-library-card-settings').click();
    await expect(page.locator('#soundSettingsPopup')).toBeVisible();

    await page.click('#soundSettingsPlayBtn');
    await expect.poll(async () => page.evaluate(() => window.__playedSounds.slice())).toContain('/sounds/horn.wav');

    await page.fill('#soundSettingsKeywords', 'horn blast\nretro horn');
    await page.check('#soundSettingsViewerKeywordEnabled');
    await page.check('#soundSettingsVoiceKeywordEnabled');
    await page.click('#soundSettingsSaveBtn');

    await expect(page.locator('#soundSettingsPopup')).toBeHidden();
    await expect(firstCard.locator('.sound-library-card-summary')).toHaveText('2 keywords • Viewer chat • Voice');

    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await flushSettings(page);
    await page.reload();

    const reloadedFirstCard = page.locator('.sound-library-card').first();
    await reloadedFirstCard.locator('.sound-library-card-settings').click();
    await expect(page.locator('#soundSettingsPopup')).toBeVisible();
    await expect(page.locator('#soundSettingsKeywords')).toHaveValue('horn blast\nretro horn');
    await expect(page.locator('#soundSettingsViewerKeywordEnabled')).toBeChecked();
    await expect(page.locator('#soundSettingsVoiceKeywordEnabled')).toBeChecked();
  });

  test('@smoke plays and deletes a sound card from the library', async ({ page, request }) => {
    const scope = uniqueScope('sound-library-actions');
    await seedScopeSettings(request, scope);

    const soundsApi = await mockSoundsApi(page, [
      { name: 'horn.wav', path: '/sounds/horn.wav' }
    ]);

    await page.addInitScript(() => {
      window.__playedSounds = [];
      window.Audio = class AudioMock {
        constructor(src) {
          this.src = src;
          this.currentTime = 0;
          this.volume = 1;
        }
        play() {
          window.__playedSounds.push(this.src);
          return Promise.resolve();
        }
        pause() {}
        addEventListener() {}
      };
    });

    await openDashboard(page, scope);

    const firstCard = page.locator('.sound-library-card').first();
    await expect(firstCard).toBeVisible();

    await firstCard.locator('.sound-library-card-main').click();
    await expect.poll(async () => page.evaluate(() => window.__playedSounds.slice())).toContain('/sounds/horn.wav');

    const deleteBtn = firstCard.locator('.sound-library-card-delete');
    await deleteBtn.click();
    await deleteBtn.click();

    await expect(page.locator('.sound-library-card')).toHaveCount(0);
    expect(soundsApi.getDeleted()).toEqual(['horn.wav']);
  });

  test('@smoke persists alert rule sound and animation assignments after reload', async ({ page, request }) => {
    const scope = uniqueScope('alert-rules');
    await seedScopeSettings(request, scope, {
      animation_mappings: JSON.stringify({
        'anim-alpha': { file: 'alpha.mov', position: 'bottom-left', scale: 1 }
      })
    });

    await mockAnimationsApi(page, [
      { name: 'Alpha', filename: 'alpha.mov' }
    ]);
    await mockSoundsApi(page, [
      { name: 'horn.wav', path: '/sounds/horn.wav' }
    ]);

    await openDashboard(page, scope);

    await page.click('#addSoundAlertRuleBtn');
    const row = page.locator('#soundAlertRulesBody tr').first();
    await expect(row).toBeVisible();

    await row.locator('select[data-field="eventType"]').selectOption('gift_value');
    await row.locator('input[data-field="eventValue"]').fill('7');

    await row.locator('.sound-alert-sound-trigger').click();
    await row.locator('.sound-alert-sound-option[data-sound-path="/sounds/horn.wav"]').click();

    await row.locator('select[data-field="animationTrigger"]').selectOption('anim-alpha');

    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await flushSettings(page);
    await page.reload();

    const reloadedRow = page.locator('#soundAlertRulesBody tr').first();
    await expect(reloadedRow.locator('select[data-field="eventType"]')).toHaveValue('gift_value');
    await expect(reloadedRow.locator('input[data-field="eventValue"]')).toHaveValue('7');
    await expect(reloadedRow.locator('.sound-alert-sound-trigger-label')).toHaveText('horn.wav');
    await expect(reloadedRow.locator('select[data-field="animationTrigger"]')).toHaveValue('anim-alpha');
  });
});

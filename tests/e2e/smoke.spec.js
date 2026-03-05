const { test, expect } = require('@playwright/test');

const SETTINGS_SYNC_WAIT_MS = 1000;

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

async function openDashboard(page, scope) {
  await page.goto(`/index.html?scope=${encodeURIComponent(scope)}`);
  await expect(page.locator('h1')).toHaveText('Multi-Platform Chat TTS');
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

test.describe('Dashboard smoke suite', () => {
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

  test('@smoke plays and stops an animation from card controls', async ({ page, request }) => {
    const scope = uniqueScope('animation-play-stop');
    await seedScopeSettings(request, scope);

    await mockAnimationsApi(page);

    await page.route('**/api/animations/trigger', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, clients: 1 })
      });
    });

    await page.route('**/api/animations/stop', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({ success: true, clients: 1, obsClients: 1 })
      });
    });

    await openDashboard(page, scope);

    const firstCard = page.locator('.animation-mapping-card').first();
    const firstPlayButton = firstCard.locator('.preview-mapping-btn');

    await expect(firstCard).toBeVisible();
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();

    await firstPlayButton.click();
    await expect(page.locator('#stopAnimationBtn')).toBeEnabled();
    await expect(firstCard).toHaveClass(/playing/);

    await page.click('#stopAnimationBtn');
    await expect(page.locator('#stopAnimationBtn')).toBeDisabled();
    await expect(firstCard).not.toHaveClass(/playing/);
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
    await page.reload();

    await expect(page.locator('.animation-mapping-card[data-animation-trigger="smoke-renamed"]')).toBeVisible();
    await expect(page.locator('.animation-mapping-card[data-animation-trigger="smoke"]')).toHaveCount(0);
  });
});

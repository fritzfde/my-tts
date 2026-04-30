const { test, expect } = require('@playwright/test');

const DASHBOARD_SCOPE = 'e2e-dashboard';
const LEGACY_BASE_URL = 'http://127.0.0.1:3000';
const SETTINGS_SYNC_WAIT_MS = 1000;

function defaultSettings() {
  return {
    yt_tts_api_keys: JSON.stringify(['dashboard-smoke-key']),
    yt_tts_channel_url: 'https://www.youtube.com/@dashboard-smoke',
    yt_tts_stream_url: 'https://www.youtube.com/watch?v=dashboard123',
    yt_tts_startup_messages: '3',
    tiktok_username: 'dashboard_smoke',
    ollama_base_url: 'http://127.0.0.1:11434',
    auto_voice_assignment_enabled: 'false',
    default_male_voice: '',
    default_female_voice: '',
    mic_asr_url: 'http://127.0.0.1:8001',
    mic_language: 'auto',
    mic_trigger_mode: 'auto',
    mic_voice_gate_enabled: 'false',
    mic_voice_match_threshold: '0.74',
    mic_voice_profile: '',
    mic_voice_profile_preview_wav: ''
  };
}

async function seedDashboardSettings(request, overrides = {}) {
  const response = await request.put(`${LEGACY_BASE_URL}/api/settings`, {
    data: {
      scope: DASHBOARD_SCOPE,
      settings: {
        ...defaultSettings(),
        ...overrides
      }
    }
  });
  expect(response.ok()).toBeTruthy();
}

test.describe('Next dashboard smoke suite', () => {
  test.beforeEach(async ({ request }) => {
    await seedDashboardSettings(request);
  });

  test('@dashboard navigates between routed tools cleanly', async ({ page }) => {
    await page.goto('/sounds');
    await expect(page.getByRole('heading', { name: 'My TTS Control Room' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sound Alerts' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Recent activity' })).toHaveCount(0);

    await page.getByRole('link', { name: /Animations/i }).click();
    await expect(page).toHaveURL(/\/animations$/);
    await expect(page.getByRole('heading', { name: 'Animation Overlay' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Sound Alerts' })).toHaveCount(0);

    await page.getByRole('link', { name: /Mic/i }).click();
    await expect(page).toHaveURL(/\/mic$/);
    await expect(page.getByRole('heading', { name: 'ASR and recognition settings' })).toBeVisible();

    await page.getByRole('link', { name: /Integrations/i }).click();
    await expect(page).toHaveURL(/\/settings\/integrations$/);
    await expect(page.getByRole('heading', { name: 'Stream inputs' })).toBeVisible();
  });

  test('@dashboard persists integration settings and exposes them on the live route', async ({ page }) => {
    await page.goto('/settings/integrations');

    await page.getByLabel('Channel URL or handle').fill('https://www.youtube.com/@route-smoke');
    await page.getByLabel('Active stream URL').fill('https://www.youtube.com/watch?v=route9876543');
    await page.getByLabel('TikTok username').fill('route_smoke_user');
    await page.getByRole('button', { name: 'Save integrations' }).click();

    await expect(page.getByText('Integration settings saved.')).toBeVisible();
    await page.reload();

    await expect(page.getByLabel('Channel URL or handle')).toHaveValue('https://www.youtube.com/@route-smoke');
    await expect(page.getByLabel('Active stream URL')).toHaveValue('https://www.youtube.com/watch?v=route9876543');
    await expect(page.getByLabel('TikTok username')).toHaveValue('route_smoke_user');

    await page.goto('/live');
    await expect(page.getByText('https://www.youtube.com/@route-smoke')).toBeVisible();
    await expect(page.getByText('https://www.youtube.com/watch?v=route9876543')).toBeVisible();
    await expect(page.getByText('route_smoke_user')).toBeVisible();
  });

  test('@dashboard persists mic mode settings across reload', async ({ page }) => {
    await page.goto('/mic');

    await page.getByLabel('Language').selectOption('de');
    await page.getByLabel('Trigger mode').selectOption('suggest');
    await page.getByLabel('Only my voice').check();

    await page.waitForTimeout(SETTINGS_SYNC_WAIT_MS);
    await page.reload();

    await expect(page.getByLabel('Language')).toHaveValue('de');
    await expect(page.getByLabel('Trigger mode')).toHaveValue('suggest');
    await expect(page.getByLabel('Only my voice')).toBeChecked();
  });
});

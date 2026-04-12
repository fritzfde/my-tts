export type RoutePlan = {
  href: string;
  label: string;
  eyebrow: string;
  title: string;
  phase: string;
  summary: string;
  focus: string;
  legacyModules: string[];
  acceptanceCriteria: string[];
  notes: string[];
};

export const navigationGroups = [
  {
    title: 'Workspace',
    items: [
      { href: '/live', label: 'Live' },
      { href: '/sounds', label: 'Sounds' },
      { href: '/animations', label: 'Animations' },
      { href: '/voices', label: 'Voices' },
      { href: '/mic', label: 'Mic' }
    ]
  },
  {
    title: 'Settings',
    items: [
      { href: '/settings/integrations', label: 'Integrations' },
      { href: '/settings/overlays', label: 'Overlays' }
    ]
  }
] as const;

export const shellRules = [
  'Keep the legacy dashboard on :3000 working while the Next app grows on :3001.',
  'Migrate one feature slice at a time behind typed API wrappers and tests.',
  'Preserve live-versus-preview behavior instead of reinterpreting it during the rewrite.'
] as const;

export const routePlans: Record<string, RoutePlan> = {
  live: {
    href: '/live',
    label: 'Live',
    eyebrow: 'Operations Surface',
    title: 'Live Control Room',
    phase: 'Phase 4',
    summary:
      'This route becomes the operational page: live chat, online users, platform status, quick connect controls, and currently playing media.',
    focus:
      'Do not migrate this first. It depends on stable stores for chat, presence, playback, and platform state that will be established by earlier routes.',
    legacyModules: [
      'apps/web/assets/js/chat-ui.js',
      'apps/web/assets/js/presence.js',
      'apps/web/assets/js/youtube.js',
      'apps/web/assets/js/tiktok.js'
    ],
    acceptanceCriteria: [
      'Chat feed and online users render from typed runtime state instead of imperative DOM wiring.',
      'Platform connect controls preserve current reconnect and startup-sync behavior.',
      'Floating sound and animation widgets remain visible and accurate across routes.'
    ],
    notes: [
      'The mic transcript dock should stay globally available from the app shell, not only on the /mic route.',
      'This route should load operational code only after the earlier media and voice slices are stable.'
    ]
  },
  sounds: {
    href: '/sounds',
    label: 'Sounds',
    eyebrow: 'First Migration Slice',
    title: 'Sound Alerts',
    phase: 'Phase 1',
    summary:
      'This is the first real React migration target. It is the cleanest self-contained domain with cards, search, item settings, uploads, per-item flags, and alert rules.',
    focus:
      'Build the typed API wrapper layer and the first reusable page patterns here: toolbar, library grid, settings dialog, alert rules table, and persisted settings hydration.',
    legacyModules: [
      'apps/web/assets/js/sound-alerts.js',
      'apps/web/assets/js/gift-sounds.js'
    ],
    acceptanceCriteria: [
      'List, upload, preview, edit, and delete sounds through typed wrappers around /api/sounds/*.',
      'Persist keywords, viewer chat, voice, and per-item volume settings without behavior drift.',
      'Preserve alert-rule editing and stored mappings while removing duplicated gift-sounds logic.'
    ],
    notes: [
      'This route should establish the standard dialog and card component patterns for the rest of the migration.',
      'Animation options used in sound alert rules can be consumed as read-only metadata before the animation page itself is migrated.'
    ]
  },
  animations: {
    href: '/animations',
    label: 'Animations',
    eyebrow: 'Second Migration Slice',
    title: 'Animation Overlay',
    phase: 'Phase 2',
    summary:
      'This route will own the animation library, square thumbnails, duration-aware sorting, per-item settings, live trigger controls, and overlay mappings.',
    focus:
      'Reuse the card and dialog patterns from /sounds, but preserve the stricter live-versus-preview split and overlay delivery semantics.',
    legacyModules: [
      'apps/web/assets/js/animation-ui.js',
      'apps/web/assets/js/animation-popup.js',
      'apps/web/assets/js/animation-playback.js',
      'apps/web/assets/js/animation-mappings.js'
    ],
    acceptanceCriteria: [
      'Cards render server-provided duration metadata and square thumbnails without per-card video players.',
      'Live trigger, stop, and popup Play Live semantics remain consistent with the current dashboard.',
      'Gift, sticker, and event mappings persist through the existing config contract until intentionally redesigned.'
    ],
    notes: [
      'Overlay client acknowledgements are part of the baseline. The new UI must not pretend an animation is live if no overlay client received it.',
      'This route should remain performance-aware and keep heavy media preview logic centralized.'
    ]
  },
  voices: {
    href: '/voices',
    label: 'Voices',
    eyebrow: 'Speech Configuration',
    title: 'Voices and Speech',
    phase: 'Phase 3',
    summary:
      'This route will collect platform voice defaults, speech settings, cloned voices, hidden voices, and user voice assignment in one typed React surface.',
    focus:
      'Extract TTS-facing UI from the current app.js and voice modules without disturbing the runtime queue behavior.',
    legacyModules: [
      'apps/web/assets/js/voices.js',
      'apps/web/assets/js/voice-ui.js',
      'apps/web/assets/js/voice-test-controls.js',
      'apps/web/assets/js/ollama-gender.js',
      'apps/web/assets/js/tts-engine.js'
    ],
    acceptanceCriteria: [
      'Platform defaults and user assignments persist exactly as they do today.',
      'Cloned voices and system voices are surfaced through typed wrappers instead of direct fetches from components.',
      'Queue and autoplay-unlock behavior stay runtime-driven, not page-driven.'
    ],
    notes: [
      'The audio unlock notice is global runtime UI, but this route is where the configuration lives.',
      'AI gender assignment should remain clearly optional and documented as a latency tradeoff.'
    ]
  },
  mic: {
    href: '/mic',
    label: 'Mic',
    eyebrow: 'ASR and Voice Matching',
    title: 'Live Microphone',
    phase: 'Phase 5',
    summary:
      'This route will handle enrollment, mic configuration, and ASR diagnostics, while the transcript dock remains available globally when listening is active.',
    focus:
      'Keep the ASR service boundary direct and typed. Do not bury websocket runtime logic inside page components.',
    legacyModules: [
      'apps/web/assets/js/mic-trigger.js',
      'apps/web/assets/js/keyword-triggers.js'
    ],
    acceptanceCriteria: [
      'Only-my-voice, threshold settings, and enrollment persistence remain intact.',
      'Suggestion mode stays non-destructive: no auto-trigger until the user clicks a suggestion.',
      'The bottom transcript dock remains shared UI that can appear on any route while listening.'
    ],
    notes: [
      'This route should own setup and diagnostics, not the entire dock surface.',
      'ASR is already a FastAPI boundary and should remain separate from the Express dashboard contract.'
    ]
  },
  integrations: {
    href: '/settings/integrations',
    label: 'Integrations',
    eyebrow: 'Settings Route',
    title: 'Integrations',
    phase: 'Phase 6',
    summary:
      'This route will consolidate platform connection details and external service configuration into one dedicated settings page.',
    focus:
      'Move configuration fields out of the legacy one-page dashboard without breaking the existing connector runtime in Node.',
    legacyModules: [
      'apps/web/assets/js/api-key-manager.js',
      'apps/web/assets/js/youtube.js',
      'apps/web/assets/js/tiktok.js',
      'apps/web/assets/js/mic-trigger.js'
    ],
    acceptanceCriteria: [
      'YouTube, TikTok, Ollama, and ASR settings are editable in a dedicated route.',
      'Current connector semantics remain intact while the UI surface becomes route-based.',
      'No platform-specific configuration remains trapped inside the legacy home page.'
    ],
    notes: [
      'Node remains the pragmatic home for platform connectors until there is a clear replacement path.',
      'This route should expose service health and connection prerequisites cleanly.'
    ]
  },
  overlays: {
    href: '/settings/overlays',
    label: 'Overlays',
    eyebrow: 'Settings Route',
    title: 'Overlay Setup',
    phase: 'Phase 6',
    summary:
      'This route will document and configure the browser/OBS overlay surfaces that must keep working throughout the migration.',
    focus:
      'Treat overlay pages as first-class runtime surfaces, not incidental static files.',
    legacyModules: [
      'apps/web/overlays/animations.html',
      'apps/web/overlays/chat.html',
      'apps/web/overlays/gifts.html',
      'apps/web/overlays/likers.html'
    ],
    acceptanceCriteria: [
      'Users can see which overlay routes exist and how they are expected to be used in OBS/browser sources.',
      'Animation overlay delivery remains visible in acceptance criteria and smoke coverage.',
      'Overlay runtime stays compatible while the dashboard UI is replaced.'
    ],
    notes: [
      'This is also the right place for future overlay diagnostics and copyable route references.',
      'Do not couple overlay retirement to dashboard migration. They have their own lifecycle.'
    ]
  }
};

export const migrationStatus = [
  {
    label: 'Legacy app',
    command: 'npm run start:web',
    detail: 'Working Express dashboard on port 3000'
  },
  {
    label: 'New app',
    command: 'npm run start:dashboard',
    detail: 'Next.js route shell on port 3001'
  },
  {
    label: 'Current focus',
    command: '/sounds',
    detail: 'First real React slice after shell + wrappers'
  }
] as const;

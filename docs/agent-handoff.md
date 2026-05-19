# Agent Handoff

Last updated: `2026-05-19`

## Purpose

This file is the current-state handoff for any new agent session. It should let a fresh agent continue the React/Next migration without needing prior chat history.

## Branch and checkpoint

- Active migration branch:
  - `codex/react-next-phase-1`
- Remote branch:
  - `origin/codex/react-next-phase-1`
- Last migration checkpoint before this handoff doc:
  - `65f77a6`
  - `Unify Next live settings and mic runtime`

## Repo shape

### Legacy app

- Path:
  - `/Users/alex/Projects/my-tts/apps/web`
- Role:
  - current production baseline
  - Express dashboard
  - overlay SSE fan-out
  - TikTok and YouTube connector runtime
- Port:
  - `3000`

### New app

- Path:
  - `/Users/alex/Projects/my-tts/apps/dashboard`
- Role:
  - routed React/Next replacement dashboard
- Port:
  - `3001`

### Services

- ASR FastAPI:
  - `/Users/alex/Projects/my-tts/services/asr/main.py`
- TTS Python service behind Node boundary:
  - `/Users/alex/Projects/my-tts/services/tts/tts_server.py`

## Architecture decisions already made

- Frontend:
  - `Next.js + React + TypeScript`
- Shared cross-route state:
  - `Zustand`
- Keep Node for now for:
  - TikTok connector runtime
  - YouTube proxy/connector runtime
  - overlay SSE transport
- Keep FastAPI where it already makes sense for:
  - ASR / mic runtime
  - later likely TTS/media-analysis boundaries

Do not reopen these decisions casually in a fresh session. The migration already depends on them.

## Current routed app status

These routes are real, not placeholders:

- `/live`
- `/sounds`
- `/animations`
- `/voices`
- `/mic`
- `/settings/integrations`
- `/settings/overlays`

### Route notes

#### `/sounds`
- Real migrated slice.
- Uses typed API wrappers and Zustand store.
- Supports:
  - sound library loading
  - search/filter
  - upload
  - preview/play/stop
  - delete
  - per-sound settings
  - alert rules editor

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/sounds/sounds-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/api/sounds.ts`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/stores/sounds-store.ts`

#### `/animations`
- Real migrated slice.
- Uses server-provided duration metadata and square thumbnails.
- Supports:
  - library
  - upload
  - refresh
  - delete
  - keyword generation
  - per-item settings
  - live play / stop

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/animations/animations-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/api/animations.ts`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/stores/animations-store.ts`

#### `/voices`
- Real migrated slice.
- Supports:
  - platform default voices
  - cloned voice listing
  - preview
  - default male/female voices
  - Ollama toggle/base URL
  - user voice assignments

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/voices/voices-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/api/voices.ts`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/stores/voices-store.ts`

#### `/live`
- Real route.
- Now focused more on operations than configuration.
- Platform runtime was moved into the shell-mounted live runtime host.
- Page still handles:
  - connect/disconnect actions
  - stream finder
  - activity feed
  - audience/presence display

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/live/live-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-live-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/runtime/live-runtime.ts`

#### `/mic`
- Real route for setup/diagnostics.
- Shared live transcript/runtime behavior is mounted in the shell.
- Enrollment and health logic live here.

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/mic/mic-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-mic-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/api/mic.ts`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/runtime/mic-runtime.ts`

#### `/settings/integrations`
- Real editable route now.
- This is the intended home for:
  - YouTube API keys
  - YouTube channel/stream config
  - TikTok username
  - Ollama base URL
  - Ollama auto assignment toggle
  - Mic ASR URL
  - Mic language

Key files:
- `/Users/alex/Projects/my-tts/apps/dashboard/app/(control-room)/settings/integrations/page.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/settings/integrations-page-client.tsx`

#### `/settings/overlays`
- Real informational route.
- Documents OBS/browser overlay URLs and expected usage.

## Shared runtime shell status

The control-room shell is not just navigation anymore. It owns shared runtime UI and cross-route runtime state.

Key shell files:
- `/Users/alex/Projects/my-tts/apps/dashboard/app/(control-room)/layout.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-shell.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-runtime.tsx`

### Runtime pieces already in the shell

- live platform runtime host
- sound preview runtime
- floating animation live widget
- alert rail
- mic runtime dock

## Important behavior already preserved in the Next app

- routed tool separation instead of one giant page
- sound slice with persisted settings
- animation live-versus-preview semantics
- voice settings and assignment surface
- `/settings/integrations` as a dedicated config route
- `/live` as the operations route
- shared shell runtime for live and mic state

## Biggest remaining gaps

These are the real gaps left, in order of importance.

### 1. Mic parity is not finished

This is the largest remaining product gap.

What exists now:
- shell mic runtime
- transcript logging
- voice-gate sync
- initial transcript matching helper
- initial suggestion/action cards in the dock

What is still not at legacy parity:
- full legacy suggestion mode behavior
- richer suggestion ranking and trigger semantics
- stronger stop/remove behavior parity
- broader test coverage for mic auto/suggest actions

Relevant files:
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-mic-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/lib/mic-trigger-matching.ts`
- legacy reference:
  - `/Users/alex/Projects/my-tts/apps/web/assets/js/mic-trigger.js`
  - `/Users/alex/Projects/my-tts/apps/web/assets/js/keyword-triggers.js`

### 2. Next-side test coverage is still light

What exists:
- dedicated Next smoke lane

Files:
- `/Users/alex/Projects/my-tts/playwright.dashboard.config.js`
- `/Users/alex/Projects/my-tts/tests/e2e/dashboard-smoke.spec.js`

What is still missing:
- focused mic suggestion/auto-trigger browser coverage
- route-level parity checks for animations/sounds runtime interactions
- typed API wrapper tests if those become unstable

### 3. Primary switchover has not happened

The legacy app is still the real production baseline.

The Next app is advanced, but it is not yet declared the primary dashboard.

## Recommended next steps

If a new agent continues from here, the recommended order is:

1. finish mic suggestion/auto-trigger parity in the Next shell
2. add focused Next-side smoke/tests for mic-trigger behavior
3. run a parity pass against the legacy mic/trigger flow
4. decide whether the Next dashboard is ready to become primary
5. only after frontend parity is solid, revisit any deeper FastAPI consolidation

## Validation commands

Minimum required for safe migration work:

- `npm run typecheck:dashboard`
- `npm run build:dashboard`
- `npm run test:dashboard:smoke`

If touching legacy runtime, shared backend behavior, or anything that can spill across both apps:

- `npm run test:smoke`

## Current smoke status at handoff time

These were passing before this doc was added:

- `npm run typecheck:dashboard`
- `npm run build:dashboard`
- `npm run test:dashboard:smoke`
- `npm run test:smoke`

## Files a new agent should inspect first

If continuing implementation, inspect these first:

- `/Users/alex/Projects/my-tts/AGENTS.md`
- `/Users/alex/Projects/my-tts/docs/react-next-migration.md`
- `/Users/alex/Projects/my-tts/docs/migration-baseline.md`
- `/Users/alex/Projects/my-tts/docs/api-inventory.md`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-live-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/control-room/control-room-mic-runtime.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/live/live-page-client.tsx`
- `/Users/alex/Projects/my-tts/apps/dashboard/components/settings/integrations-page-client.tsx`

## Practical resume commands

From repo root:

1. start legacy backend
   - `npm run start:web`
2. start Next dashboard
   - `npm run start:dashboard`
3. open new app
   - [http://127.0.0.1:3001/live](http://127.0.0.1:3001/live)
4. validate
   - `npm run test:dashboard:smoke`

## One-line resume summary

The migration is no longer in scaffolding: the routed Next dashboard is real and broadly functional, the main unfinished parity area is the mic-trigger runtime and its tests.

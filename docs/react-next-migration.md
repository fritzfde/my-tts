# React / Next / FastAPI Migration

## Goal

Move the current dashboard from the legacy DOM-driven app in `/Users/alex/Projects/my-tts/apps/web` into a typed React/Next.js frontend without breaking the current working app during the transition.

## Runtime split during migration

- Legacy dashboard: `/Users/alex/Projects/my-tts/apps/web`
- New frontend workspace: `/Users/alex/Projects/my-tts/apps/dashboard`

Ports during migration:

- `3000`: legacy Express dashboard
- `3001`: Next.js dashboard workspace

## Core architecture decision

Use:

- Next.js + React + TypeScript for the new dashboard frontend
- typed API wrappers around the current backend contract
- shared client stores for cross-route runtime state
- FastAPI where Python services already make sense, without forcing the platform connector layer out of Node too early

## Why Next.js here

The current app has outgrown the single-page control room. The new frontend should be route-based so each tool can load and operate independently instead of booting every dashboard subsystem on one page.

Target routes:

- `/live`
- `/sounds`
- `/animations`
- `/voices`
- `/mic`
- `/settings/integrations`
- `/settings/overlays`

## App shell rule

Build the shell in `apps/dashboard/app/(control-room)/layout.tsx`.

The shell owns:

- primary navigation
- status strip
- floating active playback widgets
- global mic dock host

Each route should lazy-load only its own feature code.

## Migration rule

Do not replace the working app in one step. Migrate feature slices under test coverage.

## Phase 0: foundation

- build route-based app shell in Next.js
- introduce typed API wrapper layer
- establish shared settings hydration pattern
- keep the legacy app as the production baseline while this happens

## Phase 1: sounds

Migrate `Sound Alerts` first.

Why first:

- most self-contained CRUD/settings domain
- establishes cards, dialogs, filters, uploads, persisted settings, and shared wrapper patterns
- lower risk than live chat or mic runtime

## Phase 2: animations

Migrate `Animation Overlay` after sounds.

Why second:

- same overall interaction pattern as sounds
- reuses grid, dialog, sorting, and shared playback concepts
- already depends on clear live-versus-preview semantics we now understand well

## Phase 3: voices

Migrate voice assignment and speech settings.

Scope:

- platform defaults
- speech settings
- cloned voice browser
- hidden/filterable voice management
- AI gender assignment controls

## Phase 4: live

Migrate the operational live surface.

Scope:

- chat feed
- online users / presence
- platform quick controls
- active playback widgets
- runtime status indicators

## Phase 5: mic

Migrate mic configuration and live recognition flows.

Scope:

- mic control card
- enrollment and voice matching settings
- transcript dock
- suggestion mode
- trigger handling UI

## Phase 6: settings routes and legacy retirement

Move remaining integration and overlay settings into dedicated Next.js routes.

Only retire the legacy page after the routed frontend covers the working product.

## Backend migration rule

Do not treat FastAPI migration as the first step.

Instead:

1. keep the current Node contract stable enough for the new frontend
2. wrap it with typed clients
3. migrate backend surfaces intentionally after the frontend structure is established

## What should likely move to FastAPI

Natural FastAPI-owned domains:

- ASR and mic runtime
- TTS service boundary
- media analysis / keyword generation
- possibly settings/media APIs later if there is a clear consolidation benefit

## What can stay in Node for now

Keep these in Node until there is a strong reason to replace them:

- TikTok connector runtime
- YouTube connector/proxy runtime
- overlay event fan-out and SSE transport

This is the pragmatic split. The goal is not ideological purity. The goal is a stable, maintainable product.

## First shared store boundaries

- `settingsStore`
- `platformStore`
- `chatStore`
- `presenceStore`
- `voicesStore`
- `soundsStore`
- `animationsStore`
- `playbackStore`
- `micStore`
- `triggerStore`

Rule:

- keep cross-route runtime state in shared stores
- keep popup form drafts local until save
- do not port `app.js` into one giant React component

## Immediate implementation target

The next practical coding milestone is:

1. route-based app shell in `apps/dashboard`
2. typed API wrappers around the current `/api/*` contract
3. first real migrated slice: `/sounds`

## Companion docs

Use these documents alongside this plan:

- `/Users/alex/Projects/my-tts/docs/api-inventory.md`
- `/Users/alex/Projects/my-tts/docs/migration-baseline.md`

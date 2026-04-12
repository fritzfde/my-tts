# API Inventory

## Purpose

This document is the migration-era source of truth for the current backend contract used by the legacy dashboard in `/Users/alex/Projects/my-tts/apps/web`.

Use it to:

- map legacy fetch calls into typed Next.js API wrappers
- identify inconsistent or legacy route shapes before React migration spreads them further
- decide what stays in Node temporarily and what later moves to FastAPI

## Current backend split

- Express app: `/Users/alex/Projects/my-tts/apps/web/server.js`
- ASR FastAPI service: `/Users/alex/Projects/my-tts/services/asr/main.py`
- TTS Python service behind Express proxy: `/Users/alex/Projects/my-tts/services/tts/tts_server.py`
- Overlay clients: HTML mini-apps under `/Users/alex/Projects/my-tts/apps/web/overlays`

## Route groups

## Settings

### `GET /api/settings`
- Purpose: load persisted dashboard settings blob
- Called from: legacy startup hydration and multiple feature modules via shared settings loader
- Response shape: full settings object
- Notes:
  - currently treated as a whole-document read
  - legacy app still relies on startup hydration semantics
  - initial load should become a typed settings query in Next.js
- Future wrapper:
  - `getSettings()`

### `PUT /api/settings`
- Purpose: persist dashboard settings blob
- Called from: shared settings writer, unload flushes, feature save flows
- Request shape: full settings object
- Response shape:
  - `{ success: true }`
- Notes:
  - whole-document overwrite API
  - current unload `sendBeacon` behavior is fragile and should be wrapped cleanly
- Future wrapper:
  - `saveSettings(settings)`

## Voices / TTS

### `GET /api/voice-clone/voices`
- Purpose: list available cloned voices
- Called from: voice browser and voice assignment UI
- Response shape: array of voice names / metadata objects consumed by legacy UI
- Notes:
  - good candidate for a typed read-only query wrapper
- Future wrapper:
  - `listClonedVoices()`

### `POST /api/voice-clone/tts`
- Purpose: generate spoken audio for a cloned voice
- Called from: legacy TTS engine
- Request shape:
  - text
  - voice id / name
  - generation options
- Response shape: audio binary
- Notes:
  - this is a binary response, not JSON
  - should remain behind a dedicated service wrapper rather than direct component usage
- Future wrapper:
  - `synthesizeClonedVoice(request)`

## Sounds

### `GET /api/sounds/list`
- Purpose: list uploaded sound files
- Called from: sound alerts UI, gift-sounds helpers
- Response shape:
  - array of sound records with filename and path metadata
- Notes:
  - duplicated client logic exists today across `sound-alerts.js` and `gift-sounds.js`
  - `builtIn` response member is currently not meaningfully used
- Future wrapper:
  - `listSounds()`

### `POST /api/sounds/upload`
- Purpose: upload a new sound file
- Called from: sound upload flow
- Request shape: multipart form with `sound`
- Response shape: uploaded sound metadata
- Notes:
  - upload flow is often followed by keyword generation and settings updates
- Future wrapper:
  - `uploadSound(file)`

### `DELETE /api/sounds/:filename`
- Purpose: delete a sound
- Called from: sound library delete flow
- Response shape:
  - `{ success: true }`
- Future wrapper:
  - `deleteSound(filename)`

### `DELETE /api/sounds/custom/:filename`
- Purpose: legacy alias for sound deletion
- Called from: effectively unused legacy paths
- Notes:
  - should not be carried into new React code
  - remove after confirming no remaining callers

### Static `GET /sounds/:filename`
- Purpose: serve sound file for preview and playback
- Notes:
  - remains a media URL rather than a JSON API

## Animations

### `GET /api/animations/list`
- Purpose: list uploaded animations and server-known metadata
- Called from: animation library UI
- Response shape:
  - array of animation records including filename and duration metadata
- Notes:
  - now includes `durationSeconds`, which the React app should rely on instead of browser-side probing
- Future wrapper:
  - `listAnimations()`

### `POST /api/animations/upload`
- Purpose: upload a new animation file
- Called from: animation upload flow
- Request shape: multipart form
- Response shape: uploaded animation metadata
- Notes:
  - often followed by keyword generation
- Future wrapper:
  - `uploadAnimation(file)`

### `DELETE /api/animations/file/:filename`
- Purpose: delete an animation file
- Called from: animation library delete flow
- Response shape:
  - `{ success: true }`
- Future wrapper:
  - `deleteAnimation(filename)`

### `GET /api/animations/thumbnail/:filename`
- Purpose: serve generated square thumbnail preview
- Called from: animation library cards
- Response shape: image binary
- Notes:
  - server-side thumbnail generation and caching are part of the current behavior baseline

### Static `GET /animations/:filename`
- Purpose: serve raw animation media file
- Used by: overlay playback and preview surfaces

### `GET /api/animations/config/:name`
- Purpose: load saved animation config bundle
- Called from: overlay pages and animation settings flows
- Response shape: config object
- Future wrapper:
  - `getAnimationConfig(name)`

### `POST /api/animations/config/:name`
- Purpose: save animation config bundle
- Called from: animation settings flows
- Request shape: config object
- Response shape:
  - `{ success: true }`
- Notes:
  - response semantics differ from `/api/settings`
- Future wrapper:
  - `saveAnimationConfig(name, config)`

### `GET /api/animations/configs`
- Purpose: list saved animation config names
- Called from: currently unused legacy paths
- Notes:
  - keep out of first React slice unless a real UI needs it

### `DELETE /api/animations/config/:name`
- Purpose: delete saved animation config
- Called from: currently unused legacy paths

### `POST /api/animations/trigger`
- Purpose: trigger live overlay playback
- Called from:
  - animation library cards
  - popup `Play Live`
  - mic suggestion clicks
  - automatic keyword / event triggers
- Request shape:
  - trigger metadata and selected animation info
- Response shape:
  - trigger acknowledgement including overlay client counts
- Notes:
  - current UI depends on overlay client counts to avoid fake local live state
  - must preserve live-versus-preview semantics in React
- Future wrapper:
  - `triggerAnimation(request)`

### `POST /api/animations/stop`
- Purpose: stop live overlay playback
- Called from: active animation UI controls and mic dock stop actions
- Response shape:
  - `{ success: true }`
- Future wrapper:
  - `stopAnimation()`

## Platforms / chat transport

### `GET /api/youtube/*`
- Purpose: wildcard proxy to YouTube REST endpoints
- Called from: YouTube platform controller
- Notes:
  - not a stable typed contract by itself
  - React migration should wrap only the actual used operations, not the wildcard pattern
  - good candidate for later normalization into explicit server routes

### `POST /api/tiktok/connect`
- Purpose: connect TikTok live session via Node connector
- Called from: TikTok connect UI
- Response shape: connection result / error payload
- Notes:
  - currently depends on connector runtime and optional sign API key
- Future wrapper:
  - `connectTikTok(request)`

### `GET /api/tiktok/messages`
- Purpose: poll TikTok chat events
- Called from: legacy TikTok client loop
- Response shape: pending message batch
- Notes:
  - destructive polling transport
  - should stay behind a service wrapper until transport is redesigned

### `GET /api/tiktok/audience`
- Purpose: poll TikTok audience / presence state
- Called from: audience panel

### `GET /api/tiktok/gifts`
- Purpose: poll TikTok gift events
- Called from: gift alert handling

### `POST /api/overlay/chat`
- Purpose: broadcast chat message into chat overlay stream
- Called from: platform message pipeline
- Notes:
  - overlay broadcasting should be treated as a runtime service, not component logic

## Overlays

### `GET /overlay/chat/stream`
### `GET /overlay/gifts/stream`
### `GET /overlay/likers/stream`
### `GET /overlay/animations/stream`
- Purpose: server-sent event streams for overlay pages
- Used by: overlay HTML clients and OBS browser sources
- Notes:
  - overlays are separate mini-apps and must stay in scope during migration
  - they are not automatically migrated just because the dashboard UI moves to Next.js

### HTML overlay routes
- `GET /overlay/chat`
- `GET /overlay/gifts`
- `GET /overlay/likers`
- `GET /overlay/animations`
- Purpose: browser/OBS overlay pages
- Notes:
  - keep functioning during frontend migration

## Media keyword generation

### `POST /api/media-keywords/generate`
- Purpose: generate suggested keywords for sounds and animations
- Called from:
  - upload flows
  - popup `Generate` buttons
- Request shape:
  - media type plus item metadata
- Response shape:
  - generated keyword suggestions
- Notes:
  - current request/response shape is polymorphic and should later be made explicit
- Future wrapper:
  - `generateMediaKeywords(request)`

## ASR / mic service boundary

These calls do not go through Express. The browser talks directly to the ASR FastAPI service.

### `GET {MIC_ASR_BASE_URL}/health`
- Purpose: ASR availability check

### `POST {MIC_ASR_BASE_URL}/profile/extract?sample_rate=16000`
- Purpose: create voice profile from enrollment sample
- Response shape: extracted profile metadata and preview payload

### `WS {MIC_ASR_BASE_URL}/ws/mic-trigger?language=...`
- Purpose: live ASR, transcript, and voice-match runtime stream
- Notes:
  - this is already a clean backend boundary and a natural long-term FastAPI-owned surface

## Cleanup opportunities before or during migration

- Normalize inconsistent save semantics across `/api/settings` and `/api/animations/config/*`
- Replace wildcard YouTube proxy usage with explicit typed operations in the new frontend
- Fold `gift-sounds.js` behavior into the main sound-alerts domain instead of migrating duplication
- Treat overlay pages as first-class runtime surfaces during migration, not as incidental assets
- Keep Node for platform connectors until there is a clear replacement path; do not force those flows into FastAPI early

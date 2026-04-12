# Migration Baseline

## Purpose

This document defines the behavior we must preserve while moving from the legacy dashboard in `/Users/alex/Projects/my-tts/apps/web` to the Next.js frontend in `/Users/alex/Projects/my-tts/apps/dashboard`.

The goal is not to reproduce every DOM detail. The goal is to preserve the user-visible product behavior that already works.

## Current product shape

The app is a creator control room for YouTube and TikTok live streams with these major capabilities:

- platform connection and live status
- chat feed and online user tracking
- text-to-speech playback with default and custom cloned voices
- sound alerts with keyword triggers, per-item settings, and alert rules
- animation overlays with live playback, preview, thumbnails, duration metadata, and trigger mappings
- microphone voice recognition with transcription, voice matching, auto-trigger mode, and suggestion mode
- OBS/browser overlays for chat, gifts, likers, and animations

## Behavior that must not regress

## Settings and startup

- persisted settings must survive reload and restart
- startup hydration must restore user choices consistently
- saved filters, sorts, enable flags, and volume values must remain intact

## Live versus preview semantics

### Animations
- clicking an animation card in the library plays live in overlay / OBS
- clicking the same active animation again stops it
- animation popup video is preview-only
- animation popup `Play Live` triggers live overlay playback
- floating animation widget must clearly distinguish `LIVE` versus `PREVIEW`

### Sounds
- sound card click plays the sound
- active sound UI must be stoppable from the relevant control surface
- floating sound widget reflects live sound playback state

## Sound alert behavior

- searchable sound library must remain usable
- per-item settings must persist:
  - keywords
  - viewer chat flag
  - voice flag
  - per-item volume
- bulk per-item viewer-chat actions must remain confirmed actions
- global viewer-chat blocking must remain distinct from per-item enable state
- alert rules must persist and trigger the configured sound and animation actions

## Animation behavior

- searchable animation library must remain usable
- sort modes must include:
  - custom
  - gift name
  - gift value
  - video length
- server-provided duration metadata must continue to drive:
  - card badges
  - video length sorting
- square thumbnails are part of the baseline now
- per-item settings must persist:
  - keywords
  - viewer chat flag
  - voice flag
  - per-item volume
  - scale / position
  - gift / sticker / event mappings

## TTS behavior

- queue semantics remain first-in-first-out with current backlog handling
- low-latency mode behavior must be preserved under busy chat
- autoplay unlock notice should only appear when playback is actually blocked
- cloned voice playback must continue to function through the current service boundary until replaced intentionally

## Mic behavior

- ignored or non-matching mic input must not trigger sounds or animations
- `Only my voice` gate must continue to work
- `Suggestion mode` must not auto-trigger
- clicking a suggestion must trigger the live action and allow stopping it again
- live transcript dock must remain available while listening
- dock controls must preserve:
  - suggestion mode toggle
  - voice match threshold
  - mic level meter
  - mirrored animation and sound volume controls

## Platform behavior

- YouTube and TikTok connection flows must remain functional during migration
- startup/backlog handling must not replay old messages as new live activity
- join / leave / presence semantics must stay consistent

## Overlay behavior

- overlay pages must continue working during frontend migration
- animation overlay delivery is part of the runtime baseline, not an optional extra
- dashboard should not claim an animation is live if no overlay client received the trigger

## Route structure target for the new frontend

The Next.js app should move away from the one-page dashboard and toward route-based tools:

- `/live`
- `/sounds`
- `/animations`
- `/voices`
- `/mic`
- `/settings/integrations`
- `/settings/overlays`

## Migration acceptance rule

A slice is considered migrated only when:

- the equivalent workflow exists in the Next.js app
- typed API wrappers replace ad hoc component fetches
- current high-value tests still pass or are replaced by equivalent coverage
- the legacy behavior listed above is still preserved for that slice

## High-value coverage to keep during migration

Already covered well enough to serve as the baseline:

- settings persistence and startup hydration
- YouTube/TikTok connection behavior
- TTS queue and low-latency behavior
- sound alerts configuration and rules
- animation live/preview behavior and popup `Play Live`
- mic trigger and suggestion-mode semantics

Additional high-value coverage to add during migration:

- overlay delivery smoke for live animations
- browser-level mic suggestion click -> live animation smoke
- route-level Next.js smoke for page isolation once the first slices exist
- typed API contract tests for wrapper functions around the current legacy routes

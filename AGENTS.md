# Agent Start Here

If you are joining this repo in a fresh session, do not infer migration status from the branch name alone.

Read these files first, in this order:

1. `/Users/alex/Projects/my-tts/docs/agent-handoff.md`
2. `/Users/alex/Projects/my-tts/docs/react-next-migration.md`
3. `/Users/alex/Projects/my-tts/docs/migration-baseline.md`
4. `/Users/alex/Projects/my-tts/docs/api-inventory.md`

## Current working split

- Legacy production dashboard:
  - `/Users/alex/Projects/my-tts/apps/web`
  - runs on port `3000`
- New routed React/Next dashboard:
  - `/Users/alex/Projects/my-tts/apps/dashboard`
  - runs on port `3001`

## Non-negotiable migration rules

- Keep the legacy app on port `3000` working until the Next app has real parity.
- Do not collapse the new app back into a one-page dashboard.
- Keep shared runtime behavior in the control-room shell, not inside individual route pages.
- Preserve the behavior baseline in `/Users/alex/Projects/my-tts/docs/migration-baseline.md`.
- Keep the current state model:
  - shared cross-route state in Zustand stores
  - local form drafts in component state until save
- Do not switch state management away from Zustand mid-migration unless there is a concrete technical failure forcing it.

## Validation expectations

Before claiming migration progress is safe, at minimum run:

- `npm run typecheck:dashboard`
- `npm run build:dashboard`
- `npm run test:dashboard:smoke`

If touching legacy runtime or shared backend behavior, also run:

- `npm run test:smoke`

## Main branch context

- Stable legacy improvements were already merged to `main`.
- React migration work continues on:
  - `codex/react-next-phase-1`

Use `/Users/alex/Projects/my-tts/docs/agent-handoff.md` as the authoritative “where we stopped” snapshot.

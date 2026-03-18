# React / Next Migration

## Goal

Move the current dashboard from the legacy DOM-driven app in `/Users/alex/Projects/my-tts/apps/web` into a typed React/Next.js frontend without breaking the current working app during the transition.

## Runtime split

- Legacy dashboard: `/Users/alex/Projects/my-tts/apps/web`
- New frontend workspace: `/Users/alex/Projects/my-tts/apps/dashboard`

Ports during migration:

- `3000`: legacy Express dashboard
- `3001`: new Next.js dashboard

## Migration rule

Do not replace the working app in one step. Migrate feature slices under test coverage:

1. app shell and layout
2. shared state and settings
3. sound alerts
4. animation mappings
5. chat and online users
6. mic trigger
7. remaining platform controls

## Immediate next coding step

Build the typed app shell and add the first shared client store for:

- persisted settings
- sound alert library
- animation mappings
- online presence
- chat feed

## Temporary contract rule

Until FastAPI replaces the legacy backend, the Next.js app should treat the current `/api/*` routes as the backend contract and introduce typed wrappers around them instead of calling `fetch()` ad hoc from components.

# Technologies Used (CV Tracker)

This file tracks technologies used in this project so they are easy to reuse in CV/portfolio updates.

## Used Now (Current Project)

### Languages
- JavaScript (Node.js, browser)
- Python 3.10
- HTML5
- CSS3
- Bash (automation scripts)
- SQL (SQLite usage)

### Frontend / Client
- Vanilla JavaScript (modular app logic in `apps/web/assets/js/app.js`)
- Web Speech API (browser TTS for non-cloned voices)
- EventSource / Server-Sent Events (overlay live updates)

### Backend (Web App)
- Node.js
- Express
- CORS
- Multer (file uploads)
- node-fetch (HTTP proxy calls)
- tiktok-live-connector (TikTok live integration)

### AI / TTS Service
- Flask (Python TTS API server)
- Coqui TTS (`TTS` package, XTTS v2 model)
- PyTorch (`torch`)
- torchaudio
- Hugging Face Transformers / Tokenizers (used as part of XTTS stack)
- NumPy
- SoundFile / SoundDevice

### Data / Storage
- SQLite (settings persistence, animation config persistence)
- File-system storage for assets (voices, animations, sounds)

### Testing / Quality
- Playwright (E2E smoke tests, headed/headless/UI mode)

### DevOps / Automation
- GitHub Actions (nightly + manual smoke workflow)
- Git pre-push hook (local smoke gate)
- npm scripts for service orchestration and test commands

### Integrations / External APIs
- YouTube Data API v3 (proxied through backend)
- TikTok Live events via connector library

## Planned Next (Not Yet Primary in Mainline)

- React (UI migration)
- TypeScript (frontend typing and maintainability)
- Next.js (framework option for product shell/auth pages)
- FastAPI (Python API modernization option)
- PostgreSQL (scale-ready DB)
- Docker / containerization (web + TTS + DB)

## Notes

- Keep this file updated when a technology moves from "Planned Next" to "Used Now".
- Prefer listing technologies that are actually implemented in code, not only discussed.

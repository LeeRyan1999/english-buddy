# 英語夥伴 English Buddy

Live: https://leeryan1999.github.io/english-buddy/

PWA for Chinese→English translation (with TTS), grammar correction, word lookup (offline dictionary of 5,000 common words from [ECDICT](https://github.com/skywind3000/ECDICT), MIT licence), and Notion vocabulary quizzes. With no backend configured it runs in **demo mode**, using mock data.

## Backend (`server/`)
A small Express proxy that keeps the API keys secret. It has `/api/translate`, `/api/correct`, `/api/explain`, `/api/quizcheck`, `/api/chat`, `GET/POST /api/vocab` and `/health`.

Environment variables:
- `APP_ACCESS_CODE` (required)
- `GEMINI_API_KEY` (or `OPENAI_API_KEY`)
- `GEMINI_MODEL` (default `gemini-3.5-flash-lite`; falls back to `GEMINI_FALLBACKS`)
- `NOTION_TOKEN`, plus either `NOTION_PAGE_ID` (page mode: reads and appends bullets like `word（PRON）：解釋。例句：…` on a plain page; takes priority) or `NOTION_DATABASE_ID` (database mode)
- `ALLOWED_ORIGINS` (default `https://leeryan1999.github.io`)

Deploy on Render with a Blueprint, using `render.yaml` from this repo.

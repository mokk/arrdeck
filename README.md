# arrdeck

A self-hosted, mobile-first control panel for a media server stack: one app to
watch, search, add and manage everything across **Radarr**, **Sonarr**,
**Prowlarr**, **qBittorrent**, **Transmission** and **Overseerr** (used as a
TMDB discovery proxy).

## Features

- **Dashboard** — live torrent activity (minute-averaged speeds), download
  queues, upcoming releases, consolidated history with event tags, indexer
  stats, and 30-day trend sparklines.
- **Downloads** — merged torrent list across both clients with filters, sorting,
  swipe actions, bulk select, per-torrent details (files, speed limits,
  category, recheck), and blocklist-&-retry for failed grabs.
- **Add** — popular movies/series (filtered to English + Nordic originals),
  search, one-tap add with quality profile/root folder, in-place editing of
  library items, IMDb/TMDB/TVDB links.
- **Series management** — per-season and per-episode monitoring, searches, and
  interactive release picking.
- **Manage** — libraries, Prowlarr indexers (including adding new ones from the
  full definition catalog), and service connection settings stored in SQLite.
- **i18n** — English and Danish, no external services.

## Stack

- **Backend**: FastAPI + httpx (async), SQLite for settings/stats. Pure JSON
  API under `/api/v1` — no sessions, portable to a future native client.
- **Frontend**: React 19, TypeScript 7, Vite, Tailwind v4, shadcn/ui,
  TanStack Query, framer-motion, react-i18next.
- **Deploy**: single container (multi-stage Dockerfile), stateless except for
  the `data/` volume.

## Setup

```sh
cp .env.example .env   # fill in service URLs and API keys (first-boot seed)
docker compose up -d --build
```

The app runs on port 3500. After first boot, connection settings live in the
SQLite DB (`data/arrdeck.db`) and are managed in the UI under
Manage → Services; the `.env` is only used to seed an empty database.

## Development

```sh
# backend
cd backend && python -m venv ../.venv && ../.venv/bin/pip install -r requirements.txt
cp ../.env .env && ../.venv/bin/uvicorn app.main:app --port 3500 --reload

# frontend (Vite dev server proxies /api to :3500)
cd frontend && npm install && npm run dev

# regenerate frontend API types after backend changes
npm run gen:api
```

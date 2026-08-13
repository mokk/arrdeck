# arrdeck roadmap

Agreed scope: toasts, series management, interactive search, bulk actions, torrent
details, failed-download handling, history page, pull-to-refresh + skeletons,
generated API types, stats over time.

**Status: all phases (A–G) implemented and deployed 2026-08-13.**

## Phase A — Foundations

### A1. Toast notifications
- `npx shadcn add sonner`; mount `<Toaster>` in `App.tsx` (dark, top-center).
- Global `MutationCache.onError` on the QueryClient in `main.tsx` → `toast.error(message)`
  so every failed action (swipe pause, delete, save, grab…) surfaces without per-call wiring.
- Success toasts only for fire-and-forget actions with no visible state change:
  add media, indexer added, settings saved, search triggered, blocklist & retry.
  No toasts for polling queries.

### A2. Generated API types (openapi-typescript)
- Backend: add missing `response_model`/return annotations so the OpenAPI spec is complete —
  notable gaps: `/queue`, `/torrents`, `/calendar`, `/history` (dict[str, ServiceBlock] needs
  a typed generic), `/options/{app}`, manage endpoints returning plain dicts.
  Add small `Out` models in `schemas.py` where missing.
- Frontend: dev-dep `openapi-typescript`; script `npm run gen:api` →
  `src/api/schema.d.ts` from `http://localhost:3500/api/v1/openapi.json`.
- Rewrite `src/api/types.ts` as aliases into `components["schemas"]` so existing imports
  keep working; delete hand-written interfaces. Drift then breaks the build instead of runtime.

## Phase B — Downloads power features

### B1. Bulk actions
- Downloads page: "Select" toggle → rows get checkboxes (tap toggles selection,
  swipe disabled while selecting); fixed action bar above the tab bar with
  Pause / Resume / Delete (± data, confirm) for N selected.
- No backend work: existing `POST /torrents/{client}/{action}` already takes `ids[]`;
  group selection by client and fire one mutation per client.

### B2. Torrent detail sheet upgrades
- Backend clients:
  - qBittorrent: `torrents/files`, `torrents/recheck`, `torrents/setDownloadLimit`,
    `torrents/setUploadLimit`, `torrents/categories` + `torrents/setCategory`.
  - Transmission: `torrent-get` fields `files`/`fileStats`, `torrent-verify`,
    `torrent-set` `downloadLimit/uploadLimit(+limited)`.
- New endpoints:
  - `GET /api/v1/torrents/{client}/{id}/details` → files (name, size, progress),
    category (qbit), current dl/ul limits.
  - `POST .../recheck`, `POST .../limits {dl_kib, ul_kib}` (0 = unlimited),
    `POST .../category {category}` (qbit only).
- TorrentSheet: collapsible Files section with per-file progress, Recheck action,
  two small limit inputs with save, category select.

### B3. Failed-download handling
- Extend `QueueItemOut` with `movie_id` / `series_id` / `episode_ids`.
- `POST /api/v1/queue/{app}/{id}/blocklist-retry`: look up the queue record,
  `DELETE queue/{id}?blocklist=true&removeFromClient=true`, then trigger
  `MoviesSearch` / `EpisodeSearch` (fall back to `SeriesSearch`) so a replacement
  is grabbed immediately.
- Frontend: errored queue rows (Dashboard + Downloads) get a "Blocklist & retry" button.

## Phase C — Series management (seasons + episodes)

- Sonarr client: `episodes(series_id)`, season monitor toggles via `PUT /series`
  (mutate `seasons[]`), `PUT /episode/monitor {episodeIds, monitored}`,
  commands `SeasonSearch`, `EpisodeSearch`.
- Endpoints:
  - `GET /api/v1/library/series/{id}` → seasons: number, monitored, episode counts, size.
  - `GET /api/v1/library/series/{id}/episodes?season=` → number, title, air date,
    has_file, monitored, episode id.
  - `POST .../seasons/{n}/monitor {monitored}`, `POST .../seasons/{n}/search`,
    `PATCH /api/v1/library/episodes/monitor {ids, monitored}`,
    `POST /api/v1/library/episodes/search {ids}`.
- Frontend: new route `/series/:id` (drill-in page with back button — content too big
  for a sheet). Season cards with monitor toggle + search; expand → episode rows with
  has-file badge, air date, monitor toggle, per-episode search.
- Entry points: series row tap in Manage → Series; "Manage seasons" button in the
  Add page's edit sheet for in-library series.

## Phase D — Interactive search (manual release picking)

- Radarr `GET /api/v3/release?movieId=`; Sonarr `GET /api/v3/release?episodeId=` and
  `?seriesId=&seasonNumber=`; grab via `POST /api/v3/release {guid, indexerId}`.
  60s timeouts (indexer fan-out is slow).
- Endpoints: `GET /api/v1/releases/movie/{movie_id}`,
  `GET /api/v1/releases/series/{series_id}?season=&episode_id=`,
  `POST /api/v1/releases/{app}/grab`.
  Return: title, quality, size, seeders, indexer, age, rejection reasons, approved flag.
- Frontend: ReleaseSheet — sorted by seeders, rejected releases greyed with reason,
  Grab per row. Entry points: "Interactive search" in MediaSheet (in-library),
  per-season/episode on the series page.

## Phase E — Full history page

- `GET /api/v1/history/all?page=` — pulls page N (50/app) from Radarr + Sonarr,
  consolidates with the existing grouping, returns merged list + `has_more`.
- New route `/history`, linked from the Dashboard section header ("See all →").
  Filter chips (app, tag type, client-side), "Load more" pagination,
  same consolidated tag rows as the dashboard.

## Phase F — App feel

- **Pull-to-refresh**: wrapper around `<main>` — touch-drag down at `scrollTop === 0`
  (framer-motion drag), spinner, on release `queryClient.invalidateQueries()`.
- **Skeletons**: `npx shadcn add skeleton`; BlockView loading state → skeleton rows;
  poster grid → pulsing 2:3 placeholders; library lists → skeleton rows.

## Phase G — Stats over time

- SQLite table `stats_samples (ts, movies, series, episode_files, library_bytes,
  torrents_qbit, torrents_tm, indexer_grabs, indexer_queries)`.
- Background sampler task in the FastAPI lifespan: every 6h (+ at startup when the
  last sample is stale); prune older than 1 year.
- `GET /api/v1/stats/history?days=30`.
- Dashboard "Trends" card: inline-SVG sparklines (no chart lib) for library size,
  counts, grabs, with current value + 30-day delta.

## Order & sizing

| Phase | Size | Depends on |
|-------|------|-----------|
| A1 toasts | S | — |
| A2 generated types | M | — |
| B1 bulk actions | S | A1 |
| B2 torrent details | M | A1 |
| B3 blocklist & retry | S | A1 |
| C series management | L | A1 (toasts), pattern reused by D |
| D interactive search | M | C (entry points) |
| E history page | S | — |
| F pull-to-refresh + skeletons | S | — |
| G stats over time | M | — |

Suggested sequence: A1 → A2 → B1–B3 → C → D → E → F → G.

## Verification per phase
- A1: fail a mutation on purpose (stop a service) → error toast; add a movie → success toast.
- A2: `npm run gen:api && npm run build` clean; intentionally rename a backend field → build fails.
- B: bulk-pause 3 torrents across both clients; recheck + limit a test torrent and confirm in
  the native WebUI; break a download and blocklist-retry it, verify blocklist entry in Radarr.
- C: toggle a season off/on in Sonarr UI comparison; episode search grabs.
- D: pick a specific release for an episode, confirm grab lands in the queue.
- E: page through >100 history entries; filters match dashboard tags.
- F: pull-to-refresh on phone updates data; slow-network first load shows skeletons.
- G: after two sampler runs, `/stats/history` returns ≥2 points; sparkline renders.

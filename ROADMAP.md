# arrdeck roadmap

Phases are lettered so a task can be started with just "do phase K". Each one is
self-contained and deployable on its own; the order in the table at the bottom is
a suggestion, not a dependency chain (real dependencies are called out per phase).

## Shipped

Full implementation notes for A–G are in this file's git history (`git log -p -- ROADMAP.md`).

| Phase | What | Deployed |
|-------|------|----------|
| A | Toasts, generated API types | 2026-08-13 |
| B | Bulk actions, torrent detail sheet, blocklist & retry | 2026-08-13 |
| C | Series management (seasons + episodes) | 2026-08-13 |
| D | Interactive search (manual release picking) | 2026-08-13 |
| E | Full history page | 2026-08-13 |
| F | Pull-to-refresh + skeletons | 2026-08-13 |
| G | Stats over time (sampler + sparklines) | 2026-08-13 |
| H | Push: webhooks, coalescing, deep links, event catalogue | 2026-08-19 |

Also already done, and easy to mistake for gaps: **cutoff-unmet** (it's the second
subnav tab on `/wanted`, `manage.py:483` takes `kind=missing|cutoff`), **per-file
selection**, **tracker health**, **collections**, **settings export/import**.

## Adding a service (shared checklist)

Phases O, P, Q and R each add a new service. Every one touches the same eight places:

1. `backend/app/db.py` → `SERVICES`
2. `backend/app/config.py` → url/key fields, and `.env.example`
3. `backend/app/registry.py` → `NEEDS_API_KEY` (if it takes one) + a `Registry.rebuild` branch
4. `backend/app/clients/<name>.py` → subclass `BaseClient`, implement `status()` for the version probe
5. `frontend/src/api/format.ts` → `SERVICE_LABELS`
6. `frontend/src/pages/Manage.tsx` → `SERVICE_FIELDS` + `FIELD_KEYS`
7. `frontend/src/locales/{en,da}.json` → both, or the build fails
8. A `ServiceBlock`-wrapped endpoint so the dashboard degrades when it's down

---

## I. Health & capacity

The dashboard shows everything except the two numbers you'd actually open the app to check.

- **Disk space.** `GET /api/v3/diskspace` on both arrs → `[{path, label, freeSpace, totalSpace}]`.
  Add `diskspace()` to `ArrClient` in `clients/base.py` (shared, like `history()`).
  New `GET /api/v1/diskspace` merging both and de-duplicating by path — Radarr and
  Sonarr usually report the same mounts. Dashboard card with a bar per root folder.
- **Arr health warnings.** `GET /api/v3/health` — identical shape to Prowlarr's, which
  is already surfaced at `dashboard.py:601`, and `HealthItemOut` (`schemas.py:189`)
  is reusable as-is. Fold into the existing status card; badge count when non-empty.
- **Queue stall detection.** `/queue` records carry `trackedDownloadStatus` (`ok`/
  `warning`/`error`), `trackedDownloadState` and `errorMessage`. Flag non-ok rows on
  Dashboard + Downloads; pairs with the blocklist-retry button from phase B.
- **Trend it.** Add `disk_free_bytes` to `db.STATS_COLUMNS` and the `stats.py` sampler,
  then a sparkline on `/stats`. **Gotcha:** `CREATE TABLE IF NOT EXISTS` will not add a
  column to the existing `stats_samples` — needs an `ALTER TABLE ... ADD COLUMN` guarded
  by a `PRAGMA table_info` check, the first real migration in this codebase.

## J. Notification leftovers

Finishes phase H. Small.

- **Test notification button** in the Notifications card: `POST /api/v1/push/test` →
  `push.notify(db, Event(key="test", ...))`. The `test` key already bypasses the
  preference filter and the coalescer, so this is one endpoint and one button.
- **Per-device event preferences.** Today `push_events` is one global kv list, so
  every device gets the same set. Move it onto the subscription: `push_subscriptions`
  gains an `events` column (ALTER TABLE, see the gotcha in phase I), `_send_all`
  filters per row, and the chips in Manage bind to the current device's subscription
  when there is one. Keep the global list as the default for new devices.

## K. Auth & hardening

- **Session management.** The `sessions` table already stores `created`/`last_used`;
  nothing surfaces it. Add `session_list()` / `session_delete_all()` to `db.py`,
  `GET`/`DELETE /api/v1/auth/sessions`, and a list in the Security card next to the
  passkeys — "sign out everywhere" matters more than deleting a passkey, since the
  180-day cookie outlives it.
- **Login throttling.** `/api/v1/auth/*` is exempt from `auth_guard` and unthrottled.
  **Do not rate-limit per IP** — Docker Desktop NATs every inbound connection to one
  gateway address, which is exactly why `is_lan()` is Host-header-based. Use a global
  failed-attempt counter in `kv` with exponential backoff on `/login/verify` and
  `/register/verify`. The 8-char setup code isn't brute-forceable in practice; this is
  about making a wrong guess cost something.

## L. App feel

- **Offline shell.** The service worker precaches the app shell and posters but no API
  responses, so opening the PWA without network shows an empty app. Add
  `@tanstack/query-async-storage-persister` + `persistQueryClient` over `idb-keyval`
  in `main.tsx`. Persist queries only (never mutations), `maxAge` ~24h, and exclude
  `["authState"]` / `["setupCode"]` from the dehydrate filter so a stale cache can't
  make a logged-out session look authenticated. Biggest perceived-speed win available:
  the last dashboard renders instantly on cold launch.
- **Manifest shortcuts.** `shortcuts: [...]` in the `VitePWA` manifest
  (`vite.config.ts`) for Downloads and Add. Pure config, no code — but **iOS ignores
  them**, so this only pays off on Android/desktop. Cheap enough to do anyway.

## M. Codebase health

- **CI.** No `.github/` at all. One workflow: `pytest` (47 tests) + `npm run build`
  (which already runs `check-locales.mjs` and `tsc --noEmit`). Repo is
  `git@github.com:mokk/arrdeck.git`.
- **Frontend tests.** Zero today. Vitest + Testing Library; start with `api/format.ts`
  and the `queries.ts` hooks against a mocked `api` client.
- **Container healthcheck.** Nothing in the Dockerfile. **Gotcha:** `python:3.13-slim`
  has no `curl`, so use `HEALTHCHECK CMD python -c "import urllib.request; urllib.request.urlopen('http://localhost:3500/api/v1/services')"`
  — note that path 401s from a non-LAN Host, but `localhost` is trusted by `is_lan()`.
- **Split the big files.** `Manage.tsx` is 1369 lines, `queries.ts` 835, `Downloads.tsx`
  794. `Manage.tsx` is the worst and the most mechanical: each `*Card` becomes its own
  file under `components/manage/`.

## N. Downloads power-ups

All client-side plumbing already exists; these are thin additions to `clients/`.

- **Global speed toggle.** qBittorrent `/transfer/toggleSpeedLimitsMode` (state is in
  `transfer_info()`'s `use_alt_speed_limits`, which `dashboard.py:319` already fetches —
  the flag is one field away from being free). Transmission `session-set
  {"alt-speed-enabled": bool}`, read from the existing `session()`. One tap to throttle
  the stack from the phone while something is streaming.
- **Queue priority.** qBittorrent `/torrents/topPrio`, `/torrents/bottomPrio`,
  `/torrents/setForceStart`; Transmission `queue-move-top` / `queue-move-bottom`.
  Add to the torrent detail sheet next to Recheck.
- **qBittorrent tags.** `/torrents/tags`, `/torrents/addTags`, `/torrents/removeTags` —
  mirrors the category select that's already in the sheet.

## O. Overseerr as a request manager

`OverseerrClient` is used purely as a TMDB discovery proxy today and is **GET-only** —
it needs a `post()` method before anything here works.

- `GET /api/v1/request?filter=pending&take=20`, `POST /api/v1/request/{id}/approve`,
  `POST /api/v1/request/{id}/decline`.
- Dashboard card: pending count + approve/deny inline. No new service, no new auth.
- Natural follow-on: show request status on the Movie/Series pages so you can see
  something was already requested before adding it directly.

## P. VPN & uptime

- **gluetun.** Control server exposes `/v1/publicip/ip` and `/v1/openvpn/portforwarded`.
  **Prerequisite:** the HTTP control server must be enabled in
  `/Volumes/Data/docker/glue_torrent/docker-compose.yml` (and it's authenticated in
  recent gluetun — needs a role/API-key file). Surface as a dashboard row: tunnel IP,
  forwarded port, and whether that port matches qBittorrent's listen port. This is the
  "is my torrenting actually private and actually connectable" check.
- **Uptime Kuma.** No clean REST API — the options are the Prometheus `/metrics`
  endpoint (basic auth, parseable) or socket.io. Worth it only to widen the Manage
  status strip from arrdeck's six services to the whole stack; skip if `/metrics`
  turns out to be a fight.

## Q. Bazarr (subtitles)

Runs in the stack, arrdeck knows nothing about it. Auth is `X-API-KEY`, base `/api`.

- `GET /api/movies/wanted`, `GET /api/episodes/wanted` → missing-subtitle counts.
- `PATCH /api/movies?action=search-missing` / per-item search.
- Surface as a count on the Dashboard and a "Subtitles" row in the Movie/Series pages
  with a search button. Follows the phase-D interactive-search pattern.

## R. Media server integration

The biggest gap: Plex, Emby and Jellyfin all run alongside arrdeck and none is wired in.
Pick one to start — Plex if it's the primary, Jellyfin if you want the cleanest API.

- **Now playing.** Plex `GET /status/sessions` (`X-Plex-Token`); Jellyfin/Emby
  `GET /Sessions` (`X-Emby-Token`). Dashboard card with who's watching what.
- **Watched state.** Jellyfin `GET /Users/{id}/Items?fields=UserData`; Plex
  `/library/sections/{id}/all` with `viewCount`. Show a watched dot on library rows
  and the Movie page — this is what changes day-to-day feel most.
- **Play button.** Deep-link out rather than embedding a player: `plex://`,
  `infuse://`, or the server's web URL. Cheapest useful piece; consider doing it first.

Size this as **L** — it's a new client, a new dashboard block, and a join between the
arr library and the media server's library (match on TMDB/IMDb id, not title).

## S. Library tags

Unsupported everywhere — `manage.py:108` even strips `tag`/`tagSelect` field types out
of the indexer schema form. Tags are how most people segment their arrs.

- `GET /api/v3/tag` on both arrs; movies/series already carry `tags: [id]` in the
  payloads the library endpoints parse.
- Filter chips on the library lists (reuse the `SortSheet` drawer pattern).
- Bulk tag apply/remove: `bulk_edit` already exists on both clients; `manage.py:440`
  builds the payload explicitly, so this is extending `BulkEditIn` with
  `tags` + `apply_tags` ("add"/"remove") and two more lines in that dict.

## T. Manual import & rename

The one arr workflow with no arrdeck path at all. Largest remaining feature.

- **Reuse what's there:** `manual_import(download_id)` already exists on both clients
  (`radarr.py:73`, `sonarr.py:75`) — it's only used to power force-import today.
- Full flow: list candidate files, let the user pick the movie/episode and quality per
  file, then `POST /api/v3/command {name: "ManualImport", files: [...], importMode}`.
- **Rename:** `GET /api/v3/rename?movieId=` / `?seriesId=` previews the changes,
  `POST /command {name: "RenameFiles", files: [...]}` applies them.
- Needs a full page, not a sheet — the file/target picker is too tall for a drawer.
  Follow the `/series/:id` drill-in precedent from phase C.

---

## Order & sizing

| Phase | Size | Notes |
|-------|------|-------|
| I health & capacity | M | best value/effort left; includes the first DB migration |
| J notification leftovers | S | finishes H |
| K auth & hardening | S | independent |
| L app feel | M | offline cache is the big win |
| M codebase health | M | do before the large phases, not after |
| N downloads power-ups | S | thin client additions, foundations already fetched |
| O overseerr requests | M | no new service, needs `post()` on the client |
| P VPN & uptime | M | gluetun needs a compose change first |
| Q bazarr | M | new service |
| R media server | L | new service + a library join |
| S library tags | M | reuses bulk_edit |
| T manual import & rename | L | new page; reuses `manual_import()` |

Suggested sequence: **I → J → M → N → L → O → K → S → Q → P → R → T**.
Front-loads the small, high-value ones and gets CI in place before the large phases.

## Verification per phase

- **I**: pull a drive's worth of free space and confirm the card matches `df`; break an
  indexer in Radarr and confirm the health badge appears; confirm the migration runs
  against the existing `data/arrdeck.db` without losing samples.
- **J**: test button lands a banner on two devices; disable an event on one device only
  and confirm the other still receives it.
- **K**: sign in on a second device, list two sessions, revoke all, confirm both are
  logged out; 20 bad setup codes in a row should start being refused.
- **L**: airplane mode → the app opens showing the last dashboard; confirm a logged-out
  session still shows the login screen with a warm cache.
- **M**: CI red on a deliberately broken test, green on main; `docker inspect` shows the
  container healthy.
- **N**: toggle alt-speed and confirm in both native WebUIs; force-start a queued torrent.
- **O**: request something in Overseerr, approve it from arrdeck, confirm it reaches Radarr.
- **P**: stop the VPN container and confirm the row goes red; compare the forwarded port
  against qBittorrent's listen port.
- **Q**: a movie with missing subtitles shows a count; triggering a search reaches Bazarr's log.
- **R**: start playback and confirm it appears within one poll; watched state matches the
  media server for a title with a differing name (proves the id join, not a title match).
- **S**: tag a movie in Radarr, filter by it in arrdeck; bulk-add a tag to 3 items.
- **T**: import a file the arr couldn't place automatically; preview a rename and apply it.

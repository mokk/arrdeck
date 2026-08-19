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
| I | Disk space, arr health warnings, queue stall detection | 2026-08-19 |
| J | Push test button, per-device event preferences | 2026-08-19 |
| K | Session list + revoke, login throttling | 2026-08-19 |
| L | Offline query cache, manifest shortcuts | 2026-08-19 |
| M | CI, vitest, container healthcheck, Manage.tsx split | 2026-08-19 |
| N | Alt-speed toggle, queue priority, qBittorrent tags | 2026-08-19 |
| O | Overseerr request queue with approve/decline | 2026-08-19 |
| P | gluetun VPN card (Uptime Kuma deliberately skipped) | 2026-08-19 |
| Q | Bazarr missing-subtitle counts and search | 2026-08-19 |
| R | Plex now-playing + open-in-Plex links | 2026-08-19 |
| S | Radarr/Sonarr tags: filter chips and bulk apply | 2026-08-19 |
| T | Manual import sheet, rename preview and apply | 2026-08-19 |

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

## Not done

Deliberately dropped or deferred during I–T:

- **Uptime Kuma** (was part of P) — skipped by choice. arrdeck already probes its
  own nine services; Uptime Kuma has no clean REST API and would mostly duplicate that.
- **Watched state and the library id-join** (was part of R) — R shipped now-playing
  and play deep-links only. Watched dots on library rows still need matching Plex's
  library to the arrs by TMDB/IMDb id, which is the bulk of that work.
- **Manual-import target picker** (was part of T) — the sheet lists what the arr
  found, shows why it balked, and imports the files it *can* map. Re-assigning a file
  to a different movie/episode by hand still means opening the arr.

## Next candidates

- **U. Watched state** — finish R: join Plex's library to Radarr/Sonarr on
  TMDB/IMDb id, show a watched dot on library rows and the Movie page. Needs a
  cached id map; the sessions client and service entry already exist.
- **V. Manual-import target picker** — finish T: let a file be pointed at a
  chosen movie/episode + quality. `GET /api/v3/movie/lookup` and the existing
  episode endpoints supply the pickers.
- **W. Notification rules** — per-event routing beyond on/off, e.g. only notify
  for tagged series (phase S made tags available), or quiet hours.
- **X. Frontend test depth** — 12 vitest tests today, all on `format.ts` and the
  query hooks. The page components have none.

Notes carried forward:

- Adding a service still means the eight places listed above; `tests/test_services.py`
  now fails the build if the `ServiceName` literal, registry branch or version probe
  is missed (it caught exactly that during P).
- `stats_samples` and `push_subscriptions` both have migrations now — follow the
  `_migrate_columns` pattern in `db.py` rather than editing the CREATE TABLE.
- gluetun's control server is authenticated: the role lives in
  `glue_torrent/gluetun/data/auth/config.toml` (gitignored) and grants only
  `GET /v1/publicip/ip`, `/v1/portforward` and `/v1/vpn/status`.

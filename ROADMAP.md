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
| U | Plex watched state joined to the arrs, watched dots | 2026-08-19 |
| V | Manual-import target picker | 2026-08-19 |
| W | Notification rules: quiet hours and tag filters | 2026-08-19 |
| X | Frontend test depth (12 → 43 vitest tests) | 2026-08-19 |

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

- **Uptime Kuma** (was part of P) — skipped by choice. arrdeck already probes its
  own nine services; Uptime Kuma has no clean REST API and would mostly duplicate that.
- **Emby and Jellyfin** — both run alongside Plex, but R and U integrated Plex only.
  The two share an API, so one client would cover both if it ever matters.
- **Page-component tests** — X covered the load-bearing logic (fetch wrapper, id
  join, sorting, persistence, hooks) and one component. Full pages are still untested.

## Next candidates

Nothing is half-finished; these are new work.

- **Y. Notification actions** — buttons on the banner itself (blocklist & retry a
  failed download, approve a request) via `showNotification`'s `actions`, handled in
  the service worker. iOS support is limited, so check before building.
- **Z. Calendar polish** — the card is the first thing on the dashboard now; a
  week strip and per-day drill-in would earn that position.
- **AA. Library health** — surface Radarr/Sonarr's own "missing files" and
  orphaned-file checks, which neither the health card nor Wanted covers today.

Notes carried forward:

- Adding a service means the eight places listed above; `tests/test_services.py`
  fails the build if the `ServiceName` literal, registry branch or version probe
  is missed (it caught exactly that during P).
- `stats_samples` and `push_subscriptions` both have migrations — follow the
  `_migrate_columns` pattern in `db.py` rather than editing the CREATE TABLE.
- gluetun's control server is authenticated: the role lives in
  `glue_torrent/gluetun/data/auth/config.toml` (gitignored) and grants only
  `GET /v1/publicip/ip`, `/v1/portforward` and `/v1/vpn/status`.
- `starlette` is pinned deliberately — it arrives via fastapi, whose range let a
  fresh build jump to 1.6 while local venvs sat on 0.46.
- jsdom 29 ships no `Storage`, so `src/test-setup.ts` supplies one; without it
  anything built on `usePersistentState` is untestable.

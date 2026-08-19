# arrdeck roadmap

Phases are lettered so a task can be started with just "do phase C". Each is
self-contained and deployable on its own.

**Lettering restarted here.** The previous roadmap (phases A–X, all shipped:
toasts, generated types, bulk actions, series management, interactive search,
history, stats, push/webhooks, disk & health, sessions, offline cache, CI,
downloads power-ups, Overseerr requests, gluetun, Bazarr, Plex, tags, manual
import, watched state, notification rules, frontend tests) is in git history —
`git log -p -- ROADMAP.md`.

Everything below came out of a survey of the running system on 2026-08-19, not
from a wishlist. Measurements are from the live stack.

## Where the pain actually is

| Finding | Measured |
|---|---|
| `/torrents` is re-fetched every 5s while Downloads is open | **536 KB × 12/min ≈ 385 MB/hour** (1,789 torrents: 383 qBittorrent + 1,406 Transmission) |
| Single JS bundle, no code splitting | **831 KB** (250 KB gzip); build warns about it every time |
| Poster cache never pruned | **71 MB / 283 files** and only grows |
| A render error blanks the whole app | no error boundary anywhere |
| Losing `data/arrdeck.db` loses passkeys, VAPID key, rules and stats | settings export covers `services` only |
| Backend has no request ids or structured logs | uvicorn defaults only |
| Accessibility | 4 `aria-*` attributes total, 20 raw `<button>`s |

---

## Shipped

| Phase | What | Result |
|-------|------|--------|
| A | Server-side torrent filter/sort/cap | 536 KB → 126 KB per poll; search 536 KB → 1 KB |
| B | Route-level lazy loading | entry chunk 831 KB → 236 KB (73 KB gzipped) |
| C | Poster cache eviction + TMDB size normalisation | 1.1 MB `/original` → 157 KB `w500`; 256 MB cap |
| D | Error boundary per route and per dashboard card | one bad card no longer blanks the app |
| E | Full backup/restore + rolling sqlite copies | passkeys, VAPID keypair, stats; sessions excluded |
| F | JSON logs with request ids | id echoed in the header, the 502 body and the toast |
| G | Blocklist management | view, unblock, clear per app |
| H | Import lists | toggle and sync (none configured yet, so the card hides) |
| I | Arr log viewer | Radarr/Sonarr/Prowlarr with level filtering |
| J | Split the fat modules | route surface verified identical at 115 |

## Remaining

- **K. Accessibility pass** — 4 `aria-*` attributes across the app, 20 raw
  `<button>`s, colour-only signals (the watched dot, state badges), no
  focus-visible styles. **Size: M.**
- **L. Calendar week and agenda views** — the month grid is the only shape, and
  Upcoming now leads the dashboard. **Size: M.**
- **M. Emby and Jellyfin** — both running; they share an API, so one client
  covers both and can feed the existing `/sessions` and `/watched`. **Size: M.**
- **N. Unpackerr and download-client health** — extraction failures are a common
  cause of a download that completes and never imports. **Size: S.**

Files still over ~400 lines, deliberately left rather than churned in one pass:
`ServicesTab.tsx` (777), `schemas.py` (747), `manage.py` (632), `Libraries.tsx` (621).

## Notes carried forward

- Adding a service means eight places (`db.SERVICES`, `config`, `.env.example`,
  `registry` incl. `NEEDS_API_KEY` and `probe_version`, a client, `SERVICE_LABELS`,
  `SERVICE_FIELDS`, both locales). `tests/test_services.py` fails the build if the
  `ServiceName` literal, registry branch or version probe is missed.
- Schema changes go through `_migrate_columns` in `db.py`, not the CREATE TABLE.
- `starlette` is pinned deliberately: it arrives via fastapi, whose range let a
  fresh build jump to 1.6 while local venvs sat on 0.46.
- jsdom 29 ships no `Storage`; `src/test-setup.ts` supplies one.
- gluetun's control server is authenticated — the role lives in
  `glue_torrent/gluetun/data/auth/config.toml` (gitignored) and grants only
  `GET /v1/publicip/ip`, `/v1/portforward`, `/v1/vpn/status`.
- Not running, so not proposed: Readarr, Jackett, Uptime Kuma, FileBrowser, Pi-hole.

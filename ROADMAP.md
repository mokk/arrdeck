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

## Nothing outstanding

Every lettered phase across both rounds is shipped and every module is under 400
lines. Emby/Jellyfin (M) was dropped for good — Plex covers now-playing and
watched state, and those two would only duplicate it.

Ideas that came up and were deliberately left, should they ever matter:

- **Notification actions** — buttons on the banner itself (blocklist & retry a
  failed download, approve a request) via `showNotification`'s `actions`. iOS
  support is limited; check before building.
- **Popular beyond 24h** — needs arrdeck to accumulate releases itself, because
  Prowlarr caps every search at 100 with no paging.
- **Manual-import target picker for episodes** — the picker asks for a season
  number by hand rather than listing seasons, since nothing cheap enumerates them.
- **Uptime Kuma** — no clean REST API; would mostly duplicate the existing probes.

| Phase | What | Shipped |
|-------|------|---------|
| K | Accessible names, focus rings, non-colour signals + static guards | 2026-08-20 |
| L | Calendar week strip and day-grouped agenda | 2026-08-20 |
| N | Unpackerr extraction state via Prometheus, download-client checks | 2026-08-20 |

### Modules over ~400 lines — done

Every file is now under 400 lines. What moved:

| Was | Lines | Became |
|-----|-------|--------|
| `ServicesTab.tsx` | 841 | `settings/{connections,security,notifications,transfer}` + a 98-line composer |
| `schemas.py` | 795 | `schemas/{common,torrents,library,system}` behind a re-exporting barrel |
| `manage.py` | 731 | `{indexers,library,wanted,arrmeta}` routers; the shell was deleted |
| `Libraries.tsx` | 630 | `library/{shared,movies,series}` + a 3-line barrel |
| `downloads.py` | 581 | `{torrentactions,importing,arrqueue}` routers; the shell was deleted |
| `push.py` | 552 | `push/{events,delivery,pipeline,sources}` package |
| `media.py` | 544 | `{posters,discover,releases,requests}` routers; the shell was deleted |
| `useLibrary.ts` | 516 | split, plus hooks relocated to `useMedia.ts` and `useSystem.ts` |
| `useDownloads.ts` | 416 | split out `useArrQueue.ts` |

Verified after every move: 120 routes and 124 schema components unchanged, pyflakes
clean of undefined names, 162 backend + 54 frontend tests green, and every
ServiceBlock endpoint reporting `ok` rather than merely returning 200.

Three traps this hit, all the same shape — a declaration sitting *between*
functions gets swept into the wrong module:

- `urlBase64ToUint8Array` (lowercase, so excluded from the component grouping)
- `MOVIE_SORT_KEYS` / `SERIES_SORT_KEYS`, and `TorrentQuery`
- `proxy_poster`, needed by two modules after moving to a third

pyflakes and `tsc` caught all of them. The earlier `_speed_samples` incident is
the same bug reaching production because nothing checked for it.

Splitting `push.py` also broke monkeypatching: tests patched `push._send_all`,
but `pipeline` now holds its own reference, so patches have to target the module
that uses the name. `import *` also skips underscore names, so the tested
private surface is re-exported explicitly from the barrel.

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

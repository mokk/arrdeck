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

## A. Shrink the torrents payload

The single biggest runtime cost in the app. 1,789 torrents are serialised in
full every five seconds so a virtualised list can show ~15 of them.

- Add `?fields=list` to `GET /api/v1/torrents` returning only what a row needs
  (id, name, state, progress, size, speeds, eta, uploaded, tracker). Drop
  `trackers[]`, `error`, `ratio` detail into the existing per-torrent details call.
- Server-side filter + sort + limit, so the client stops receiving 1,406 rows to
  display 15. The state/name/client filters in `Downloads.tsx` move to query params.
- Consider a slower interval for a list that isn't actively downloading — the
  5s cadence exists for progress bars, and most of those torrents are idle seeds.

**Verification**: payload under 50 KB with the same visible rows; sorting and the
state filter still agree with the native WebUIs. **Size: M.**

## B. Split the JS bundle

`vite.config.ts` still runs with `inlineDynamicImports`, which emits a deprecation
warning on every build and forces one 831 KB chunk.

- Switch to `build.rolldownOptions.output.codeSplitting` and lazy-load routes with
  `React.lazy` — Manage (three heavy tabs), Stats, Calendar and History are all
  off the first paint path.
- Keep the service worker's precache list in step; `injectManifest` globs `**/*.js`,
  so new chunks are picked up but the precache total will change.

**Verification**: initial chunk under ~300 KB; the PWA still opens offline. **Size: S.**

## C. Prune the poster cache

`data/posters` is 71 MB across 283 files with no eviction — `media.py` writes and
never deletes.

- Evict by age or total size on a schedule (the stats sampler loop is already there
  and runs every 6h).
- Cap it explicitly and log what was dropped.

**Verification**: fill the cache past the cap, confirm it settles and posters still
render. **Size: S.**

## D. Error boundary

There is no boundary in the tree. One thrown render — a malformed API shape, an
undefined field — replaces the entire app with a blank page, including the nav
that would let you leave.

- A boundary around `<Routes>` in `App.tsx` showing the error and a reload button.
- A second, narrower one per dashboard card so a single bad card can't take the
  dashboard with it.
- Pairs well with the persisted query cache from the old phase L: a stale card is
  better than no app.

**Verification**: throw deliberately in one card; the rest of the dashboard survives.
**Size: S.**

## E. Back up everything, not just services

`GET /settings/export` returns `services` only. The database also holds 2 passkeys,
4 sessions, 2 push subscriptions, 23 stats samples and 8 kv rows (VAPID keypair,
webhook token, notification rules, setup code). Losing the file means
re-registering every passkey and losing all history.

- Extend export to a full snapshot, with credentials clearly marked and opt-in.
- Import that restores it. **Gotcha**: push subscriptions are bound to the VAPID
  keypair, so the keypair has to come back with them or every device goes silent —
  this is exactly why `vapid_private_pem` must never be regenerated.
- A scheduled copy of `arrdeck.db` alongside the poster prune in phase C.

**Verification**: export, delete the DB, import, and confirm a passkey still signs
in and push still delivers. **Size: M.**

## F. Request ids and structured logs

No logging config exists. When something 502s there is nothing to correlate a
browser error toast with a backend line.

- `logging.dictConfig` with a JSON formatter, level from env.
- Middleware assigning a request id, returned as a response header and included in
  the `ServiceUnavailable` payload so a toast can quote it.
- Log upstream failures once, with the service and the id.

**Verification**: break a service, match the toast to a log line by id. **Size: S.**

## G. Blocklist management

Radarr already has an entry in it (`/api/v3/blocklist`, 1 record) put there by
arrdeck's own blocklist-&-retry, with no way to see or undo it.

- `GET /api/v1/blocklist` merged across both arrs, `DELETE` per entry and a clear-all.
- Surface on the History page, where blocklist events already appear as tags.

**Verification**: blocklist a release, see it listed, remove it, confirm in the arr.
**Size: S.**

## H. Import lists

`/api/v3/importlist` is reachable and unused. This is how a library grows on its own
— Trakt lists, TMDB collections, a followed person.

- List, enable/disable and trigger a sync per list.
- Show what a list added recently, tying into the existing "recently added" strip.

**Verification**: toggle a list, trigger a sync, confirm the arr's own log agrees.
**Size: M.**

## I. Arr log viewer

`/api/v3/log/file` is reachable. Today debugging a failed grab means opening
Radarr, then Sonarr, then Prowlarr in separate tabs.

- Tail the last N lines per service with a level filter, behind Manage.
- Include Prowlarr; it's the one whose failures are least visible elsewhere.

**Verification**: trigger a failure, find it in-app without opening the arr.
**Size: M.**

## J. Split the fat modules

Growth since the last split has re-concentrated the code:

- `frontend/src/hooks/queries.ts` — **1,106 lines**, every hook in the app.
  Split by domain (downloads, library, media-servers, settings) re-exported from
  one index so imports don't churn.
- `backend/app/api/v1/dashboard.py` — **930 lines**, and no longer just the
  dashboard: it now owns health, VPN, subtitles, Plex sessions, watched state and
  disk space. Those are four unrelated routers wearing one hat.
- `frontend/src/pages/Downloads.tsx` (866) and `Dashboard.tsx` (857) — the
  dashboard is now nine card components in one file.

**Verification**: build and tests unchanged; no file over ~400 lines. **Size: M.**

## K. Accessibility pass

4 `aria-*` attributes across the whole app and 20 raw `<button>` elements, several
carrying only an icon or a coloured dot as their meaning.

- Labels on icon-only controls (sort, back, the ✕ delete buttons).
- The watched dot and state badges need text alternatives — colour alone carries
  meaning in several rows.
- Focus-visible styles; the app is currently only usable by touch and mouse.

**Verification**: keyboard-only navigation of Downloads and Manage; VoiceOver reads
each row meaningfully. **Size: M.**

## L. Calendar week and agenda views

`Calendar.tsx` has a month grid and a day list. Now that Upcoming leads the
dashboard, the calendar it links into deserves more than one shape.

- A week strip and a flat agenda ("next 14 days"), switchable via the existing subnav.
- Per-day drill-in already exists; reuse it.

**Verification**: an episode airing today appears in all three views. **Size: M.**

## M. Emby and Jellyfin

Both are running (Emby 4.9.5 on :8096 behind `/emby`, Jellyfin 10.11.11 on :9080)
and neither is integrated — Plex got the now-playing card and the watched join.
They share an API, so one client covers both.

- Two service entries, one `EmbyClient` differing only in base path.
- Feed the same `/sessions` and `/watched` endpoints so the cards merge sources
  rather than gaining a second copy.

**Verification**: play something on Jellyfin, see it in the same card as Plex.
**Size: M.**

## N. Unpackerr and download-client health

`unpackerr` is running and invisible to arrdeck; extraction failures are a common
cause of a download that completes and never imports.

- Unpackerr exposes Prometheus metrics; surface extraction failures next to the
  queue-stall detection that already exists.
- Also expose the arrs' `/api/v3/downloadclient` so a misconfigured client shows up
  in the health card instead of as mysterious silence.

**Verification**: break an extraction, see it flagged in-app. **Size: S.**

---

## Order & sizing

| Phase | Size | Why here |
|-------|------|----------|
| A torrents payload | M | 385 MB/hour is the worst measured problem |
| D error boundary | S | cheapest resilience win in the list |
| C poster prune | S | unbounded disk, trivial fix |
| B bundle split | S | removes a standing build warning |
| F request ids | S | makes everything after it easier to debug |
| E full backup | M | the DB is now genuinely irreplaceable |
| G blocklist | S | closes a loop arrdeck itself opened |
| J split modules | M | do before the larger features land |
| N unpackerr | S | small, and explains a real failure mode |
| H import lists | M | how the library grows without you |
| I arr logs | M | stops the tab-hopping |
| L calendar views | M | earns the spot it now occupies |
| K accessibility | M | overdue |
| M Emby/Jellyfin | M | only if you actually use them over Plex |

Suggested sequence: **A → D → C → B → F → E → G → J → N → H → I → L → K → M**.
Performance and resilience first, then the module split before the bigger features,
then breadth.

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

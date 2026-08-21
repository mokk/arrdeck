# arrdeck roadmap — fourth round

Written from a fresh survey on 2026-08-21, after A–K shipped. Everything below
is grounded in something measured against the running stack, not guessed at.

## Where things actually stand

- **8,309 lines** of backend Python in 58 files, **12,623** of frontend TS in 94.
- **222 backend tests at 65% coverage**, floor of 60% enforced in CI.
- **168 frontend tests at 27.6% coverage**, and **no threshold at all** in CI.
- 124 routes, 41 route groups. All endpoints answer in under half a second warm.
- Zero health warnings, zero TODO/FIXME markers, lint clean on both sides.

The previous round closed the structural debt: modules are split, linters and
coverage run in CI, the cache is bounded, upstream calls retry, both detail pages
share a shell. What the survey turns up now is mostly **untested surface**,
**one duplicated endpoint I added last round**, and a handful of arr APIs that
are still dark.

## A. Delete the endpoint phase K duplicated — done

Removed. Route surface 124 -> 123. `QualityProfileOut` in `schemas/library.py`
stays: it is still what `OptionsOut.quality_profiles` uses for the dropdowns —
only the route was duplicated, not the schema.

## A-original. Delete the endpoint phase K duplicated

`/profiles` in `arrmeta.py` already returned per-app quality profiles — id, name,
`upgrade_allowed`, and the raw `cutoff` id. Phase K added
`/quality-profiles/{app}`, a strict superset, without noticing it. `/profiles`
has **no frontend caller**.

- Delete `/profiles` and its schema; `/quality-profiles/{app}` covers it.
- Check the same way before the next endpoint: 11 of 124 routes have no literal
  match in the frontend, and most are dynamic-path false positives — but this one
  was real and a grep would have found it.

**Verification**: route count drops by one, frontend build unaffected.
**Size: S.**

## B. Put a floor under frontend coverage — done

**27.6% -> 36.7%**, with a CI floor at 34/78/42/34 (statements/branches/functions/
lines) set just under where it landed. The floor was checked by raising it to 95%
and confirming CI exits 1 — a threshold that cannot fail is decoration.

87 tests across `dashboard/activity.tsx` and `dashboard/cards.tsx`, both **0% ->
100% statements**. `Blocks.tsx` came along for the ride, 71.9% -> 86.8%.

Each card is covered in all four states it can be in — loading, healthy, offline
(`ok:false` with no data), and stale (`ok:false` with data plus an age) — plus the
conditional logic: the 15/12/8 row caps, calendar sort with undated entries
parked last, queue badge precedence, which actions appear for which tracked
state, the `configured` gating, storage's no-bar-without-a-total, the VPN
port-mismatch warning and the sparkline's flat-series divide-by-zero guard.

Deliberately uncovered: `ImportSheet` internals (own fetch surface, deserves its
own file), locale-dependent date output (asserted through ordering instead so the
tests do not break on a machine with a different `Intl` default), and `isPending`
button states.

**This turned up seven real defects** — see the new phase L. Writing the tests
was worth it for those alone.

## B-original. Put a floor under frontend coverage

The backend has a 60% floor in CI. The frontend runs coverage and **enforces
nothing**, so 27.6% can slide to 20% unnoticed. The gaps are not obscure:

| area | coverage |
|------|----------|
| `src/components/dashboard` | **0%** |
| `src/pages/Downloads.tsx` | **0%** |
| `src/pages` overall | 15.6% |
| `src/hooks` | 21.4% |

The dashboard is the home screen and Downloads is the second-most-used page.

- Cover the dashboard cards and the Downloads page the way the library lists and
  detail pages now are — render with mocked hooks, assert what the user sees.
- Then set a threshold just under wherever that lands, as a floor not a target.

**Verification**: CI fails on a deliberate coverage drop. **Size: M.**

## C. Test the webhook installer — done

**22% -> 100%** on `app/webhooks.py`, 38 tests. Backend total 65% -> 67%.

Covered: token and URL derivation, `guess_base_url` precedence, install (add /
update / skip / per-app failure isolation), payload shaping, the notification
schema lookup including the missing-`Webhook`-schema case an arr version change
would cause, status, uninstall, and every branch of the error formatter.

The tests were checked against mutation rather than assumed sound: four
behaviours were monkeypatched out at runtime and each was caught by the
corresponding test.

**Fragilities found and deliberately not fixed** (see the new phase K):
- `install` persists the base URL *before* proving it works, and
  `guess_base_url` prefers the stored value, so a typo is sticky.
- `_find_existing` matches on the substring `/api/v1/hooks/` alone, ignoring
  token and host — a second arrdeck instance against the same arr silently
  overwrites the first.
- `uninstall` reports `installed: False` even when the delete raised.
- A scheme-less service URL makes `guess_base_url` fall back to
  `http://localhost:3500`, which is unroutable from inside an arr container.
- Nothing calls `test_notification()`; validation relies entirely on the arrs
  validating on save.
- `HOOK_APPS` omits Prowlarr, which has the same notification API.

## C-original. Test the webhook installer

`webhooks.py` is **127 statements at 22% coverage** — the least-tested code in
the backend, and it writes to three arrs: it creates, updates and deletes
notification entries in Radarr, Sonarr and Prowlarr to wire up arrdeck's push.

A silent failure here means notifications stop and nothing says so. It is also
the code most likely to break when an arr changes its notification schema.

- Cover install, re-install over an existing entry, the schema lookup, and the
  failure paths, against a fake arr.

**Verification**: the module clears 70%, and a schema change surfaces as a test
failure rather than a missing notification. **Size: S.**

## D. An unknown URL renders a blank page — done

`components/NotFound.tsx` plus a `path="*"` route, last in the table so it cannot
shadow a real one. It names the path that failed, which makes a bad deep-link
diagnosable, and links back to the dashboard.

Checked while here: every push deep-link (`/manage`, `/movie/{id}`,
`/series/{id}`, `/history`) is a real route, so notifications were not the source.
A `/movie/{id}` for a deleted film still resolves and the page shows its own
error, which is correct.

**Verified**: 7 tests — known paths still resolve, unknown and deep-unknown paths
land on the catch-all, the failing path is displayed, the way back exists, and
the route stays last in the table.

## D-original. An unknown URL renders a blank page

There is no catch-all route. `/nonsense` returns the SPA shell with HTTP 200 and
then renders nothing — no message, no way back. Easy to hit from a stale
notification deep-link or a mistyped bookmark.

- A catch-all that says the page does not exist and offers the dashboard.
- Worth checking the push deep-links land on routes that still exist, since that
  is the likeliest source.

**Verification**: an unknown path renders something. **Size: S.**

## E. Say when the arrs are out of date — done

`/status` now carries `update_available`, and the status strip shows an amber
version plus an arrow when a service knows about a newer release. Flagging all
three today: Radarr 6.2.1 -> 6.3.0, Sonarr 4.0.18 -> 4.0.19, Prowlarr
2.4.0 -> 2.5.2.

Two decisions worth recording:
- The version shown stays the **installed** one; the arrow is a hint rather than
  a claim about what is running. arrdeck cannot apply an update — these are
  Docker images — and should not imply it can.
- **Flaky wins the dot.** Both states wanted amber, and a service dropping
  connections matters more than its version being a point release behind.

The check is cached for an hour rather than run per poll — the arrs run their own
`ApplicationCheckUpdate` every six hours, so anything finer is waste. That needed
care: `cached()` treats a bare `None` as a miss, so "up to date" is cached as
`{"version": None}`; caching it as `None` would have re-checked three services on
every status poll. Verified: repeat `/status` calls run in ~10ms with zero
`/api/v3/update` requests logged.

## E-original. Say when the arrs are out of date

`/update` is unused, and **all three arrs are behind right now**: Radarr
6.2.1 → 6.3.0, Sonarr 4.0.18 → 4.0.19, Prowlarr 2.4.0 → 2.5.2. The status strip
already shows installed versions; it just never says they are stale.

- Amber on the version chip when a newer release exists, with the target version.
- These run in Docker so arrdeck cannot apply an update, and should not pretend
  to — this is information, not an action.

**Verification**: the strip flags all three today, and stops flagging one after
its image is pulled. **Size: S.**

## F. "Why hasn't this arrived?"

The headline feature of this round. arrdeck already holds every piece of the
answer and makes the user assemble it: the queue, the blocklist, indexer
stats, scheduled tasks, health warnings, and — still unused — `/delayprofile`,
which explains a grab that is deliberately waiting.

For a wanted title, one view that answers in order:
- Is it in the queue, and what state? Is it stalled or waiting on an import?
- Was a release grabbed and blocklisted? (`/blocklist` is exposed but unread by
  the frontend.)
- When did RSS sync last run, and is it overdue? (Phase I already has this.)
- Is a delay profile holding it — `usenetDelay`/`torrentDelay`, bypass rules?
- Did the indexers return anything at all? (`indexers/stats` has the failure
  counts.)

This is synthesis, not new API surface, which is why it is worth doing: every
input already exists and is already cached.

**Verification**: a wanted title with no releases, one with a blocklisted grab,
and one waiting on a delay each produce a different, correct explanation.
**Size: L.**

## G. Quality definitions beside the profiles card — done

`/qualitydefinition` folded into the existing `/quality-profiles/{app}` response
rather than a second endpoint — the card already fetches per-app, and the bands
are context for the profile above them. A failure there is swallowed: the bands
are decoration, the profiles are the point.

Collapsed behind a count, because the two arrs differ sharply: **Sonarr has 22
real bands** (Bluray-720p is 4–130 MB/min) while **Radarr's are all the stock
0–100**. Expanded, an absent ceiling shows as ∞ rather than 0, which would read
as "nothing is allowed" — Sonarr's Raw-HD has no max.

Ordered by the arr's own `weight`, so the table reads in the same direction as the
quality ladder above it.

## G-original. Quality definitions beside the profiles card

`/qualitydefinition` is 30 rows of min / preferred / max size per quality, and
sits naturally next to the profiles card phase K shipped — it answers "why was
this release rejected for size" which the profile alone cannot.

- Show the size band per quality, on the same System tab.
- Only worth doing if the profiles card proves useful in practice. It has not
  been in use long enough to say.

**Verification**: bands match Radarr's Quality settings page. **Size: S.**

## H. Slim the watched map — done

Measured first, as the phase asked: **66% of the 98 KB was Plex URLs**, and every
one carried the same `app.plex.tv/#!/server/{machineId}/details?key=...` prefix —
only the trailing rating key varied.

The prefix now ships once as `base_url` and each entry carries `key` instead of a
full `url`. **98.1 KB -> 35.1 KB, a 64% cut** across 593 entries.

No consumer changed: `watchedFor()` composes the link from the prefix and the
key, so the three call sites still read `.url` off what it returns. The link goes
undefined when Plex gave no machine id or an entry has no key, which is what an
unconfigured or partial Plex looks like.

## H-original. Slim the watched map

`/watched` is **99 KB across 590 entries** and loads on every dashboard visit. It
carries a Plex URL per entry, most of which are never used — only the handful of
titles actually on screen need one.

- Drop the URL from the map and resolve it on demand, or key the map more
  cheaply.
- Client-side it is cached for ten minutes, so this is a first-load cost rather
  than a recurring one. Measure before assuming it matters.

**Verification**: payload drops materially with the watched dots unchanged.
**Size: S.**

## I. Files creeping back over 400 lines — done

`api/v1/library.py` 410 -> **79**, split into `movies.py` (111), `series.py`
(175) and `credits.py` (78); `library.py` keeps only the app-agnostic search
trigger and bulk actions. `schemas/library.py` 414 -> **261**, with the library
proper moved to `schemas/media.py` (166) behind the same barrel.

The recurring hazard bit again and was caught: `CREW_JOBS`/`CAST_LIMIT` sat
between `movie_detail` and `movie_credits`, and `_season_out` between
`delete_movie` and `series_detail` — both would have been swept into the wrong
module. pyflakes also caught `HTTPException` being used in the new `series.py`
without an import, which would have been a `NameError` the first time a season
lookup missed.

Route surface unchanged at 123 with no schema collisions. Nothing above 400 lines
remains; the next four are 407, 403, 399 and 398.

## I-original. Files creeping back over 400 lines

The previous round's standard was 400. Five files have drifted back to the edge:
`schemas/library.py` 414, `api/v1/library.py` 410, `hooks/useSystem.ts` 407,
`dashboard/activity.tsx` 403, `settings/notifications.tsx` 399.

`library.py` is the one that matters — it now holds movies, series, episodes,
credits and bulk actions in one module.

- Split `library.py` along movies / series / credits.
- Remember the recurring hazard: a declaration sitting *between* two functions
  gets swept into the wrong module.

**Verification**: route surface and schema count unchanged. **Size: S.**

## J. Look at it — still blocked, one part done

**Blocked on the browser.** The automation browser still cannot reach the LAN: it
loads example.com but not `10.0.0.154:3500` or `localhost:3500`, while curl gets
200 on every route from the same host. Everything from last round's phase G
onward — the light theme, the series detail page, the cast strip, the profiles
card, the size bands, and now the fixes in L — is verified by tests, API diffs
and compiled-CSS inspection but has **never been seen by a human**.

Highest-value things to glance at, in order: light-mode poster grids and the
Stats charts, the cast strip on a narrow screen, and the profile quality chips
plus size-band table, which are the densest layout in the app.

**Done**: `posterOpens` is gone. Both library lists open their detail page from
the poster; only the series list did, which was an oversight rather than a
distinction, preserved through F only because that phase was meant to change
nothing.

## J-original. Look at it, then fix what looking reveals

Everything from phase G onward — the light theme, the series detail page, the
cast strip, the profiles card — is verified by tests, API diffs and compiled-CSS
inspection, and **has never been seen by a human**. The automation browser lost
LAN access mid-round and never recovered.

Known-unverified specifically: light-mode poster grids and Stats charts, the cast
strip on a narrow screen, and the profile quality chips, which are the densest
layout in the app.

Also outstanding and deliberately parked: **`posterOpens`** — only the series
poster opens its detail page, not the movie one. Preserved through phase F's
refactor because that phase was meant to change nothing.

**Verification**: a pass over every page in both themes on a phone. Needs either
the user's eyes or working browser automation. **Size: S**, but blocking for
anything visual.

## L. Fix what the tests found — partly done

Writing B's and C's tests turned up fifteen defects. The user-visible ones are
fixed; the rest are recorded here.

**Fixed:**
- `TrendsSection` printed the literal string **"undefined"** as a tile value.
  `movies`, `series` and `indexer_grabs` are optional, and a snapshot taken while
  an arr was down had them absent — the sparklines beside them already used
  `?? 0`.
- A playing Plex session was badged **"downloading"**. The badge was chosen for
  its colour; the word is what the user reads, and nothing was downloading.
- The queue card reported a **stale** block as an outage, rendering
  "Radarr offline — undefined" above the items it was still listing. Stale now
  gets the same age note every other card uses, and a genuine outage with no
  error text says "offline" rather than interpolating null.
- The calendar claimed **"nothing scheduled"** when it simply could not reach an
  arr. It now only says that when both arrs answered.
- `HistorySection` had **no empty state** — a title, a "see all" link and a blank
  card.
- `uninstall` reported `installed: False` **even when the delete raised**, so the
  row read as removed while the entry was still live and push kept firing.
- `install` persisted the base URL **before anything validated it**, and
  `guess_base_url` prefers the stored value — so a typo stuck permanently. It is
  now saved only once an arr has accepted it.
- An existing entry with no `id` raised `KeyError`, surfacing as the error text
  `'id'`. It now refuses explicitly rather than adding a duplicate the user could
  not tell apart.

**Still open, recorded rather than fixed:**
- Four cards — `NowPlayingSection`, `HealthSection`, `RequestsSection`,
  `SubtitlesSection` — read `data?.data ?? []` and hide when empty, so an outage
  is indistinguishable from "nothing to report". Worst for health: a Radarr
  outage makes existing warnings vanish rather than saying they could not be
  fetched. **Size: S.**
- `_find_existing` matches on the substring `/api/v1/hooks/` alone, ignoring
  token and host, so a second arrdeck instance against the same arr silently
  overwrites the first. **Size: S.**
- A scheme-less service URL makes `guess_base_url` fall back to
  `http://localhost:3500`, unroutable from inside an arr container. **Size: S.**
- Nothing calls `test_notification()`; validation relies entirely on the arrs
  validating on save. **Size: S.**
- `HOOK_APPS` omits Prowlarr, which has the same notification API. **Size: S.**
- `RecentSection` prints the title twice when there is no poster. **Size: S.**
- `status(db, registry)` never uses its `db` parameter. **Trivial.**

## Order & sizing

| Phase | Size | Why here |
|-------|------|----------|
| A delete the duplicated endpoint | S | my own mess, and it is five minutes |
| D catch-all route | S | a blank page is the worst failure mode in the app |
| E flag stale arr versions | S | true today, and small |
| C test the webhook installer | S | least-tested code that writes to three services |
| B floor under frontend coverage | M | do before B's targets grow further |
| J look at it | S | blocks judging anything visual; needs the user |
| I re-split the drifting files | S | cheap, and keeps the last round's standard |
| H slim the watched map | S | measure first; may not be worth it |
| G quality definitions | S | only if the profiles card earns its place |
| F "why hasn't this arrived?" | L | the round's real feature, once the rest is calm |

Suggested sequence: **A → D → E → C → B → J → I → H → G → F**.

Small corrections first, then the testing gap, then a human pass, then the one
large feature — so F lands on a codebase that is both covered and seen.

## Notes carried forward

- Adding a service means eight places (`db.SERVICES`, `config`, `.env.example`,
  `registry` incl. `NEEDS_API_KEY` and `probe_version`, a client,
  `SERVICE_LABELS`, `SERVICE_FIELDS`, both locales).
  `tests/test_services.py` fails the build if any is missed.
- Schema changes go through `_migrate_columns` in `db.py`, never the CREATE TABLE.
- `starlette` is pinned deliberately: it arrives via fastapi, whose range let a
  fresh build jump to 1.6 while local venvs sat on 0.46.
- jsdom 29 ships no `Storage`; `src/test-setup.ts` supplies one and registers
  Testing Library's cleanup, which does not auto-register without vitest globals.
- gluetun's control server is authenticated — the role lives in
  `glue_torrent/gluetun/data/auth/config.toml` (gitignored) and grants only
  `GET /v1/publicip/ip`, `/v1/portforward`, `/v1/vpn/status`.
- Unpackerr is read through Prometheus (:9090), which already scrapes it;
  unpackerr itself publishes no reachable port. Its counters are lifetime totals,
  so they must be read via `increase(...[1h])`.
- Prowlarr caps every search at 100 results and ignores `offset`. The Popular
  page works only because it queries each sub-category separately.
- Splitting a module breaks monkeypatching: patch the module that *uses* a name,
  not the barrel that re-exports it. `import *` also skips underscore names.
- A declaration sitting *between* two functions is the recurring split hazard —
  it gets swept into the wrong module. pyflakes and `tsc` catch it; nothing else does.
- After any refactor, check ServiceBlock endpoints for `ok: true`, not HTTP 200 —
  `guarded()` turns exceptions into healthy-looking 200s.

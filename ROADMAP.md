# arrdeck roadmap

Phases are lettered so a task can be started with just "do phase C".

**Third lettering round.** The previous two rounds are shipped in full and live in
git history (`git log -p -- ROADMAP.md`): the first built the app out (toasts,
series management, interactive search, push/webhooks, stats), the second hardened
it (payload size, bundle splitting, error boundaries, backup/restore, request ids,
blocklist, import lists, arr logs, accessibility, calendar views, unpackerr) and
finished by getting every module under 400 lines.

Everything below came from a survey of the running system on 2026-08-20.
Measurements are from the live stack, not estimates.

## Where things actually stand

18,400 lines, 120 endpoints, 216 tests, a 231 MB image, 27 JS chunks, ten
services integrated. Nothing is broken. What follows is mostly the debt left by
moving fast, plus capability the arrs expose that arrdeck still ignores.

| Finding | Measured |
|---|---|
| Internal helpers exported from every split module | **17 exports** no other file imports |
| `TTLCache` never evicts, and keys embed date ranges | `calendar:radarr:{start}:{end}` — a new permanent key per week browsed |
| Linter comments for a linter that was never wired up | **19 files** carry `# noqa`; no ruff, eslint or biome anywhere |
| No coverage measurement | 216 tests, no idea what they miss |
| No retry on upstream calls | one blip fails the request; no backoff in any client |
| The two library lists are near-copies | `movies.tsx` / `series.tsx`, 225 lines each, **76% identical** |
| Dark theme only | zero `prefers-color-scheme` handling |
| Three hooks poll every 5s | queue, torrent summary, Plex sessions — battery cost on a phone |

---

## A. Tighten module boundaries — done

Shipped in 47fbaa4, though the heading was never marked. `export` dropped from
every helper with no consumer outside its own file, eight genuinely dead
declarations deleted, and `module-boundaries.test.ts` added as the guard.

Two of the deletions the phase called for turned out to be wrong: `STATE_COLORS`
and `MediaHead` are both live *inside* their own file, so un-exporting was the
correct outcome rather than removal. `SortBar` was dead and is gone.

The guard has since earned its place twice, catching an exported type in the
library refactor (F) and three internal theme helpers (G).

## A-original. Tighten module boundaries

The 400-line split was mechanical, and the script exported everything it moved.
`Sparkline`, `SheetButton`, `EventToggles`, `TorrentDetailsSection`,
`NotificationRules` and a dozen more are `export`ed but used only inside their own
file — so nothing stops a future import reaching past a module's front door.

- Drop `export` from anything with no external consumer.
- Delete what is genuinely dead: `STATE_COLORS`, `MediaHead`, `SortBar`, and the
  unused type aliases in `api/types.ts`.
- Add a test in the shape of the existing a11y guards that fails on an export
  nothing imports, so the next split can't reintroduce this.

**Verification**: build and tests unchanged; the new guard fails if an export is
added without a consumer. **Size: S.**

## B. Bound the cache — done

Shipped: `TTLCache` is an `OrderedDict` with an LRU cap of 512 entries. Both
`get()` and `get_stale()` move a key to the end, so the fixed-key dashboard
blocks (`diskspace`, `health`, `vpn`, `watched`) stay resident while one-off
date-range keys churn past them. Evictions are logged and counted, and `stats()`
exposes entries/cap/evictions.

The "bucket calendar keys by month" idea was dropped: with an LRU cap the
unbounded-growth problem it solved no longer exists, and bucketing would make a
week view re-fetch a whole month.

**Verified**: 104 distinct calendar keys (a year of weeks x 2 arrs) left the cache
well inside the cap, and with bazarr stopped past its 300s TTL `/subtitles`
returned `ok=false` with `stale_age_seconds=470` and the last good payload intact
— the stale path the cap could have broken still works. 9 unit tests cover the
eviction order, including that reads protect an entry from eviction.

## B-original. Bound the cache

`TTLCache` retains every value forever — deliberately, so an offline service can
render stale data. But the key space is unbounded: `calendar:radarr:{start}:{end}`
gains a permanent entry for every month *and now every week* browsed, since the
calendar gained week stepping. `requests:{filter}:{take}` and `popular:{h}:{limit}`
are the same shape.

- LRU cap on entry count, with the stale-fallback behaviour preserved for the
  fixed-key blocks that rely on it (`diskspace`, `health`, `vpn`, `watched`).
- Log what was evicted, matching the poster-cache prune.
- Consider bucketing calendar keys by month so week stepping reuses them.

**Verification**: browse a year of weeks, confirm the entry count settles and an
offline service still shows stale data with its age. **Size: S.**

## C. Wire up the linters — done

Shipped: **ruff** for the backend (the rules the 27 `# noqa` comments already
assumed) and **Biome** for the frontend. Biome does *not* support Python — it is a
JS/TS toolchain — so one tool for both isn't available; ruff is its analogue in
that ecosystem.

What they found: **308 unused Python imports** and **43 unused TS imports** left
by the module splits, 4 duplicated docstrings and a `ServiceName` literal
duplicated into every schemas module, **22 buttons with no `type`** (inside a form
those default to submit), and **6 clickable `<div>`s with no keyboard path** —
an accessibility gap phase K missed because it only audited `<button>` elements.
Both linters now run in CI.

## C-original. Wire up the linters

19 files carry `# noqa: BLE001` comments written for ruff, which was never
installed. The frontend has no linter at all — the over-exporting in phase A and
the unused imports found during the splits are both things a linter catches for
free.

- `ruff` for the backend with the rules those `noqa`s already assume.
- `eslint` (or `biome`, one tool for lint+format) for the frontend, including
  `react-hooks` — several `useEffect` dependency arrays were hand-waved during
  the splits.
- Both in CI, alongside the existing pytest/build/vitest jobs.

**Verification**: CI red on a deliberate violation; the existing `noqa` comments
suppress exactly what they claim to. **Size: M.**

## D. Measure coverage — done

Baseline recorded: **backend 63%**, **frontend 5%**. The prediction held — the
helpers are well covered (schemas 100%, push pipeline 98%, events 92%) and the
route bodies are not (26–50%). The least-covered module is `webhooks.py` at
**22%**, which is also the one that writes Connect entries into Radarr and Sonarr.

Frontend pages are at **0%**: the a11y and module-boundary tests are static
analysis, so they read files rather than execute components.

CI now runs both. The backend has a `--cov-fail-under=60` floor — verified to
fail at 95 and pass at 60 — so coverage can't slide while the route bodies get
tests. The frontend number is reported but not gated; gating 5% would be theatre.

Where to aim first, by risk rather than by percentage:
`webhooks.py` (22%, writes to the arrs), `arrqueue.py` (31%, deletes queue
items), `discover.py` (26%, adds media), `library.py` (35%, bulk-deletes).

## D-original. Measure coverage

216 tests and no idea what they cover. The bugs that reached production this
month — `_speed_samples`, the unpackerr counter, the hidden queue items — were all
in untested paths.

- `pytest-cov` and `vitest --coverage`, reported in CI, no gate at first.
- Look specifically at the endpoint bodies: the helpers are well tested, the
  route functions themselves mostly are not.

**Verification**: a coverage report in CI output; the arrqueue/importing routers
should show the gap most clearly. **Size: S.**

## E. Retry upstream calls — done

Shipped: `BaseClient._request` splits into a policy wrapper and `_attempt`. GETs
get exactly one more attempt after a 250ms backoff; POST/PUT/DELETE get none.

Only failures that prove the request never landed are retried — `ConnectError`,
`ConnectTimeout`, `ReadError`, `RemoteProtocolError` and 5xx. `ReadTimeout` is
deliberately excluded: the server did receive the request, so a second one only
doubles the wait (`releases()` allows 90s) and doubles the load on an indexer
that is already struggling. 4xx is an answer, not a failure, so it passes
straight through.

Retries are counted per service in a 15-minute rolling window and surfaced as
`retries` on `/status`. The settings status strip now has three states rather
than two: green, amber "flaky" (reachable but retrying), red offline.

**Verified**: 10 tests in `test_client_retry.py` assert exactly two attempts on a
flaky GET, exactly one on POST/PUT/DELETE, no retry on `ReadTimeout` or 404, a
retry on 503, per-service counting, and that counts fall out of the window.

## E-original. Retry upstream calls

No client retries anything. A single dropped connection turns into an offline
card, and the arrs drop connections routinely — which is exactly how the
unpackerr "1 error" that started a whole investigation came about.

- One retry with a short backoff on idempotent GETs, in `BaseClient._request`.
- Never retry POST/PUT/DELETE: a re-sent grab or delete is worse than an error.
- Count retries so the health card can say "flaky" rather than flapping.

**Verification**: block a service mid-request and confirm one retry, and that a
grab is *not* retried. **Size: S.**

## F. Collapse the library lists — done

Shipped: one `LibraryList` in `library/list.tsx` holding the tag chips, select
mode, virtual list, bulk bar and sort sheet. `movies.tsx` went 236 -> 30 lines
and `series.tsx` 235 -> 30, both now pure configuration.

Only the genuinely different parts stay parameterised: `renderBadge` (movies
derive a download status Radarr doesn't return; series show monitored state),
`renderStats` (size vs episode counts plus size), `showSearch` (movies hide it
once the file is on disk), `prepare` (the derived movie status has to exist on
the row before sorting) and `posterOpens`.

That last one is an existing inconsistency, not a feature: only the series
poster opens its detail page. It is preserved behind a flag rather than
unified, since this phase was meant to change nothing — worth deciding on
separately.

**Verified**: 17 component tests in `list.test.tsx` covering both lists — tag
filtering including the All chip, select mode swapping row actions for the bulk
bar, per-kind sort keys, the badge and stats differences, navigation targets,
the search-button rule and the error path. Suite is 89 tests, and
`module-boundaries` caught an exported type with no consumer along the way.

Note: the browser check could not run this round — the automation browser lost
LAN access mid-phase, though the app served 200 throughout. The component tests
carry the verification instead, which for a behaviour-preserving refactor is
the stronger check anyway.

## F-original. Collapse the library lists

`movies.tsx` and `series.tsx` are 76% identical: same select mode, same tag
chips, same bulk bar, same sort, differing only in fields and hooks.

- One `LibraryList` taking a column/field descriptor, with the two pages as thin
  configuration.
- The bug risk today is real: a fix applied to one and not the other looks
  correct in review.

**Verification**: both lists behave identically to now, including tag filtering,
select mode and bulk actions. **Size: M.**

## G. Light theme — done

Shipped: a light palette on the same CSS variables, plus an Appearance setting
(System / Dark / Light) in Manage -> Services.

Switched by `[data-theme]` on `<html>` rather than by media query, because the
roadmap also asked for a pin — an override cannot beat a media query without
duplicating the whole palette. A boot script in `index.html` resolves the
preference before first paint, so there is no flash, and `theme.ts` keeps
"system" live when the OS flips appearance while the app is open. `theme-color`
moves with it, so the iOS status bar and Android address bar follow.

Colours were derived against WCAG AA, not chosen by eye: the state badges are
read as *text* on `--secondary`, where the dark theme's blue lands at 3.96:1.
So primary, success and warning are meaningfully darker in light mode
(#2560db / #17753f / #845400) rather than the same hues lightened. Every text
token clears 4.5:1 and every status dot clears 3:1.

Two things the palette alone would not have fixed:
- The shadcn primitives carry `dark:` tweaks, and Tailwind v4 keys that variant
  off `prefers-color-scheme`. Pinning a theme against the OS would have given
  light colours with dark-mode input styling. `@custom-variant dark` retargets
  it at the same attribute; the built CSS has 42 attribute selectors and zero
  `prefers-color-scheme` rules.
- `border-white/10` is invisible on a light card and `shadow-black/50` reads as
  grime, so the floating bars (dock, both bulk bars, pull-to-refresh) now use
  `border-border` and a `--shadow-color` token.

**Verified**: 28 tests — 16 parsing the real stylesheet and asserting contrast
per token pair, 12 driving the switching logic (pin against OS in both
directions, junk stored value, missing `matchMedia`, live OS flip, listener
teardown, `theme-color`, and that the boot script agrees with the module on the
storage key). Compiled CSS inspected directly for the palette block and the
retargeted variant.

**Not verified**: reading every page with system appearance toggled. The
automation browser lost LAN access before this phase started and never
recovered — it can reach the internet but not the app, while curl gets 200
throughout. This one deserves a human eye, particularly the poster grids and
the Stats charts, which the token audit cannot speak for.

Left alone: the PWA manifest's `theme_color` stays dark. A manifest cannot
respond to appearance, and arrdeck's installed identity is the dark one.

## G-original. Light theme

`index.css` defines one dark palette and nothing responds to
`prefers-color-scheme`. On a phone that follows system appearance, arrdeck is the
odd app out in daylight.

- A light palette against the same CSS variables, switched by media query, with
  an explicit override in Manage for people who want to pin it.
- The colour-coded state badges and the watched dot need checking for contrast in
  light mode — phase K gave them text alternatives but the colours were only ever
  tuned against a dark background.

**Verification**: toggle system appearance and read every page; contrast checked
on the badges and dots. **Size: M.**

## H. Calm the polling — done

Shipped: the four 5s pollers (torrent list, torrent summary, arr queue, Plex
sessions) now pick their cadence from their own payload — FAST while something
is moving, IDLE (20s) otherwise. Each has a small predicate in `hooks/shared.ts`
with its own tests.

"Moving" deliberately means *downloading or checking*, not "active". This stack
holds ~384 torrents seeding permanently, so an activity check that counted
seeding would never back off and the phase would buy nothing. A steady upload
rate is a number that wiggles; 20s reads fine for it, and any user action still
refetches immediately through the existing `invalidateQueries`. `stalled` counts
as not moving, which is the point — a stuck download has nothing to animate.

Also found: global search reuses the torrent-list endpoint for a one-shot lookup
and was re-running the search every 5 seconds while the user read the results.
It now passes `poll: false`.

The merged "activity" endpoint was not built. It would cut three requests to one,
but the three have genuinely different natural cadences now, and merging them
would force the slowest to the fastest — the opposite of this phase.

**Verified**: same tab, same Dashboard, `window.fetch` counted before and after.
Requests fell from **61 in 107s to 25 in 105s** — a 59% drop — with `sessions`,
`queue` and `torrents/summary` each going from 17 samples to 5. (The tab was
hidden, so timers were throttled below the nominal 12/min in *both* runs; the
ratio is what matters.)

The FAST side is not live-verified: forcing it means starting a real download on
the user's stack. It rests on the predicate tests instead. Worth knowing: a
download started outside arrdeck is noticed on the next idle poll, so the switch
back to 5s can lag by up to 20s.

## H-original. Calm the polling

Queue, torrent summary and Plex sessions each refetch every 5 seconds. That was
tuned for progress bars on a desktop; on a phone it is three requests a second
apiece across a session. Background refetch is already disabled, so this is
foreground cost only — but the foreground is where the battery is.

- Back off when nothing is moving: no active transfer means the 5s cadence buys
  nothing.
- Consider one merged "activity" endpoint instead of three parallel polls, which
  would also cut the request count threefold.

**Verification**: with an idle stack, requests per minute drop measurably; with an
active download, progress still updates smoothly. **Size: M.**

## I. Surface the arrs' scheduled tasks — done

Shipped: `GET /tasks` and `GET /arr-backups`, aggregating Radarr, Sonarr and
Prowlarr. Tasks are sorted overdue-first then soonest-due, since the reason to
open the card is always something being late. One arr being down omits its rows
rather than blanking the other two.

Overdue is not "next run is in the past": the arrs queue tasks behind each
other, so grace scales with the interval (half of it, clamped to 2-30 min).
Without that, RefreshMonitoredDownloads — every minute — would be permanently
flagged, and a weekly Backup would get 3.5 days of slack. An interval of 0 means
the user disabled the task, which is a choice rather than a failure.

These landed in a new **System** tab, which also un-orphans `Logs`: it was a
complete component with a working endpoint and no subnav entry, so nothing in the
app could reach it. Backups link straight to the arr's own download URL, which is
served unauthenticated off its root.

**Verified**: all 30 tasks diffed field-by-field against the three arrs' own
`/system/task` — the only two differences were on the 1-minute task and were
exactly one 60s cache generation apart. Driven in a browser: Key shows 13 rows,
All shows 30, backups list 12, Logs renders. The overdue *state* could not be
observed live, because the only way to make an arr's scheduler fall behind
(pausing the container) also makes its API unreachable, and its scheduler
recomputes within a second of resuming — so it is covered by 11 unit tests
pinning the grace boundaries instead.

## I-original. Surface the arrs' scheduled tasks

`/api/v3/system/task` is unused and answers with real data — RSS Sync, Check
Health, Housekeeping, Backup, each with a last and next run. "Why hasn't anything
been grabbed?" is usually answered by "RSS sync last ran 6 hours ago", and
arrdeck currently cannot say that.

- A card showing the tasks that matter (RSS sync, refresh, health) with last/next
  times, and a warning when a task is overdue.
- Also `/api/v3/system/backup`: the arrs keep their own backups (4 exist right
  now) and arrdeck could list and link them, next to its own backup feature.

**Verification**: compare against each arr's System → Tasks page; force an
overdue task and confirm the warning. **Size: S.**

## J. Cast and crew on the Movie page

`/api/v3/credit` holds 6,331 rows for the current library and is untouched. The
Movie page shows overview, file and history but nothing about who is in it — the
first thing most people want when deciding whether to keep something.

- Top billed cast with photos through the existing poster proxy, and the director.
- Tapping a person could search the library for them, which is a genuinely useful
  way to browse a collection.

**Verification**: a movie with a known cast renders it; a movie Radarr has no
credits for degrades to nothing rather than an empty card. **Size: M.**

## K. Quality profiles and custom formats

`qualityprofile/schema`, `customformat` and `delayprofile` are all reachable and
unused. Today changing what quality you want means opening Radarr, then Sonarr.

- Read-only first: show each profile's cutoff and allowed qualities, and any
  custom formats with their scores.
- Editing is a bigger job and arguably belongs in the arr UI; decide after seeing
  the read-only view in use.

**Verification**: profiles match the arr UI exactly, including score ordering.
**Size: M.**

---

## Order & sizing

| Phase | Size | Why here |
|-------|------|----------|
| A tighten module boundaries | S | cleans up after the last round before building on it |
| C wire up the linters | M | would have caught A, and everything after benefits |
| D measure coverage | S | tells the next phases where the risk is |
| B bound the cache | S | the only unbounded growth left in the process |
| E retry upstream calls | S | removes a whole class of spurious offline cards |
| I scheduled tasks | S | small, and answers a question the app currently can't |
| H calm the polling | M | battery, and a threefold request cut |
| F collapse the library lists | M | do before either list gains a feature |
| G light theme | M | overdue on a phone that follows system appearance |
| J cast and crew | M | the first genuinely new *feature* in this round |
| K quality profiles | M | least certain value; decide after the read-only view |

Suggested sequence: **A → C → D → B → E → I → H → F → G → J → K**.
Tooling and cleanup first, so the later phases land on a codebase that checks
itself, then the two user-facing features last.

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

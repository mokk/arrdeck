# arrdeck for iOS

A native client that must work against **any** arrdeck backend — only the HTTP
API, no assumption that the docker stack is anywhere nearby.

Written 2026-08-21, revised 2026-08-24 after review. Counts below rot as the
backend moves; treat them as order-of-magnitude, dated the day they were taken.

## What is already true (2026-08-24)

- **The backend is the whole app.** 125 routes doing all arr aggregation,
  caching, retries, the diagnosis synthesis, poster proxying and push fan-out. A
  native client is a new *view*, not a rewrite.
- **The frontend to replace is ~11,000 lines**: 12 pages, 39 real components (10
  more are shadcn primitives), 110 TanStack Query hooks, 437 locale strings in
  two languages.
- `frontend/src/api/client.ts` line 1 already reads *"Single network boundary. A
  future iOS/React Native port only swaps BASE_URL."* The groundwork is there.
- Auth is **WebAuthn passkeys**, now **scoped per hostname**: each credential
  records the `rp_id` it was created on and the login challenge only offers ones
  usable there. Plus an 8-character setup code and a **sliding** 180-day session
  — refreshed on every use, so a client used even occasionally never
  re-authenticates.
- `is_lan()` decides by **hostname, not source IP** — Docker NATs every inbound
  connection, so the source is useless. LAN callers skip auth entirely.
- **Poster URLs are relative** (`/api/v1/poster?u=…`). The PWA resolves them
  against its own origin for free; a native UI must prepend the profile's base
  URL, and the generated Swift client will not do this for you.

## Three consequences of "any backend"

**Native passkeys are impossible.** `ASAuthorizationPlatformPublicKeyCredential`
needs an associated domain, and associated domains are a **compile-time
entitlement** — you declare hostnames when you build. An app that talks to
`whatever.example.com` cannot declare it in advance. Authenticate in a web view
against the user's own origin instead, where WebAuthn works with no backend
change.

**Push conflicts with self-hosting.** An APNs auth key belongs to an Apple
*developer account*, not to a server, so only the key's holder can push to the
app. Compatible only if:
- whoever runs the backend also owns the app build — their team, bundle id, key.
  Clean, and the case for a personal deployment.
- a **relay** you operate holds the key and backends POST to it. This is exactly
  why Home Assistant has Nabu Casa. Costs hosting and makes you a privacy
  chokepoint.
- or no native push, keeping it in the PWA.

Shipping a shared `.p8` inside the backend image would work but puts a signing
key in a public artefact. Don't.

**Capability discovery is mandatory, not nice-to-have.** An unknown `/api/v1/*`
path falls through to the SPA and returns **200 HTML** rather than a 404, so
probing by calling an endpoint cannot distinguish "missing" from "present".
`/about` (phase B) is the answer — but note the discovery *protocol* below,
because `/about` sits behind auth and old backends predate it.

---

## A. Server profiles — Size M

The app knows about no deployment.

- Onboarding: enter a base URL, probe `/about`, store the profile in the
  Keychain. Several profiles, switchable, as Jellyfin and Plex clients do.
- **The probe has three honest outcomes**, and onboarding must handle all of
  them: **200 JSON with `name: "arrdeck"`** (a LAN arrdeck — no pairing needed);
  **401** (an arrdeck that wants pairing — *not* a failure); **anything else,
  including 200 HTML** (not an arrdeck endpoint). A 401 does not prove `/about`
  exists — every `/api/v1/*` path 401s from remote on any arrdeck version — so
  the feature list is re-read *after* pairing, and a post-pairing 200-HTML
  response means an old backend: fall back to the minimal feature set rather
  than erroring.
- **Two separate iOS traps, same silent-timeout symptom:**
  - `NSLocalNetworkUsageDescription` — the local-network privacy prompt.
  - **App Transport Security** — ATS blocks plain-HTTP URLs by default, and a
    LAN profile like `http://10.0.0.154:3500` *is* plain HTTP. Without
    `NSAllowsLocalNetworking` the connection is refused before the privacy
    prompt is even relevant.
- **Self-signed and internal-CA certs.** Many self-hosters run LAN-only HTTPS.
  Decide deliberately: refuse, or offer per-profile "trust this certificate"
  with a pinned fingerprint. No blanket ATS exception for remote hosts.
- **A profile's origin is part of its identity.** Sessions are cookies and
  passkeys are rp_id-scoped, so editing a profile's URL from IP to domain
  silently invalidates both. Treat a URL change as "new profile, re-pair", or
  users hit exactly the silent failure the passkey-host fix made legible on the
  web.

## B. Capability discovery — done

`GET /api/v1/about` returns name, version and a feature list. Features are
derived from the **OpenAPI schema of the mounted router**, not a hand-maintained
list, so it cannot claim something that is not wired up; a test asserts every
declared feature maps to a real route.

`app.routes` could not be used: sub-routers are not flattened into it and their
children are reachable only through private attributes. The schema is the
framework's own public view.

Version is single-sourced in `backend/app/version.py` (**0.2.0**). `npm run
check:version` fails on drift and runs in CI — not in `npm run build`, because
the image build stage copies only `frontend/`.

**Kept behind auth deliberately.** Exempting it would hand an unauthenticated
caller a version and a capability list, and this backend is reachable from the
internet. The discovery protocol in phase A is the consequence.

## B2. Localised push text — done

Notification text was assembled **server-side in English** and shown verbatim,
so a device set to Danish got English banners; a native client could not
localise a pre-rendered banner at all.

The payload now names what happened — `code`, `count`, `app`, and `heading` for
pass-through media text that must never be translated — and the client writes
the sentence. That is the shape APNs wants (`loc-key`/`loc-args` resolved from
the app bundle), so phase D inherits the payload rather than designing it twice.

`title`/`body` are still sent as an English rendering, so an old service worker
shows text instead of a blank banner, and a newer server event stays readable in
a client with no string for it yet.

The device language is recorded per subscription and sent down in the webpush
payload (a service worker cannot read the app's stored preference). **APNs
devices do not need it** — iOS localises from the bundle on-device — so phase D
should not require it for `apns` rows.

**A bug this uncovered:** `push_add` used `INSERT OR REPLACE` naming only two
columns, so every other column reverted to NULL on re-subscribe. Now an upsert
preserving what the caller did not send.

## C. Pairing and auth — Size M

Use what the backend has: an 8-character setup code (alphabet excludes O/0/I/1)
and the sliding 180-day session.

- **Web view for the auth step only.** WebAuthn works in `WKWebView` against
  whatever origin the profile uses, so passkeys work with **zero backend
  changes**. Capture the `arrdeck_session` cookie via `WKHTTPCookieStore` into
  the app's `URLSession` store. Any passkey registered this way is bound to the
  profile's hostname — correct, and now visible in Manage.
- **Or a token exchange** — trade a setup code for a long-lived bearer token, so
  a pure-native client never needs a web view. Cleaner for SwiftUI, small
  backend addition, and the same endpoint solves passkey-less desktop browsers.

Start with the first; it needs nothing new server-side. The sliding session
means re-auth is effectively never, so the web view is a one-time ritual per
profile.

## Decision (2026-09-22): native UI, no PWA tab

Asked directly, the user chose the native rewrite over the web-view shell. The
only web content in the app is the sign-in sheet, which is unavoidable (see C).
Consequences: F and G move ahead of D; E1/E2 shrink to the push-registration
plumbing D needs, folded into D; the "use it for a week, then decide" gate is
gone — the decision is made.

New sequence: **A → C → F → G (Dashboard first) → D → H → I.**

The sections below predate the decision and are kept for the reasoning.

## E1. Native shell, skeleton — Size S (superseded)

Pulled ahead of APNs because **APNs cannot be verified without a real device
token from a real app** — as originally ordered, D would have been written blind.

- SwiftUI app, profile list from A, `WKWebView` at the profile's URL, shared
  cookie store, pairing via C.
- APNs registration wired to `/push/subscribe` with `kind: "apns"` — the token
  goes nowhere useful until D exists, but the plumbing is testable.

## D. APNs, operator-supplied — Size M

`push/delivery.py` is VAPID-only.

- APNs settings the **operator** fills in — team id, key id, bundle id, `.p8` —
  beside the existing service settings. Whoever built the app supplies their own.
- `push_subscriptions` gains a `kind` discriminator: `webpush` | `apns`. **The
  new column must join `push_add`'s upsert `ON CONFLICT` clause** — the exact
  column-reset bug B2 fixed will recur if it is left out. That lesson is already
  paid for once.
- The 6 event types and all of `push/pipeline.py`'s collapse and dedupe logic
  stay untouched; only delivery forks. APNs rows skip the `lang` field.
- If APNs is unconfigured, say so plainly rather than failing silently.
- Identical deep-link payloads across transports.

## E2. Native shell, finish — Size M (superseded)

- Deep links from notifications route into the web view.
- Share extension: accept a URL, hit the existing search-and-add endpoints.
- Native pull-to-refresh and swipe-back rather than the CSS/JS versions.

**Use it for a week, then decide — with criteria, not vibes:**
- Jank in scrolling, sheets or transitions → continue to F–H.
- Only missing widgets and Live Activities → **skip straight to I**, which
  attaches native extensions to the shell and does not need the UI rewrite.
- Neither → done; D and E were the whole project.

---

## If a real native UI is still wanted

## F. Generated Swift client — done (2026-09-22)

`swift-openapi-generator` against the **committed** spec (see repo layout), as
the TS client already is. Typed, drift becomes a compile error. Remember: poster
paths come back relative and need the profile's base URL prepended.

Two things the spec had to give up for it, both fixed at the boundary rather
than worked around in Swift:

- **No nullable unions inside `additionalProperties`** — `DiagnosisFindingOut.params`
  became `dict[str, Any]` (backend change; the generator emitted Swift that did
  not compile).
- **No `{type: null}` at all.** pydantic v2 writes every `X | None` as
  `anyOf: [X, null]`, and the generator *silently skips the whole property*
  with only a build warning — the first client had no `ServiceBlock.data`, no
  poster URLs and no queue `tracked_state` (213 fields), and compiled fine.
  The iOS repo now derives its copy of the spec (`Scripts/derive-spec.jq`:
  `anyOf: [X, null]` → `X`, property made optional — `decodeIfPresent` treats
  null and absent alike) and its CI fails on drift from the submodule. Keep
  nullable fields out of `required` on the backend, or that rewrite stops being
  lossless.

## G. Port the screens — Size L

The bulk. Order by value: **Dashboard** first — 8 cards, all `ServiceBlock`
shaped, so this is where the loading / healthy / offline / stale-with-age
abstraction gets established; get it right and the rest is mechanical. Then
**Downloads** (389 + 1,406 torrents want native scrolling), then the shared
**Movie/Series detail**, then Wanted + diagnosis, Calendar, Manage, Add, Popular,
History, Stats.

Carry over deliberately: the **adaptive poll cadence** (5s moving, 20s idle) and
the **stale-data-with-age** display. Both were considered decisions and both are
easy to lose in a rewrite.

**Dashboard done (2026-09-22).** What it established, for the screens after it:

- `ArrdeckData` is the layer between the generated client and SwiftUI: domain
  typealiases, `Block<T>` (healthy / stale-with-age / offline, built from any
  generated `ServiceBlock_*` via a shape protocol — so a generated type losing
  `data` again fails to compile), `Loadable<T>` (loading / loaded / failed) for
  the call itself, `Cadence` + `Motion` (the 5s/20s rule), `Format`, and an
  `@Observable` model per screen over a protocol (`DashboardAPI`) so tests feed
  canned answers without a network.
- A failed poll never blanks a card: stale data stays, the card gets a
  "could not refresh" note, and only transport-level failures raise the
  connection banner. A 401 anywhere flips the profile back to the connection
  screen through one `SessionController`.
- Every Danish/English string is still a literal `Text("…")`; H sweeps them.
- With one saved server the app opens straight into it — the list is for choosing.
- Not yet: the "See all →" links (Wanted, Calendar, History, Stats pages) and
  the manual-import sheet; they arrive with their screens.

**Downloads done (2026-09-22, same day).** Server-side query (`TorrentQuery`:
text, state, sort, direction, limit) with the backend's comparator mirrored
client-side so the merged, independently-capped lists re-sort correctly —
nulls last in both directions. Debounced search, swipe pause/resume/delete,
delete-with-or-without-files, throttle ("some" semantics: either client
throttled reads as on), load-more, the arr queue with remove. Detail sheet
carries files and trackers; limits, queue position, category, tags and the
add-torrent sheet are still to come, as is bulk select. Reached from the
dashboard's toolbar until there is a tab bar.

**Movie/Series detail done (2026-09-22).** `MediaRef` (movie/series + id) is
what posters and history rows link to; one `navigationDestination` on the
dashboard resolves it. Shared `DetailModelBase` carries options, Plex watched
state (only asked when Plex is configured), monitor/profile/search/delete;
delete pops the screen. Series expands seasons on demand and caches episodes
per season. Not yet: rename card, interactive-search (releases) sheet — each
is its own screen.

**Wanted + diagnose done (2026-09-23).** Missing/Upgrades per arr, paged with
append, search per row (movie search for Radarr, episode search for Sonarr),
search-all, rows link into the title, and the "Why hasn't this arrived?"
sheet with the finding codes worded in `DiagnosisText` (English until H).
Found on the way: the PWA passed the *episode* id to `/diagnose/sonarr/…`,
which keys on series id and 404s — fixed in the PWA the same day. Not yet:
the interactive-search entry per row.

**Tab bar + Calendar (2026-09-23).** The server now takes over the window
with a TabView (Home, Downloads; Popular, Add, Manage arrive with their
screens), each tab its own NavigationStack; the server list is a root switch
rather than a stack above it, because a TabView does not belong inside a
pushed screen. Calendar: month grid / week strip / fortnight agenda over one
`CalendarRange` (Monday-first weeks, the agenda always from today), grouped
by local day, reached from the Upcoming card's "See all".

**Manage done (2026-09-23).** A settings-style hub (the PWA's sub-tabs read
worse on a phone) into: the two libraries as one `LibraryRow` shape with
local filter/tag/sort and Plex watched dots; Indexers with enable toggle and
test-as-verdict; System (reachability with flaky/update states, scheduled
tasks key/all with overdue first, read-only quality profiles, service
backups, logs per arr and level); Connections (per-service URL/key/user/pass
forms — save, then test the *saved* connection). Not yet: add-indexer sheet,
bulk select in the libraries, theme/language (device settings do that on
iOS), security/notifications/import-lists/backup-transfer cards — the last
four move to D and I.

**Add + Popular done (2026-09-23).** Add: debounced live search into
Radarr/Sonarr (two characters minimum), Overseerr's popular grid while the
box is empty (fetched once per screen life), Radarr collections with a
per-collection sheet, raw Prowlarr releases on submit only, and one media
sheet for both cases — add (profile + root folder, first of each as default)
or edit (monitor, profile, search, delete). Popular: the 24h indexer
snapshot ranked by grabs, filtered by kind, grab per row, with the "building
the first list" note while the backend fans out. The tab bar is now the
PWA's: Home, Popular, Downloads, Add, Manage.

**History + Stats done — phase G complete (2026-09-23).** History: the merged
pages with append, local app/event filters, rows into the title, and the
blocklist segment with unblock and clear-per-arr. Stats: the eight metrics
over 30/90/365 days as sparklines with first→last delta and min/max, from the
Trends card's "See all". Every PWA page now has a native counterpart; what
each still lacks is listed under its own entry above (add-indexer, bulk
select, rename card, interactive-search sheet, torrent limits/tags/category,
add-torrent).

## H. Localisation — done (2026-09-23)

Not the 437 PWA keys one by one: the compiler's own `-emit-localized-strings`
pass (what Xcode runs) lists every localisable key with the exact
`%lld`/`%@` form SwiftUI looks up, and `Scripts/localize.py` turns that plus
`Localization/da.json` into `App/Sources/Localizable.xcstrings`. The catalog
lives in the app, not the package, because a package's `Text("…")` resolves
against `Bundle.main` — so no `bundle:` argument on 200 call sites. The
data layer's labels go through `String(localized:)`; badge states are looked
up dynamically with the raw state as the key. `test.sh`/CI fail when a new
string has no Danish entry or the catalog is stale. 245 strings; the PWA's
Danish reused where the wording matched.

**Trap found on the way (2026-09-23):** xcodegen writes a project with no
`Package.resolved`, so Xcode resolved every dependency afresh on each
regeneration and picked up swift-collections 1.7.0 the evening it shipped —
whose ContainersPreview needs a Swift runtime symbol (`swift_initBorrow`)
the iOS 26.3 simulator lacks. The app died in dyld before `main`. Fixes:
`App/generate.sh` copies the package's pins into the generated project, and
Package.swift caps swift-collections below 1.7 until the simulator runtime
catches up. Never run bare `xcodegen`.

## H (original notes) — Size S

437 keys, en + da, to `.xcstrings`. Scriptable from the existing JSON;
`check-locales.mjs` has an obvious analogue.

## I. The native-only payoff — Size M

- **Live Activity for an active download** — the best fit this app has.
- Home-screen widgets: disk free, queue depth, next episode.
- App Intents / Shortcuts: "add Dune to Radarr".
- `BGTaskScheduler` pre-warming so the dashboard is populated on open.

Requires only the shell, not the F–H rewrite.

---

## Distribution

- **App Store review will fight a self-hosted client** — the usual rejection is
  "we could not evaluate your app". Needs a demo instance or a demo mode.
- **TestFlight**: *internal* testing (your own devices, your account) is
  review-free; **external testers trigger a review**, with the same self-hosted
  problem as the App Store.
- **Direct install** works, but a free personal team expires the build after
  **7 days**; a paid account gives a year.

Plan for internal TestFlight. Publishing for others breaks phase D — every
operator needs their own build and Apple account, or you run the relay.

## Sequence

| Phase | Size | Note |
|---|---|---|
| A server profiles | M | ATS + local-network: two traps, one symptom |
| B capability discovery | — | **done** |
| B2 localised push text | — | **done** — prerequisite for D |
| C pairing and auth | M | Web view path needs no backend change |
| F generated Swift client | — | **done** — see the two spec constraints above |
| G port the screens | — | **done** — per-screen leftovers listed above |
| D APNs, operator-supplied | M | Includes the push-registration plumbing E1 would have had |
| H localisation | S | Mechanical |
| I widgets, Live Activity, Intents | M | The genuine payoff |

**A → C → F → G → D → H → I** — E1/E2 superseded by the native-first decision
above. A, C, F and G are done (2026-09-23); D (APNs) is next, then H
(localisation) and I (widgets, Live Activity, Intents).

Repo layout decided: **two repos, no shared repo.** `arrdeck` keeps the backend
and the PWA; `arrdeck-ios` pins `arrdeck` as a submodule and reads the tokens,
locale files and OpenAPI spec straight from it.

**The spec is committed** at `openapi.json` in the arrdeck repo root, exported
from the app itself, with a test that fails when it drifts from the mounted
routes. The PWA's `gen:api` reads the committed file — previously it read a
*live URL*, so a backend change could not be typed until it was deployed, which
bit twice while building the diagnosis endpoint.

The PWA stays regardless: it is the desktop and Android client, and A–D improve
it too.

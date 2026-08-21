# arrdeck for iOS

A native client that must work against **any** arrdeck backend — only the HTTP
API, no assumption that the docker stack is anywhere nearby.

Written 2026-08-21. Facts below were measured against a live instance, not
assumed.

## What is already true

- **The backend is the whole app.** 124 routes doing all arr aggregation,
  caching, retries, the diagnosis synthesis, poster proxying and push fan-out. A
  native client is a new *view*, not a rewrite.
- **The frontend to replace is ~11,000 lines**: 12 pages, 39 real components (10
  more are shadcn primitives), 110 TanStack Query hooks, 436 locale strings in
  two languages.
- `frontend/src/api/client.ts` line 1 already reads *"Single network boundary. A
  future iOS/React Native port only swaps BASE_URL."* The groundwork is there.
- Auth is **WebAuthn passkeys** with `rp_id` taken from the `Host` header, plus
  an 8-character setup code and a 180-day session cookie.
- `is_lan()` decides by **hostname, not source IP** — Docker NATs every inbound
  connection, so the source is useless. LAN callers skip auth entirely.

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

**Capability discovery is mandatory, not nice-to-have.** Before phase B there
was no way to ask a backend what it supports, and an unknown `/api/v1/*` path
falls through to the SPA and returns **200 HTML** rather than a 404 — so probing
by calling an endpoint cannot even distinguish "missing" from "present".

---

## A. Server profiles — Size M

The app knows about no deployment.

- Onboarding: enter a base URL, validate it against `/about`, store in the
  Keychain. Several profiles, switchable, as Jellyfin and Plex clients do.
- **`NSLocalNetworkUsageDescription` is mandatory.** iOS blocks a native app from
  reaching `10.0.0.x` without explicit consent, and the failure mode is a silent
  timeout.
- **Self-signed and internal-CA certs.** Many self-hosters run LAN-only HTTPS.
  Decide deliberately: refuse, or offer per-profile "trust this certificate" with
  a pinned fingerprint. No blanket ATS exception.
- Handle both auth states the backend can present — LAN bypasses auth, remote
  needs a session — without being told which.

## B. Capability discovery — done

`GET /api/v1/about` returns name, version and a feature list. Features are
derived from the **OpenAPI schema of the mounted router**, not a hand-maintained
list, so it cannot claim something that is not wired up; a test asserts every
declared feature maps to a real route.

`app.routes` could not be used: sub-routers are not flattened into it and their
children are reachable only through private attributes. The schema is the
framework's own public view.

Version is now single-sourced in `backend/app/version.py` (**0.2.0**). `main.py`
and `package.json` each carried an independent `0.1.0` that had never been
bumped. `npm run check:version` fails on drift and runs in CI — not in `npm run
build`, because the image build stage copies only `frontend/`.

**Kept behind auth deliberately.** Exempting it would hand an unauthenticated
caller a version and a capability list, and this backend is reachable from the
internet. The 401 is itself the signal: reach `/about`, get 401, pair, ask again
— which also separates "an arrdeck that wants pairing" from "not an arrdeck".

## C. Pairing and auth — Size M

Use what the backend has: an 8-character setup code (alphabet excludes O/0/I/1)
and a 180-day session.

- **Web view for the auth step only.** WebAuthn works in `WKWebView` against
  whatever origin the user typed, so passkeys work with **zero backend changes**.
  Capture the `arrdeck_session` cookie into a shared store.
- **Or a token exchange** — trade a setup code for a long-lived bearer token, so
  a pure-native client never needs a web view. Cleaner for SwiftUI, small
  backend addition.

Start with the first; it needs nothing new server-side.

## D. APNs, operator-supplied — Size M

`push/delivery.py` is VAPID-only.

- APNs settings the **operator** fills in — team id, key id, bundle id, `.p8` —
  beside the existing service settings. Whoever built the app supplies their own.
- `push_subscriptions` gains a kind discriminator: `webpush` | `apns`. The 6
  event types and all of `push/pipeline.py`'s collapse and dedupe logic stay
  untouched; only delivery forks.
- If APNs is unconfigured, say so plainly rather than failing silently.
- Identical deep-link payloads across transports.

## E. Native shell — Size M

Thin SwiftUI app wrapping `WKWebView` at the profile's URL.

- Shared cookie store so the session survives restarts; passkeys work in place.
- APNs registration to `/push/subscribe`; deep links route into the web view.
- Share extension: accept a URL, hit the existing search-and-add endpoints.
- Native pull-to-refresh and swipe-back rather than the CSS/JS versions.

**Use it for a week before going further.** If the WebView feel is fine, D and E
were the whole project.

---

## If a real native UI is still wanted

## F. Generated Swift client — Size S

`swift-openapi-generator` against the published spec, as the TS client already
is. 124 routes, typed, drift becomes a compile error.

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

## H. Localisation — Size S

436 keys, en + da, to `.xcstrings`. Scriptable from the existing JSON;
`check-locales.mjs` has an obvious analogue.

## I. The native-only payoff — Size M

- **Live Activity for an active download** — the best fit this app has.
- Home-screen widgets: disk free, queue depth, next episode.
- App Intents / Shortcuts: "add Dune to Radarr".
- `BGTaskScheduler` pre-warming so the dashboard is populated on open.

---

## Distribution

- **App Store review will fight a self-hosted client** — the usual rejection is
  "we could not evaluate your app" because the reviewer cannot reach a server.
  Needs a demo instance or a demo mode.
- **TestFlight** is the pragmatic path: 90-day builds, own devices, no review
  friction.
- **Direct install** works, but a free personal team expires the build after
  **7 days**; a paid account gives a year.

Plan for TestFlight. Don't attempt the App Store unless publishing for others —
and note that publishing breaks phase D, since every operator would need their
own build and Apple account, or you would have to run the relay.

## Sequence

| Phase | Size | Note |
|---|---|---|
| A server profiles | M | Includes the LAN-permission trap |
| B capability discovery | — | **done** |
| C pairing and auth | M | Web view path needs no backend change |
| D APNs, operator-supplied | M | The reason to go native |
| E native shell | M | Usable app; **decision point** |
| F generated Swift client | S | Only if going full native |
| G port the screens | L | The actual cost |
| H localisation | S | Mechanical |
| I widgets, Live Activity, Intents | M | The genuine payoff |

**A → C → D → E → *evaluate* → F → G → H → I**

The PWA stays regardless: it is the desktop and Android client, and A-D improve
it too.

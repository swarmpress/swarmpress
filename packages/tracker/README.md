# @swarm-press/tracker

The first-party, cookieless analytics beacon behind
[ADR-0032](../../docs/adr/0032-first-party-analytics-tracker-owned-by-the-data-scientist.md).
The swarm.press server serves it at `GET /t/s.js` and collects its events at
`POST /t/e`.

## Snippet

Each project gets a public tracker key (`GET /api/projects` returns it,
along with a ready-made `snippet`). Add one tag to the site layout:

```html
<script defer src="https://play.swarmpress.example/t/s.js" data-project="pk_0123456789abcdef01234567"></script>
```

| Attribute | Notes |
|---|---|
| `data-project` | Required. The project's public tracker key. Without it the script does nothing. |
| `data-endpoint` | Optional. The collector URL. Defaults to `<script origin>/t/e`. |

The page's origin must be the project's registered domain (or a subdomain of
it), or the collector answers 403.

## What it sends

Each event is a single `navigator.sendBeacon` with a `text/plain` JSON body.
When `sendBeacon` is missing or refuses the event, it falls back to
`fetch(..., {keepalive: true, credentials: 'omit'})`.

| Event | When | Extra fields |
|---|---|---|
| `pageview` | On load, and on SPA navigations (`pushState`/`replaceState`/`popstate` that change the path) | First pageview only: referrer host (`r`), `utm_source`/`utm_medium`/`utm_campaign` (`us`/`um`/`uc`) |
| `engagement` | `visibilitychange` to hidden, `pagehide`, and before an SPA navigation | Visible time in ms (`e`) |
| `scroll` | First time 25/50/75/100 % of the page has been seen | Milestone (`s`) |
| `outbound` | Click on a link to another host | Target host (`o`) |

Every event also carries the project key (`k`), the path without query or
fragment (`p`), `<html lang>` (`l`) and a viewport class (`v`: `s` < 640 px,
`m` < 1024 px, `l` otherwise).

## Privacy

- No cookies, no `localStorage`/`sessionStorage`, no ids. The bundle test
  checks that the build references none of them.
- The script stays silent when `navigator.doNotTrack === '1'`,
  `navigator.globalPrivacyControl === true`, or the URL has `?notrack`. The
  server also drops events that carry `DNT: 1` or `Sec-GPC: 1` headers.
- The server never stores IP addresses or user agents. It counts visitors
  with `xxh3(daily salt ‖ ip ‖ ua ‖ project)`. The salt rotates at UTC
  midnight and is then deleted.

## Develop

```bash
pnpm --filter tracker test         # vitest (jsdom) + the 1.5 KB gzip budget
pnpm --filter tracker build        # dist/tracker.min.js (prints raw and gzip size)
pnpm --filter tracker sync         # build + copy into crates/server/assets/tracker.min.js
pnpm --filter tracker check-drift  # build + fail if the server's embedded copy is stale
```

The server embeds `crates/server/assets/tracker.min.js` with `include_str!`,
so the binary has no runtime dependency on Node. That copy is committed.
After changing `src/`, run `sync` and commit both.

**CI drift check:** run `pnpm --filter tracker check-drift` after
`pnpm install`. The Rust unit test `tracker::tests::assets_match_built_tracker`
does the same comparison whenever `packages/tracker/dist` exists, so running
`pnpm --filter tracker build` before `cargo test` also catches a stale copy.

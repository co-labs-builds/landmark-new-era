# Build assets

Standalone pieces of the Landmark build that are **not** part of the CS dashboard or
member portal engines — self-contained pages, tools, scripts and specs that each ship
on their own. Parked on the `build-assets` branch so they have a home without
cluttering the engine branches.

Nothing here is loaded by `dashboard-engine.js` or `portal-engine.js`. Nothing here is
SHA-pinned via jsDelivr, so the `verify-pin` pre-push hook does not apply to these
files — a push that only touches this set is the "genuinely unrelated push" its header
comment describes.

## Ontraport pages

Each page is a **header-code block** (paste into the page's Header/Head code) plus a
**body block** (paste into the page body). No class is ever set on `<body>` — Ontraport
strips pasted body tags — so every page is scoped to one namespaced wrapper div.
The `*-page.html` / `rate-monitor.html` files are the two blocks concatenated into a
standalone file you can open locally to preview the real thing.

| Page | Files | Namespace |
|---|---|---|
| 404 / page not found | `INSTALL-404-header-code.html`, `INSTALL-404-body-block.html`, `404-page.html` | `.lm404` |
| Ontraport API rate monitor | `INSTALL-rate-monitor-header-code.html`, `INSTALL-rate-monitor-body-block.html`, `rate-monitor.html` | `.lmapi` |

### API rate monitor

Live read of the account-wide Ontraport rate limit. Polls
`GET https://landmarkworldwide.awesomate.io/webhook/ontraport-rate-probe`
(n8n workflow `LM | Admin | Ontraport API Rate Probe`, `8m3Qe4fOJcGK82Zo`), which makes
exactly one cheap Ontraport call and returns the `X-Rate-Limit-*` headers as JSON.

Two things to know before changing it:

- **Account 270197 is provisioned at 360 requests/minute**, not the 180 the public
  Ontraport docs state. Read the header; never hard-code either number.
- **Each poll costs 1 request against the same budget**, so the `used` figure includes
  the monitor's own probes. The page states its own draw in a tile.

The probe webhook is **unauthenticated** — see "Open item" below.

## Other assets

| File | What it is |
|---|---|
| `Landmark CSS.html` | Shared brand CSS extract |
| `INVITATIONS-TRACKER.gs` | Apps Script for the Invitations tracker sheet. Ontraport API credentials are entered through a menu prompt and live in Script Properties — never in the file, never in the sheet. |
| `DASHBOARD-REDESIGN-SPEC.md` | CS dashboard redesign spec + n8n change log |
| `FORUM-218-RECONCILIATION-TASKS.md` | Forum 218 reconciliation: 22 numbered discrepancies against the CS's preliminary statistics report |

## Open item

**This repository is public, and `/webhook/ontraport-rate-probe` takes no auth.** Anyone
who reads this file can hit it, and every hit spends one request from the same 360/minute
budget the dashboard, portal and Zoom pollers draw on. It is not a data-disclosure risk —
the response is three integers — but it is a trivial way to starve the API. Options, none
applied yet: put a shared header secret on the n8n webhook, cache the reading server-side
so bursts collapse to one upstream call, or keep the monitor out of the public repo.

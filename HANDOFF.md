# Landmark CS Dashboard + Member Portal — Build Handoff

**Read this file first if you're picking up this project on a new machine or in a fresh session.** It's the "start here" index — the deep detail already lives in the other docs in this repo and in the persistent memory of whatever Claude Code session built it; this file ties both together and gets a fresh session oriented fast.

Written 2026-08-13, one day before the live pilot (Aug 14–16, 2026).

## What this is

Two connected Ontraport-backed builds for Landmark Worldwide's Aug 14 Forum pilot:

1. **CS Dashboard** — Course Supervisor-facing tool for managing a live event (roster, attendance, classification overrides, materials/announcements release). Source lives in this folder as three files pasted into Ontraport + one CDN-hosted script:
   - `INSTALL-dashboard-header-code.html` → Ontraport Page's Custom Header Code field
   - `INSTALL-dashboard-body-block.html` → Ontraport Page's Custom HTML Block
   - `dashboard-engine.js` → hosted on jsDelivr, SHA-pinned (see "CDN pinning" below)
   - `master-stats-dashboard-demo-LATEST.html` → **frozen historical snapshot only**, not live, superseded by the three files above

2. **Member Portal** — participant-facing companion, same Ontraport backend, same architecture pattern:
   - `INSTALL-header-code.html` / `INSTALL-body-block.html` → pasted into Ontraport
   - `portal-engine.js` → CDN-hosted (currently pinned to `@main`, not a fixed SHA — see that project's memory for why)
   - `member-portal.html` → source of truth, split into the two INSTALL files above

Both share the same Ontraport account/objects and the same n8n instance (`landmarkworldwide.awesomate.io`) for write-back webhooks and real-time push (Ably).

## Where the deep detail lives

This repo's other `.md` files are the real reference material — read them, don't re-derive:

- **`CS-DASHBOARD-FIELD-DICTIONARY.md`** — the authoritative field-ID reference for the dashboard (registrations/events/oEventTeam field mappings).
- **`ONTRAPORT-ATTENDANCE-AUTOMATION-RULES.md`** — spec for the native Ontraport automation rules needed so manual field edits in Ontraport also push live via Ably.
- **`automations-punchlist.md`** — full n8n workflow inventory for the Zoom attendance pipeline, organized by confidence tier (confirmed-working / claimed-unverified / confirmed-not-built).
- **`ontraport-setup-punchlist.md`** — broader Ontraport account setup notes.
- **`n8n-account-update-webhook-spec.md`** / **`n8n-dashboard-bootstrap-webhook-spec.md`** — webhook contract specs for specific workflows.
- **`ontraport-field-master-list.md`** — full object/field dump reference.
- **`Portal Build Spec - TJC.md`** — the original client-authored spec doc.

If a fresh session doesn't have persistent memory of this build, these docs plus this file should be enough to resume real work without re-discovering everything from scratch.

## Current status (as of commit `84713c4`, 2026-08-13 late evening)

**Done and pushed:**
- CS Dashboard: all 6 roster kebab actions (Update Course Status, Device/Zoom Exception, Override Classification, Correct Attendance, Add Operational Note, View Details), Guests tab (read + chip/note write-back), Master Stats, Reporting Dashboard, Ably live-push both directions, real logout, Home page loading state, a full design-review round (badges, fonts, layout).
- Member Portal: My Account save (text+photo), communication-preference checkboxes, login/logout redirects, Ably live-push for materials/announcements/attendance.
- Staff Login Redirect: both the data plumbing (`PORTAL : Set Staff Dashboard URL`, n8n id `RNbOr8GYcgLK3zi3`, keeping `contacts.f3238` synced) **and the Ontraport Login Redirects rule itself** are now live.
- **Zoom S2S credential is fixed** — `LM - Zoom TJC` (id `xKXhhw7jCSrKtCsE`) authenticated cleanly on 2026-08-13 with full attendance scopes. The earlier `400 invalid_request` is resolved; Layer 1/2/3 attendance polling is no longer blocked.
- Emails section on Event Management: 4 toggles writing `events.f3239`–`f3242`, wired through the existing `CS Dashboard : Announcements` webhook (`Td3jYarPK7VX11ba`), whose `FIELD_MAP` now carries all 7 keys. Verified on both on/off paths against test event 271.
- Every Event Management toggle now confirms before an ON write via a shared `#mToggleConfirm` dialog, with per-card copy (Release / Release announcement / Send email). OFF stays a one-click write — it notifies nobody.
- All three progressive kebab modals (Course Status, Correct Attendance, Device Exception) share one attention-cue implementation and use `Choose an option…` placeholders instead of fabricated defaults.
- CDN re-pin is now automated — see `scripts/repin.sh`, `scripts/verify-pin.sh` and `.githooks/pre-push` in the pinning section below.

**Fabricated data removed 2026-08-13 — do not reintroduce it anywhere.** The participant details drawer rendered the *same hardcoded fixture set for every participant*, including a fake emergency contact ("Jordan Ellis / (555) 019-2044 / Spouse") plus invented dietary, policy and free-text answers. The three progressive dropdowns pre-answered themselves (`428`/`430`/`432`), Correct Attendance pre-selected "Present", and Left Time was hardcoded to `15:42` — which wrote a fabricated leave timestamp to Ontraport on any save where the CS never opened the field. All replaced with real field reads or blanks. **Missing data must read as missing**; a fabricated emergency contact number presented as real is materially worse than an em dash.

**Explicitly NOT done / needs action before or during the pilot:**
1. ~~`CS Dashboard : Roster Fetch` (`PlbMTP01FSvTe2s9`) doesn't request the participant contact/Information Form fields.~~ **DONE 2026-08-13** — published as version `ed0dcb0e`, verified against `eventTeamId` 7 / event 271. Two corrections to the original note, both worth remembering:
   - **`f2585` was NOT already there.** `dashboard-engine.js` reads it (`showYesNo('dwAgreeReg', reg.f2585)`) but it was absent from `listFields`, so it is now included alongside the other 13 — 14 fields added, not 13.
   - **`f3252`/`f3253` cannot be fetched via `listFields` at all.** They are Ontraport `related_data` fields, and the **collection** endpoint `/1/objects` silently drops `related_data` entries from `listFields` — no value, no error. Only the single-record `/1/object` endpoint honours them. They are now sourced through the separate **`externs`** query parameter (`externs=f2213//email,f2213//sms_number`) and aliased back onto the `f3252`/`f3253` keys in **Build Roster Response**, so the client contract is unchanged and no engine edit or CDN re-pin was needed. See the `related_data` rule in "Critical operating rules" below.

   Baseline was 54 keys per row; the published version returns 70, a strict superset. Real values confirmed flowing (e.g. reg 959 → `tobin+checkouttest@tobinjarrett.com` / `+14156726240`, reg 863 → `katemaloneyphd@gmail.com` / `+17204958901`). `f3253` comes back as `null` for contacts with no `sms_number`, which `rosterFieldText()` already collapses to an em dash.
2. **Re-paste and republish both** `INSTALL-dashboard-header-code.html` and `INSTALL-dashboard-body-block.html`. The header code carries the Ontraport CSS collision fixes; the body block carries the modal/placeholder markup and the CDN pin.
3. **Two Ontraport CSS collision fixes are unverified visually** — modal-footer button typography, and form controls (`select`/`input`) not rendering at all inside kebab modals. Both are well-evidenced (the existing fix only hardened `font-family` and `.btn-primary` colours, leaving size/weight/`display`/`appearance` uncontested) but neither has been seen rendered. If something still looks wrong, a DevTools inspect of the computed styles settles it in one round.
4. **The Home roster modal (`#homeRosterList`) is still static prototype markup** with hardcoded counts — `openHomeRoster()` only shows and hides pre-written rows. Its participant popout therefore cannot show real data at all, and reports every Information Form value as unavailable by design.
5. **Contacts 912 and 913 still have Staff Access (`f2771`=1) with a blank `f3238`.** Their `oEventTeam` records were deleted but the contact-level flag persisted — deleting a team record does not clear it. If the live redirect rule keys on `f2771` alone, both still match and resolve to an empty URL. Either clear the flag or add an `f3238 IS NOT EMPTY` condition to the rule (the latter also fails safe for any future staff member whose sync hasn't run).
6. **Preferred Communication — the field now IS identified, but is not yet wired up.** It is `registrations.f2993`, alias "Prefered Communication (Email" (sic — the label is truncated in Ontraport), type `list`, options `398=Both, 399=Email, 400=Call`. Found 2026-08-13 while auditing the registrations meta. It is *not* in `Roster Fetch`'s `listFields` and `dashboard-engine.js` still hardcodes `dwPreferredComm` to an em dash, so the row is still honest — it just no longer needs to be. Wiring it up is a three-part change: add `f2993` to `listFields`, map the option ID to its label client-side (dropdowns return raw IDs — see the rule above), and render it. Note it is a `list` type, not `drop`, so a record can hold more than one value; and being unset reads back as `""` (verified on reg 959), which must render as an em dash, not as "Both".
7. Membership access still needs to be manually granted per staff member (Contact → Memberships tab → New Membership Site Subscriber → Landmark Portal site → Enabled) unless/until that's folded into the Staff Access automation rule.
8. **Shelved by the client:** creating a shadow registration per staff member so they can view the participant portal, without inflating roster/stats. Design sketch: a boolean "Staff Shadow Registration" flag on `registrations` (mirroring the existing `events.f3166` Test Event pattern), excluded from four places — `CS Dashboard : Bootstrap`'s `participantCount` **and** `notReadyCount` (a shadow registration would have `f2585`/`f2579` false and so land in NEEDS ATTENTION), the Roster list query, and the Master Stats rollups. Ontraport's own native event rollups (`events.f2236` etc.) can't be filtered and would still count them — the dashboard ignores those, but anything else reading them would be off by the number of staff.
9. `claude old machine.zip` and the unpacked `claude old machine/` sit in this repo's working folder and contain a live `.claude/.credentials.json`. Both are gitignored and were **never committed** (verified against full history), but they don't belong in a public repo's working tree — move them out.

## Critical operating rules — read before touching anything

**CDN pinning (dashboard-engine.js and portal-engine.js).** `dashboard-engine.js` is SHA-pinned (not `@main`), and must stay that way. **Every time you edit it: commit the engine, then run `sh scripts/repin.sh`, then push.** That script rewrites the `<script src>` in `INSTALL-dashboard-body-block.html` to the new HEAD SHA and commits it. Forgetting the re-pin means the live site silently keeps serving old JS with no error anywhere — so `scripts/verify-pin.sh` exists to catch exactly that, and `.githooks/pre-push` runs it on every push once you've set `git config core.hooksPath .githooks` (one-time, per clone).

Why pinning rather than `@main` — measured from the live response headers 2026-08-13, so this is settled, not folklore:

| | `@main` | `@<sha>` |
| --- | --- | --- |
| `Cache-Control` | `max-age=604800, s-maxage=43200` | `max-age=31536000, immutable` |
| jsDelivr edge | 12 hours | 1 year (immutable) |
| **Visitor's browser** | **up to 7 days** | 1 year (immutable) |

The historical "jsDelivr got stuck serving stale content" experience is that contract, not a jsDelivr fault — it will never "resolve itself," and a purge only clears the edge, never the 7-day browser cache. Don't move back to `@main` because a spot-check looked fresh; a fresh read just means that POP happened to revalidate recently (check the `Age:` header).

**`portal-engine.js` is still on `@main`** and therefore still exposed to exactly that staleness. It has not been pinned — treat that as an open risk, not a decision.

When verifying by hand, compare **git blob hashes** (`git hash-object dashboard-engine.js` vs `git rev-parse <sha>:dashboard-engine.js`), not raw byte counts or md5 of the files on disk. `core.autocrlf=true` here, so the working copy is CRLF while the committed blob is LF — a raw byte compare reports a false mismatch of exactly one byte per line (confirmed 2026-08-13: 119,387 local vs 117,302 on the CDN, 2,085 lines, identical content).

**Ontraport strips pasted `<body>` tags.** `INSTALL-dashboard-body-block.html`'s `<body class="home cs-dashboard">` tag never survives Ontraport's page assembly (its own page already has a real `<body>` tag; a browser can't have two). Any CSS scoped under `body.cs-dashboard` will silently never apply unless the class is also applied via `document.body.classList.add('cs-dashboard')` at runtime in JS — already done in `dashboard-engine.js`, but remember this if a future body-scoped selector "isn't taking" despite correct code and a confirmed re-paste.

**Ontraport merge tag syntax differs by context** — confirmed the hard way multiple times in this project:
- Dynamic Templates: bare `[Field]` / `[ObjectName//Field]`.
- Pages: need `[Page//Field]` / `[Page//Object(singular)//Field]`.
- Automation "Update Field" actions: merge fields work for a field on the *same* record the automation is running on (e.g. `[Purchase Count]+1`), but **do NOT work for a cross-object URL-type target field** (confirmed live 2026-08-13 — the URL validator rejects the literal `[` before merge substitution ever runs, and the field picker only offers same-object fields). Workaround used throughout: the automation POSTs the current record's own ID to an n8n webhook, which re-reads server-side and does the real write.
- Ontraport dropdown fields always return the raw option ID via the API, never label text (e.g. `"405"` not `"Day 2"") — map explicitly.
- A blank/unset Ontraport field often reads back as the literal string `"0"`, not empty/null — a real, confirmed sentinel, not a bug.
- **`related_data` fields and the `listFields` trap** (confirmed live 2026-08-13 against event 271). A field whose meta `type` is `related_data` (it appears under `readonlyFieldRows`, e.g. `f3252` Contact Email, `f3253` Contact Phone, `f3099` Graduation Day and Date) **cannot be retrieved through `listFields` on the collection endpoint `/1/objects`** — it is dropped silently, returning no key and no error. The single-record endpoint `/1/object` returns it fine, which is what makes this so easy to misdiagnose: spot-checking one record "proves" the field works, then the roster query returns nothing. Fetch them on collections via the separate **`externs`** query parameter using `parentfield//childfield` (`externs=f2213//email,f2213//sms_number`).
- **Corollary — `parentfield//childfield` inside `listFields` is a no-op.** `Get Registrations` carried `f2213//firstname` / `f2213//lastname` in `listFields` for the whole build and they appeared to work; they were actually arriving because Ontraport returns a set of **default externs** (contact name/email-ish fields, plus several `f2214//…` event fields) on every `/1/objects` call regardless of what you ask for. Don't infer from those that `//` syntax is honoured in `listFields` — anything outside the default set needs `externs`.

**n8n editing discipline:**
- Use `updateNodeParameters` with `replace:true` for any node-parameter change — **never** `setNodeParameter` on a sub-path (e.g. `/parameters/jsCode`); it can silently create a duplicate nested `parameters.parameters` key that the engine ignores while `get_workflow_details` still shows the new code as "active."
- After every edit to an already-active workflow, call `publish_workflow` and confirm `versionId === activeVersionId` — an edit alone creates a new draft version without promoting it to production.
- Verify with `execute_workflow` (manual mode, real webhook-shaped input) against real test data **before** publishing.
- Test identity: Contact `892` "Lois Pearson" (test CS, `f2771` Staff Access=true) linked via `oEventTeam` record `7` to event `271` ("TEST — The Landmark Forum," `f3166` Test Event=true). **271 is the test event for this whole build — 218 is the real live Aug 14 event, never use it as a write target.**
- Ontraport credential in n8n: `OsCRIpklBoVrdcmH` (httpCustomAuth, name "Ontraport"). New HTTP Request nodes created via the SDK's `create_workflow_from_code` do **not** auto-attach this — always follow up with an explicit `setNodeCredential` call and verify before testing.
- Shared error workflow: `q0zD6r3s2ZYTycGu`.

## Access needed to resume work

- **Git**: `https://github.com/co-labs-builds/landmark-new-era.git` — this folder is the `Portal Build` subfolder of that repo.
- **n8n MCP** (`n8n-mcp`): connects to `landmarkworldwide.awesomate.io`. Needed for any workflow read/edit/test. **The connection config is committed to this repo as `.mcp.json`** — Claude Code picks it up automatically when started in this folder, so a fresh machine needs no manual MCP setup beyond the token below.
- **Ontraport MCP**: needed for any live field/record read or write-verification. Not yet captured in `.mcp.json` — still set up by hand.
- Both were connected and working as of this session — if a fresh machine/session doesn't have them, that's the first thing to set up before attempting any live-data work (everything in this build has been verified against real Ontraport data and real n8n executions, not assumed from code alone — that rigor depends on having this access).

### Setting up `n8n-mcp` on a new machine

`.mcp.json` deliberately contains **no credential** — it references `${N8N_MCP_TOKEN}`, which Claude Code expands from the environment at startup. **This repo is public**, so the bearer token must never be committed here (same rule as the n8n Public API key in `.env`, see `.gitignore`).

Two steps on a fresh machine:

1. Get the token: n8n (`landmarkworldwide.awesomate.io`) → Settings → n8n API / MCP access → create or copy an MCP server token. It's a JWT with audience `mcp-server-api`. The one issued 2026-08-13 has **no `exp` claim** — it does not expire on its own, so rotating it in n8n is the only way to revoke it.
2. Set it as a persistent user environment variable named `N8N_MCP_TOKEN`:

   ```powershell
   # Windows (PowerShell) — persists across reboots; restart the terminal afterward
   [Environment]::SetEnvironmentVariable("N8N_MCP_TOKEN", "<paste-token>", "User")
   ```

   ```bash
   # macOS / Linux — add to ~/.zshrc or ~/.bashrc
   export N8N_MCP_TOKEN="<paste-token>"
   ```

Then start Claude Code from this folder and run `/mcp` — `n8n-mcp` should show as connected. MCP servers are loaded at startup, so a config or token change always needs a restart, not just a new session.

Verify the endpoint independently of Claude Code with a raw handshake — a healthy server returns HTTP 200 and `"serverInfo":{"name":"n8n MCP Server"}`:

```bash
curl -sS -X POST https://landmarkworldwide.awesomate.io/mcp-server/http \
  -H "Authorization: Bearer $N8N_MCP_TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"check","version":"1.0"}}}'
```

A `401`/`403` means the token is bad or rotated; a connection error means the n8n host is down or the URL changed.

## If you have access to the Claude memory files from the prior machine

The building session kept detailed persistent memory (Claude Code's own memory system, not part of this repo) at `~/.claude/projects/<project-hash>/memory/` on the original machine, covering the full chronological build history for both projects, plus feedback patterns and Ontraport-specific gotchas. If you can copy that folder to the new machine's equivalent path, a fresh session there will load it automatically. If not, this file plus the repo's own docs should be enough to resume without it — the memory files are a deeper chronological record, not the only source of truth.

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

## Current status (as of commit `58410e9`, 2026-08-13)

**Done and pushed:**
- CS Dashboard: all 6 roster kebab actions (Update Course Status, Device/Zoom Exception, Override Classification, Correct Attendance, Add Operational Note, View Details), Guests tab (read + chip/note write-back), Master Stats, Reporting Dashboard, Ably live-push both directions, real logout, Home page loading state, a full design-review round (badges, fonts, layout).
- Member Portal: My Account save (text+photo), communication-preference checkboxes, login/logout redirects, Ably live-push for materials/announcements/attendance.
- Staff Login Redirect data plumbing: `PORTAL : Set Staff Dashboard URL` (n8n id `RNbOr8GYcgLK3zi3`) keeps `contacts.f3238` synced to each staff member's dashboard URL, verified against 5 real production automation firings.

**Explicitly NOT done / needs action before or during the pilot:**
1. **🚨 Zoom S2S credential is broken** (`LM - Zoom TJC`, id `xKXhhw7jCSrKtCsE`) — confirmed live via a real `400 invalid_request` from Zoom's own token endpoint, not a code bug. This breaks Layer 1/2/3 attendance polling account-wide (not just the dashboard's own Take Attendance action). **Needs the client to check the Zoom Marketplace S2S app's status/secret directly** — no dashboard-side fix is possible. Top-priority open item.
2. **Staff Login Redirect rule itself** isn't built yet — the data sync (`f3238`) is done and verified, but someone needs to add the actual Login Redirects rule in Ontraport (Sites → Membership → Customize membership settings), conditioned on `contacts.f2771`=true, pointing at the Contact URL field `f3238`.
3. **Client needs to re-paste and republish** both `INSTALL-dashboard-header-code.html` and `INSTALL-dashboard-body-block.html` — none of today's (2026-08-13) fixes are live in Ontraport yet as of this write.
4. Membership access still needs to be manually granted per staff member (Contact → Memberships tab → New Membership Site Subscriber → Landmark Portal site → Enabled) unless/until that's folded into the Staff Access automation rule.

## Critical operating rules — read before touching anything

**CDN pinning (dashboard-engine.js and portal-engine.js).** jsDelivr has repeatedly gotten stuck serving stale content in this project. `dashboard-engine.js` is currently SHA-pinned (not `@main`) — **every time you edit it, you must get the new commit SHA (`git rev-parse HEAD`) and manually update the `<script src>` tag in `INSTALL-dashboard-body-block.html`, then commit/push that too.** Forgetting this step means the live site silently keeps serving old JS with no error. `portal-engine.js` is currently on `@main` — check that project's memory for the current pin state before assuming either way, and always verify via `curl` (compare byte count/hash against `raw.githubusercontent.com`) rather than trusting a jsDelivr purge response alone.

**Ontraport strips pasted `<body>` tags.** `INSTALL-dashboard-body-block.html`'s `<body class="home cs-dashboard">` tag never survives Ontraport's page assembly (its own page already has a real `<body>` tag; a browser can't have two). Any CSS scoped under `body.cs-dashboard` will silently never apply unless the class is also applied via `document.body.classList.add('cs-dashboard')` at runtime in JS — already done in `dashboard-engine.js`, but remember this if a future body-scoped selector "isn't taking" despite correct code and a confirmed re-paste.

**Ontraport merge tag syntax differs by context** — confirmed the hard way multiple times in this project:
- Dynamic Templates: bare `[Field]` / `[ObjectName//Field]`.
- Pages: need `[Page//Field]` / `[Page//Object(singular)//Field]`.
- Automation "Update Field" actions: merge fields work for a field on the *same* record the automation is running on (e.g. `[Purchase Count]+1`), but **do NOT work for a cross-object URL-type target field** (confirmed live 2026-08-13 — the URL validator rejects the literal `[` before merge substitution ever runs, and the field picker only offers same-object fields). Workaround used throughout: the automation POSTs the current record's own ID to an n8n webhook, which re-reads server-side and does the real write.
- Ontraport dropdown fields always return the raw option ID via the API, never label text (e.g. `"405"` not `"Day 2"") — map explicitly.
- A blank/unset Ontraport field often reads back as the literal string `"0"`, not empty/null — a real, confirmed sentinel, not a bug.

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

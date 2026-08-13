# CS Dashboard — Bootstrap/Data-Fetch Webhook Spec

**Status: v1 (Home bootstrap) BUILT, tested, and wired — 2026-08-12.** n8n workflow `CS Dashboard : Bootstrap` (id `ZRnBwGWF2R1AG2rd`, active) implements the v1 section below exactly as spec'd. Live at `https://landmarkworldwide.awesomate.io/webhook/dashboard-bootstrap`. Client-side `dashboardFetchBootstrap()` in `master-stats-dashboard-demo-LATEST.html` is wired and calls it on page load. Tested end-to-end against real data, including the full Event Leader lookup chain once a real Role=478 `oEventTeam` row was added to the test event: `eventTeamId:7` → `{success:true, participantCount:12, notReadyCount:11, eventLeaderName:"Test Event Leader 271", courseName:"The Landmark Forum"}`. Also confirmed: 403 on a nonexistent `eventTeamId`, 400 on a missing/non-numeric one.

**Build gotcha worth remembering**: Ontraport's singular `GET /1/object?id=X` endpoint returns a **non-JSON body whenever X doesn't exist** — not an HTTP error status, an actually-unparseable body — which crashes n8n's HTTP Request node even with `neverError:true` if `responseFormat` is `json`. Fixed by setting `responseFormat:'text'` on every singular `/1/object` lookup and `JSON.parse`-ing defensively downstream. The plural `GET /1/objects` (condition-based) endpoint doesn't have this problem — it always returns valid JSON (an empty `data:[]` array) even when nothing matches. Apply this same pattern to any future single-record-by-ID lookup built for this account.

**Planned extensions below are still not built** — this v1 covers Home only.

## Why this exists

`master-stats-dashboard-demo-LATEST.html` (the CS Dashboard) is a single Ontraport page bound to the logged-in Course Supervisor's own `oEventTeam` (10007) record — same one-record-per-page model as `member-portal.html`. Ontraport merge tags (`[Page//Field]`, `[Page//Event//Field]`) can resolve any field on that one record or a direct one-hop relation, and this session already wired those (CS name/role, Event title/dates/format/day-pointer — see `DASHBOARD_DATA` near the top of the dashboard's `<script>` block).

What merge tags **cannot** do:
1. Return an aggregate/count across many records (e.g. "how many registrations does this Event have").
2. Reach a *different* record of the same type than the page's own bound record (e.g. the Event Leader's `oEventTeam` row, when the page is bound to the Course Supervisor's own row).
3. Return a list of many records at all (the full Roster, Guests, per-participant Master Stats inputs).

All three are needed for Home's event-card counts, the Event Leader name in the header, and — once this build reaches those sections — the entire Roster & Classification, Guests, and Master Stats tabs. One authenticated webhook, scoped to the CS's own `oEventTeam` record, is the mechanism (mirrors the existing `PORTAL : Ably Token Auth` and `PORTAL : My Account : Write-Back` pattern: never trust a client-supplied ID as authorization, always re-derive the actor's authorized Event server-side).

## Auth model

Request carries `eventTeamId` (`DASHBOARD_DATA.eventTeamId`, the page's own `[Page//ID]`) — **not** a Contact ID or Event ID directly, so the workflow's first step is always "does this `oEventTeam` record actually exist and resolve to a real Contact + Event", closing off the same class of client-supplied-ID risk already accepted/documented for My Account (`f2214`/`f2213` pattern) and Ably Token Auth. If the record doesn't exist or its Contact doesn't match the authenticated Ontraport session, return 403 — don't leak which part failed.

## v1 — Home bootstrap (build this first)

**Request:** `POST /webhook/dashboard-bootstrap`
```json
{ "eventTeamId": 7 }
```

**Response (success):**
```json
{
  "success": true,
  "participantCount": 141,
  "notReadyCount": 6,
  "eventLeaderName": "Erin Snyder",
  "courseName": "The Landmark Forum"
}
```

**Node plan:**
1. `Get oEventTeam by ID` (`eventTeamId`) → resolve `f2789` Event, `f2788` Contact.
2. Validate: record exists, Contact matches session. Fail closed → `{success:false}`, 403.
3. `Count Registrations` (`count_objects`, `registrations`, condition `f2214 = <eventId>`) → `participantCount`. **No exclusions of any kind** — this is the raw header-tag count already confirmed in the CS Dashboard discovery notes (Roster & Classification → Table header), not the `events.f2236` rollup (flagged unreliable — internal filter logic unverifiable).
4. `Count Not-Ready Registrations` (`count_objects`, `registrations`, condition `f2214 = <eventId> AND (f2585 = false OR f2579 = false)`) → `notReadyCount`. `f2585` = "Agreed to Registration Policies" (TOS), `f2579` = "Information Form Completed" (FIF) — both confirmed real fields per the CS Dashboard field map; this matches the Home roster's own `needsattn`/`data-fif` logic (missing either flag = NEEDS ATTENTION) already built into the page.
5. `Get Event Leader` (`get_objects`, `oEventTeam`, condition `f2789 = <eventId> AND f2790 = 478`) → externs to Contact for name. **Do not use `events.f3023`/`f2397`** — both flagged dead/legacy in the field dictionary (some emails still incorrectly reference them, leave undisturbed, don't resurrect for this).
6. `Get Course Name` (`get_objects`, Event's own `f2235` Course parent → `oCourses` name field).
7. Assemble response, return.

**Client side (already wired, waiting on this endpoint):** `dashboardFetchBootstrap()` in the dashboard's `<script>` block — currently a stub with a `// TODO` comment. Once built: POST the above, on success set `DASHBOARD_DATA.participantCount`/`notReadyCount`/`eventLeaderName`/`courseName` and re-run `dashboardRenderHome()`. Call it right after the existing `dashboardRenderHome()`/`dashboardRenderSessionStrip()` calls at the bottom of the script.

## Planned extensions (not yet speced in detail — do this when Phase 2 build order reaches each section)

- **Roster & Classification**: same `eventTeamId` auth, returns the full `registrations` array for the Event with every field the Roster row/kebab-menu/Override-Classification/Attendance-Correction actions need (see CS Dashboard memory's Roster & Classification section for the full field list — Legal Name, Display Name, PID, Format, MNR/REV/SE/AC-NP/SEM-NP pills, attendance pills, Seminar/AC pill). Likely paginated given up to ~150-200 registrants per event.
- **Guests**: same pattern over `invitations` (10003).
- **Master Stats rollups**: given these are mostly derived rule-chains over the same registrant/guest data (not separate stored fields — see CS Dashboard memory's Course Snapshot / Device & Zoom Reconciliation formulas), computing them **server-side in the same webhook response** (rather than re-deriving client-side from the raw roster array) is probably right — keeps the rule chains in one place, matches the "Ontraport's own rollups can't be trusted, need a real query" lesson from `participantCount` above. Revisit this recommendation once actually building that section — may be worth splitting into its own endpoint if the roster payload gets large enough that fetching it just for a rollup is wasteful.
- **Course Materials / Announcements toggle writes**: separate webhook (write, not read) — already speced at a high level in `project-landmark-cs-dashboard` memory / the original build plan (`synchronous-painting-creek.md` Phase 2): one shared webhook, POST carries a semantic field key (not raw field ID) + on/off state, mirrors `PORTAL : Ably Publish`'s lookup-table style.

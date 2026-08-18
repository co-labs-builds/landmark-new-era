# CS Dashboard — Redesign Spec (post-event revision)

Origin: submitted 2026-08-14 19:22 local after the client sat through a full live
event day. Reason given: the dashboard is "too clunky as is — a result of
inadequate knowledge." This file exists because round 1 was submitted once and
never implemented; do not let it live only in a transcript.

Status: DESIGN pass captured. Mechanics pass not yet submitted.

---

## Round 1 — design

### 1. Test registrations
`f2878` Test Registration (check, oRegistration) = true → exclude from the record
fetch, from every metric, from everything. Act as if the record does not exist.

Not referenced anywhere in the current codebase. Needs both a server-side filter
in the roster fetch and a client-side guard, so the Ably `attendance.changed`
push cannot patch a test row back into memory.

### 2. Metrics grid

Top row, left→right:
Total Event Registrations | WBS (Withdraw Before Start) | Total Starts (Day 1) |
PNA (in queue, needs attention) | LDP (% with numeric tag) | WBO (% with numeric
tag) | Absent

Bottom row:
Active Participants | Staff | Drop-Ins | Shared Device | Multi-Device | Expected |
Live Now

Attendance strip across the top stays. Change only: numerals under the title
become a 2-stack, and the percentage container matches the height of that stack.

### 3. Top nav
- Day indicator moves to the top nav, right of the session selector.
- End Session button moves to the top nav, left of the name pill.
- Normal SaaS spacing between them.
- Event Management and Reporting move up into the dark navy nav.
- Roster, Course Materials, Guests move up.
- Remove bulky borders and fills. The active item is noticeably differentiated
  from the two inactive ones, but all three still read as nav.
- Intent: sleeker. Current feels too bulky, cluttered, big.

### 4. Record action bar
- Title stays. Remove the tagline under it.
- Remove heavy border and heavy shadows — too prominent, distracting.
- Export becomes a borderless icon.
- Search becomes borderless, height matched to surrounding content.
- Advanced Search: build queryable searches over the data, with pre-created
  popular filters — Needs attention, Late, Absent, Live, Absent NCNS, etc.

### 5. Record container
Remove the harsh bulky border and shadow. Dividing lines between records only.

### 6. Record content
- Left profile avatar displays the profile image.
- If here with someone (spouse, or shared device) → stacked avatar. Click
  separates them; clicking the other person navigates to their record.
- First Name Last Name.
- `(Name Likes)` under the name, small faded font, not distracting.
- Remove PID — not relevant to CS.

### 7. Badges
- No badges beside the user name. All badges go horizontally, evenly spaced
  pills, medium weight font.
- `Online` becomes **LIVE**, lit green when the participant is currently present.
- Clicking LIVE shows: First join time, Latest leave time, Present for
  (pretty format — `3hr 24m`, not raw minutes).
- Other badges in this row: LATE, LDP, WBO, NSHO, Absent, Withdraw.
- Pills must not be overbearing — no bulky borders, tasteful, smaller. They are
  a visual representation, not meant to be read.
- Classification: 3 items on the top row; the two NP items below spaced equally,
  together spanning the same width as the 3 above. Same pill styling.

### 8. Day / session indicators
- D1 D2 D3 follow the same simplified styling. Not bulky.
- On click: all 4 sessions for that day (S1 S2 S3 S4) across the top, a faint
  divider, then First Join, Latest Join, Latest Leave, Join Count.

### 9. Indicators row
- Remove CMPLT and CHKPNT — the day and session indicators already cover them.
- Replace with: **Shared | Sem | AC**.
- Then a notes icon → popup with multiple notes, each with its category beside
  it. All notes append here with timestamp and author.

### 10. Kebab
Remove the border. Just the three dots.

### 11. Pagination
Remove borders. Remove "prev"/"next" text.
`‹  pg X of X  ›` then a records-per-page control (10 / 25 / 50).
All right-aligned to the table.

---

## Round 2 — clarifications and additions

- **Indicators are three separate pills: Shared | Sem | AC.** (Round 1's
  "Shared Seminar and AC" was two items; it is three.)
- **Avatar source**: the member portal already does avatar upload, top right of
  the navigation. Same image.
- **Spouse pairing**: link by sharing the spouse's Contact ID. Confirmed viable —
  see field bindings below.
- **Multi-select + bulk action** on records — e.g. select several, Mark Late.

---

## Resolved field bindings (verified against live Ontraport schema 2026-08-14)

| Need | Field | Object | Type | Notes |
|---|---|---|---|---|
| Test registration | `f2878` | oRegistration 10001 | check | Exclude entirely |
| WBS | `f3266` Withdraw | oRegistration | check | "withdrew before start of event" |
| Absent / NCNS | `f3191` Attendance Status | oRegistration | drop | 467 Excused, 468 NCNS, 469 Present |
| Late | `f3062` FS LATE ARRIVAL | oRegistration | check | `f3190` holds the late note |
| Currently live | `f2853` Currently Present | oRegistration | check | |
| First join | `f2855` First Join Time | oRegistration | timestamp | |
| Latest join | `f2859` Most Recent Join Time | oRegistration | timestamp | |
| Latest leave | `f2862` Most Recent Leave Time | oRegistration | timestamp | `f2865` = Final Leave Time |
| Join count | `f2871` Join Count | oRegistration | numeric | |
| Present for | `f2867` Total Attendance Minutes | oRegistration | numeric | render as `3hr 24m` |
| Per-session attended | `f3193`–`f3196` (D1S1–4), `f3197`–`f3200` (D2S1–4), `f3201`–`f3203` + `f3055` (D3S1–4) | oRegistration | check | note D3S4 breaks the numbering |
| WBO | `f2688` Well Being Out | oRegistration | check | `f3061` = reason |
| LDP | `f2293` Left The Course | oRegistration | check | `f3056` = Left Type, `f3059` Left Day, `f3060` Left Time |
| Shared | `f3208` Device Exception = 475 | oRegistration | drop | `f3207` = partner name (text) |
| Multi-Device | `f3184` **and** `f3208` = 474 | oRegistration | check / drop | doubly encoded — pick one authority |
| Sem | `f2303` SEM Registration | oRegistration | check | ladder `f2882` / `f2884` / `f2885` |
| AC | `f2302` AC Registration | oRegistration | check | ladder `f2887` / `f2889` / `f2890` |
| Notes | `f2886` Operational Notes | oRegistration | longtext | flat text, no author/timestamp/category — see open item |
| Contact link | `f2213` Contact | oRegistration | parent → 0 | roster already joins via `f2213//<field>` |
| Avatar | `profile_image` | **Contact 0** | image | written by My Account write-back (Cloudinary secure_url) |
| Name Likes | `f2792` | **Contact 0** | text | already fetched as `f2213//f2792` |
| Spouse | `f2361` Spouse* | **Contact 0** | parent → 0 | store spouse's Contact ID |

### Avatar trap
oRegistration has its **own** readonly `profile_image` field. It is empty —
every Ontraport object gets one. Read `reg['f2213//profile_image']`, never
`reg.profile_image`, or avatars render blank forever with no error.

### Name Likes behavior change
`dashboard-engine.js:348` currently does `displayFirst = nameLikes || first`, so
Name Likes **replaces** the legal first name. The spec wants legal name on line 1
and `(Name Likes)` faded underneath. This is a change, not an addition.

### Spouse link direction
`f2361` is a one-directional parent field. `A.f2361 = B` does not set
`B.f2361 = A`. For the stacked avatar to render on both rows, write both sides at
save time (preferred) or reverse-lookup `contacts where f2361 = thisContactId` on
read. Current `set_spouse` writes a name string from the hardcoded
`PARTICIPANT_NAMES` array and persists nothing.

---

## Round 3 — device reconciliation semantics + staff identification

### f3208 is an exception, not a classifier
Client, 2026-08-14: Device Exception exists for when the count of devices is
lower than the expected participant count, because two people are sharing one.
Not common. The workflow is human: the CS notices someone sharing, messages them
to confirm both are actually in the program, then marks it shared so the expected
device number matches what is live.

**This is a device-count comparison, not a headcount comparison.**

### Conflict with the 2026-08-14 correction
`dashboard-engine.js:519-533` rewrote this comparison to be explicitly
HEADCOUNT-based, on the stated grounds that "the dashboard never receives Zoom's
live connection total." On that basis multi-device was deliberately removed from
the arithmetic — one person on two connections is still one `f2853=1`.

That is correct in headcount space and wrong in device space:

| | headcount | devices |
|---|---|---|
| Shared device (2 people, 1 device) | −1 per pair | −1 per pair |
| Multi-device (1 person, 2 devices) | no effect | **+1 per occurrence** |

They cancel in headcount space, which is why the 8/14 fix looked right in
isolation. To do the device comparison the client is describing, multi-device
must return to the arithmetic with the opposite sign from shared, AND the poller
must start sending a live Zoom connection total. Today the only poller-derived
live figure that reaches the dashboard is the drop-in count (`events.f3262`).

### `sharedAdj` breaks when only one side is marked
```js
var sharedDeviceCount = registrations.filter(r => String(r.f3207||'').trim() !== '').length;
var sharedAdj = -Math.floor(sharedDeviceCount / 2);
```
`floor(n/2)` assumes both people in a pair are flagged. The described CS workflow
marks it once. One-sided → `floor(1/2) = 0` → no adjustment at all, so the
correction appears to do nothing. `f3207` is free text holding a name, so nothing
verifies that two flagged records point at each other.

Fix is the same as spouse: store the partner's **ID**, not a name string. Pair
count becomes exact and marking one side is sufficient.

### Expected formula — stated vs implemented
Client's formula: Registrants − Staff − Drop-Ins − LDP − WBO.
Implemented (`dashboard-engine.js:459`, `:544`):

| Term | Client | Code |
|---|---|---|
| LDP | subtract | excluded via `f2293` |
| WBO | subtract | **NOT excluded** — `f2688` counted at :461, never removed |
| Drop-Ins | subtract | displayed only, absent from the equation |
| Staff | subtract | added to BOTH sides — algebraically a no-op |
| Cancelled / Stat-excluded | — | also excluded (`f2424=153`, `f3046=1`) |

WBO only drops out today if that record also has `f2293` set. Nothing enforces
that pairing, so once someone goes WBO without being marked as having left,
`expected` runs high and the ✓ can never reconcile for the rest of the event.

### Staff identification by Zoom display name
Client, 2026-08-14: staff do not need to be listed. When staff join, their Zoom
display name is `Name - Staff`, so staff can be inferred from the name.

Why this matters beyond convenience: the poller currently classifies any live
participant matching neither a Registration nor an oEventTeam row as a drop-in
(`events.f3262`). Unmatched staff are therefore being counted as drop-ins today,
inflating that tile and skewing reconciliation by the number of unmatched staff.

Implementation notes:
- Match tolerantly — `/[-–—]\s*staff\s*$/i` on the trimmed display name. Hand-typed
  suffixes arrive as `-Staff`, `– Staff` (en dash), `- staff`, with trailing space.
- **The Staff tile changes meaning.** Today `staffCount` = oEventTeam rows with
  `f3218=1`, a roster-side number. Display-name inference makes it a live Zoom
  number. A staff member on the team who has not joined counts in one and not the
  other. Decide which the tile shows.
- Staff who forget the suffix still land in drop-ins. That case should surface
  visibly rather than silently skewing the count.

---

## Round 4 — mechanics

### Poller state as of 2026-08-15 02:36Z (verified, not assumed)

`LM | Zoom | Live Attendance Poller` (`6JwMYmvkTuFLVUeN`) is **active and
healthy**. Runs every 5 minutes, 1188 executions, latest `73518` succeeded at
02:36Z. It is NOT down.

Still paused from the troubleshooting stop (`active: false`):

| Workflow | ID |
|---|---|
| LM \| Zoom \| Final Attendance Poller | `0Im29wKBGYaqn9K4` |
| LM \| Zoom \| Late Outreach Detector | `JJv8rDMNhRwzAiZI` |
| LM \| Zoom \| Meeting Run Start Detector | `Qotcc6TRpwgv65lJ` |
| LM \| Zoom \| Seed Scheduled Meeting Runs | `VIXwxrH5EvfVU7Hl` |
| CS Dashboard : Attendance Reconcile Sweep | `hVemNaYj1wAqZOe0` |
| CS Dashboard : Take Attendance | `t6AfyBKL6d68pK1L` |

Live presence updates; late detection, session start/seed, final reconciliation
and the CS attendance action are all dark. This is what "get it back up" means.

Still active: `CS Dashboard : Device Exception` (`tO4lpjJWdjOdMFkj`).

### Corrections to stale documentation
- **Pagination is fixed.** `Get Live Zoom Participants` calls
  `/v2/metrics/meetings/{id}/participants?type=live&page_size=300` with
  `next_page_token` pagination, `maxRequests: 10` (~3000 participants). The
  "non-paginating production poller" phrasing in `LM | Admin | Live Participant
  Count` predates the fix.
- **Cadence is 5 minutes**, not 1. The schedule node is named `Every 5 Minutes`;
  the workflow description saying "every minute" is stale.

### Device count already exists in the poller — nothing counts it
`/metrics/meetings/{id}/participants?type=live` returns **one row per
connection**. That is precisely how multi-device (`f3184`) is detected. So the
raw live device total is the length of that array, already present in
`Build Poll Candidates` and never used. `Count Drop In Viewers` counts people.

Required change is one new field plus a count, NOT a new poller:

| New field | Object | Purpose |
|---|---|---|
| Current Live Connections | oEvents 10000 | raw live row count, written beside `f3262` |

Reuses the existing `Write Drop In Count → Build Metric Publish Payload →
Publish Metric Change` Ably path, so the dashboard gets it live with no new
plumbing.

### Staff-by-display-name hooks into one existing condition
`Count Drop In Viewers` excludes staff only by oEventTeam `f3249` registrant-ID
match:
```js
if(r.currently_present===true && r.matched===false
   && r.processing_status==='registration_not_found'
   && !staffIds.has(String(r.registrant_id||''))){
```
Staff joining via a generic `/j/` link receive a different `registrant_id` and
fall through into the drop-in count. Adding the display-name test
(`/[-–—]\s*staff\s*$/i` on the trimmed name) to this same condition fixes it.

### Bulk write path
Ontraport `PUT /1/objects` accepts an `ids` list and applies the same field
values to all of them in one call. The poller already calls this endpoint
directly (`Write Drop In Count`), so no new capability is needed.

```
Dashboard  →  new webhook {action, registrationIds:[...], value}
           →  ONE PUT /1/objects {objectID:10001, ids:"1201,1204,1210", f3062:1}
           →  ONE Ably publish carrying the id list
```

**Constraint:** bulk sets an identical value across the whole selection, so it is
valid only for uniform flag actions.

| Action | Bulk-safe | Why |
|---|---|---|
| Mark Late (`f3062=1`) | yes | uniform, idempotent |
| Notes append (`f2886`) | **no** | read-modify-write per record; bulk would overwrite |
| WBO / LDP / classification override | **no** | each needs its own reason + note |

Multi-select UI should grey out per-record-input actions rather than silently
applying one value to everyone.

### Notes — timeline format (client, 2026-08-15)
Newest note **appended to the top** so the popup reads as a timeline.

```
|  Author Name  -  timestamp          ← timestamp in light/faint font
|  (tiny text) category / override
|
|  Note body line one
|  continued body text
|  continued body text

------------------------------------------------

|  Author Name  -  timestamp
|  (tiny text) category / override
|
|  Note body line one
|  continued body text
```

- Author is the Course Supervisor / CS who wrote it.
- Category or override type sits under the author line in tiny text.
- Horizontal divider between entries.
- Every note in the system appends here regardless of which action created it.

**Storage consequence:** author + timestamp + category per entry, newest-first,
is what the native Ontraport **Notes object (12)** provides for free — it carries
author and timestamp natively and is queryable. The current `f2886` longtext has
none of that, and a parsed-convention hack breaks the moment anyone edits the
field in raw Ontraport. Recommend Notes object; `f2886` becomes legacy/read-only
and its existing content renders as a single uncategorised entry at the bottom.

---

## Round 5 — attendance architecture clean-up

Client directive 2026-08-15: simplify. Poll on a cadence for who is present, mark
who cannot be matched, let the CS trigger an attendance check on demand, and run
the minutes/time tracking on a slow 10–15 minute cadence. **No manual steps** —
Day 1 of event 218 was ending when this was set.

### Target shape — 3 workflows, 0 state tables

| Workflow | Cadence | Owns |
|---|---|---|
| Presence Poll | 5 min | day resolved at poll time; live participants; `f2853`, `f3184`, unmatched `f2808=490`, drop-ins `f3262`, live connections, staff presence; derives LATE (`f3062`) from first-join vs session start and Absent-NCNS (`f3191=468`) past T+20 |
| Manual Attendance Check | CS-triggered | existing `CS Dashboard : Take Attendance`; same poll on demand, writes per-session ATTENDED |
| Minutes Rollup | 10–15 min | `f2805`–`f2807`, `f2867`, `f2871`, first/last join, flips day-attended at 5-min threshold |

Retires: Seed Scheduled Meeting Runs, Meeting Run Start Detector, Final
Attendance Poller, Late Outreach Detector, Attendance Reconcile Sweep, Attendance
Threshold Reconciler, Final Attendance Reconciliation — and the
`zoom_meeting_runs` data table (`yQtusDPGfcYPnlgg`).

### Why the state table must go — misattribution, not data loss
The Forum is a **3-occurrence recurring meeting**, so `f3034` = `97279358372` is
the same meeting ID for Days 1–3. Only `day_number` on the run row distinguishes
them. With the end-detector and start-detector paused:

- nothing sets `ended_at` / clears `active` on the Day 1 row
- nothing activates a Day 2 row
- the poller keeps matching the Day 1 row, polls the same meeting, and writes
  **Day 2 presence into Day 1 fields** (`f3193`–`f3196`, `f2801`, `f2805`)

Silent, plausible-looking corruption. Deriving day per poll removes it entirely.

### Day derivation — CORRECTED
`f2753` Session Dates is **not** a parseable list despite its field description.
Event 218's value is the literal string `"Fri, Aug 14th - Sun, Aug 16th"`.
Indexing it would have failed on the first run.

Use date arithmetic instead:
```
day_number = (today in <f2757 IANA zone>) − (f2233 Event Start Date) + 1
             clamped to 1..3
```

| Field | Event 218 value | Role |
|---|---|---|
| `f2233` Event Start Date | `1786723200` (Aug 14) | anchor |
| `f2757` Calendar TZ (IANA) | `300` = US Pacific | "today" resolution |
| `f2754` / `f2755` | `9:00 AM` / `9:00 PM` | 12-hour session day |
| `f2720` Cal Start (UTC) | `2026-08-14T16:00:00Z` | cross-check — equals the run row's `started_at`, and 9:00 AM Pacific |
| `f3034` | `97279358372` | Forum meeting |
| `f3038` | `97116706744` | Graduation meeting (separate date `f3258` = Aug 18) |

`f3035`/`f3036`/`f3037` (Day 1/2/3 Zoom Occurrence IDs) are **empty**, so
occurrence-based resolution is unavailable. Date arithmetic is the only
automatic path. `f3025` "Todays Session (Day)" is a human-flipped pointer and
must not be a dependency.

### Live evidence of the staff-matching bug (event 218, 2026-08-15 02:35Z)
| Field | Value |
|---|---|
| `f3255` Total Present | 20 |
| `f3256` Total Staff Present | **0** |
| `f3262` Current Drop-In Viewers | 6 |

Staff presence reads zero on a live day with 20 present. The 6 drop-ins are
likely staff falling through the `f3249` registrant-ID match. The `- Staff`
display-name test should correct both figures in one change.

### Event-level device fields already exist
`f3072` Couples Sharing Device and `f3073` Double Devices (both numeric, both
currently 0) are the natural homes for the shared/multi-device counts feeding the
reconciliation row, instead of recomputing from the roster client-side.

---

## Round 6 — verified against live Zoom payload (event 218, 2026-08-15 04:15Z)

### `type=live` is a cumulative connection log, not a presence list
`/v2/metrics/meetings/{id}/participants?type=live` returned **`total_records`:
1328** for a 143-person event. 898 of 900 sampled rows carry a populated
`leave_time`, and `status` reads `"in_meeting"` on rows for people who left hours
earlier. `status` is unusable.

**Presence is `!leave_time` and nothing else.** Confirmed in
`Build Poll Candidates` line 32: `open: !p.leave_time`.

Earlier note in Round 4 that the raw array length equals the device count was
**wrong** — that yields 1328. Device count = open rows only.

### Pagination cap is a Day 3 risk
1328 rows after ONE day; Zoom reports `page_count: 5`. Node is capped at
`maxRequests: 10` × `page_size: 300` = 3000. If the log does not reset per
occurrence, Day 3 lands near ~4000 rows and pagination **silently truncates** —
participants vanish from the poll with no error. Also explains execution time
drifting from 25s to 85s. Verify reset behaviour when Day 2 opens.

### The `registrant_id` gate — hidden participants
`Build Poll Candidates` line 32:
```js
const registrantId = String(p.registrant_id||'').trim();
if(!registrantId) continue;
```
Anyone without a `registrant_id` is dropped before any counting — not present,
not staff, not a drop-in. Live proof at 04:15Z, the only two open sessions:

| Display name | Role | registrant_id |
|---|---|---|
| `Adele Wilhelm-Staff` | cohost | `s5ffZd9CQdG8T3arJTrVGA` |
| `Lois Pearson- Course Supervisor` | host | **(none)** |

The Course Supervisor hosting the meeting is invisible to the entire pipeline.
This is why `f3256` Total Staff Present reads 0.

Consequence for the device count: it must be taken from raw open rows **before**
the `registrant_id` gate, or it undercounts by every host/generic account.

*Caveat: 900 of 1328 rows were read (call truncated to 3 pages), so "2 open" is a
lower bound within that subset, not a confirmed total.*

### Graduation — hardcoded `4`
`Build Registration Update`:
```js
const attendedField = c.day_number===1?'f2801':c.day_number===2?'f2802'
                    : c.day_number===3?'f2803':c.day_number===4?'f2804':'';
```
`day_number === 4` → `f2804` Attended Graduation. Graduation has its **own Zoom
link** (`f3038` = `97116706744`), separate from the Forum meeting (`f3034`).

So the resolver must, on the Graduation date, poll `f3038` AND emit
`day_number: 4`. Any other value resolves `attendedField` to `''` and writes
nothing, silently.

### Staff identification — FINAL RULE (client, 2026-08-15)
```js
const STAFF_RE = /(supervisor|landmark|staff\s*$)/i;
```
Matched against the trimmed Zoom display name. Covers all four observed forms:
`-Staff`, `- Course Supervisor`, and the generic `Landmark Meeting NN` accounts.
Applied regardless of `registrant_id`, so hosts are no longer invisible.

### Drop-Ins removed
Client directive: **remove Drop-Ins entirely, staff only.**
- Retire `f3262` Current Drop-In Viewers and `f3257` Total Drop-In Viewers.
- Remove the Drop-Ins tile from the Round 1 bottom-row metrics.
- The `registration_not_found` → drop-in classification path is deleted.

**Open risk:** unmatched non-staff participants are then counted nowhere,
removing the only explanation for live devices exceeding expected. Recommend
retaining an internal "unattributed" count (not surfaced as a tile) so the
reconciliation still balances.

### Other limits found while looking for the hardcoded 4
| Node | Limit |
|---|---|
| `Find Registration in Ontraport` | `range=50`, `maxRequests: 20` → 1000 max |
| `Get Event Team` | `range=50`, **no pagination** → 50 staff max |
| `Write Live Attendance` | batching `size=2`, `interval=1000` → 2 writes/sec |

---

## Round 7 — DEPLOYED 2026-08-15 06:06Z

`LM | Zoom | Live Attendance Poller` (`6JwMYmvkTuFLVUeN`) edited in place and
published. `activeVersionId: 8f45838e-de8c-44ca-b443-037c1c14a54a`.

Edited in place rather than rebuilt because the API **redacts credentials** — a
newly created workflow would have had none, requiring a manual attach in the n8n
UI, which the no-manual constraint forbids. `update_workflow` applies per-node
operations, so existing nodes kept their auth.

**n8n uses a draft/published model.** The first edit saved as a draft and
production kept running the old data-table path (`versionId` != `activeVersionId`).
It only took effect after an explicit `publish_workflow`. Always verify those two
IDs match after an update, or the change is invisible in production.

### Changes shipped
| Change | Detail |
|---|---|
| Session resolution | `Get Active Meeting Runs` is now a Code node deriving the session per poll from the Event. Name deliberately retained so all downstream `$()` references and the proven matching/writeback path are untouched. **Rename later — the name is now misleading.** |
| New node | `Get Event For Session` — Ontraport events fetch, credential `OsCRIpklBoVrdcmH` |
| Day maths | `floor((now - f2720)/24h)+1`, clamped 1–3, inside a 15h window |
| Graduation | `day_number: 4` + meeting `f3038` |
| Test events | `f3166=1` skipped |
| Pagination | `maxRequests` 10 → 25 |
| Event query | bounded both sides (`f2395 >= now-7d AND f2233 <= now+1d`), sorted `f2233 desc` — was returning exactly 50 rows against a 50 cap with no pagination, so the live event survived on ordering luck alone |
| Data table | `zoom_meeting_runs` node removed |

### Verified live
- Ontraport call → HTTP 200; credential works despite the "configure manually" warning
- Zoom token → account `jJtVz36HSLqRH-_URBcE-g` (production, not the test account)
- Resolver → `{event_id:218, meeting_id:97279358372, day_number:1, resolved_from:'f2720+offset'}`
- Event 271 (TEST) excluded — it carries identical `f2720`/`f3034`/`f3038`
- Event query 50 rows → 3 rows

### Known-good failure mode
`Get Live Zoom Participants` now returns `404 Meeting does not exist` because
Day 1's meeting ended. Swallowed by `neverError` + `statusCode>=400 continue`,
writes nothing — correct. **But this is the same signature as the original
corruption** (wrong Zoom account → 404 → ran green → wrote nothing). It is
indistinguishable from a misconfiguration. Add an alert that distinguishes
"no session resolved" from "session resolved but Zoom 404'd".

### Still outstanding (Round 6 items NOT yet shipped)
- Staff via `/(supervisor|landmark|staff\s*$)/i`, applied before the `registrant_id` gate
- Drop-Ins removal (`f3262`/`f3257`) + internal unattributed count
- Live device count from open rows
- Rename `Get Active Meeting Runs`
- The five other paused workflows remain paused

---

## Open items

1. **Confirm which workflows to reactivate** and in what order — the six paused
   above, or a subset. Reactivating blind risks re-running whatever caused the
   original overwrite.
2. **Name and create the Current Live Connections field** on oEvents 10000.
3. **Notes storage decision** — Notes object (12) recommended; needs a read path
   in the roster webhook and a rewrite of `CS Dashboard : Add Note`.
4. **Shared-device pairing** needs an ID link to replace the `f3207` name string.
5. **Staff tile source** — live Zoom (display-name inference) vs oEventTeam
   `f3218`. Round 3 leans live; confirm.
6. **WBO exclusion** from `expected` — currently missing.
7. **Multi-device sign** — must re-enter the reconciliation as `+1` per
   occurrence once a real device count exists.
